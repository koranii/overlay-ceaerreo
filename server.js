// server.js — Overlay + Panel (Render + Disco persistente)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ====== Config por entorno ======
const PORT = process.env.PORT || 3000;               // Render setea PORT
const MOD_KEY = process.env.MOD_KEY || 'SATI';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://overlay-ceaerreo.com'; // p.ej. https://tu-dominio.com
const UPLOAD_DIR_ENV = process.env.UPLOAD_DIR || null;    // p.ej. /data/uploads (disco de Render)

// ====== App & Socket ======
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGIN } });

app.use(express.json());
app.use(express.static('public')); // sirve overlay.html / modpanel.html

// ====== Subidas (disco local o montado) ======
const defaultUploads = path.join(__dirname, 'public', 'uploads');
const UPLOAD_DIR = UPLOAD_DIR_ENV || defaultUploads;
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname) || '';
    cb(null, `${ts}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage });

// ====== Estado en memoria ======
let state = []; // [{ id, type, url, x,y,scale,rot,opacity,visible,zIndex, muted, loop }]

// ====== Rutas básicas ======
app.get('/overlay', (_, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));
app.get('/modpanel', (_, res) => res.sendFile(path.join(__dirname, 'public', 'modpanel.html')));

// Auth simple para API
function auth(req, res, next) {
  const key = req.headers['x-mod-key'] || req.query.key;
  if (key !== MOD_KEY) return res.status(401).json({ ok:false, error:'unauthorized' });
  next();
}

// API: subida
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, error:'no_file' });
  // Si usas disco local o montado, la ruta pública es relativa al server:
  // Si el mount NO está dentro de /public, igualmente puedes servirlo con una ruta estática adicional:
  // app.use('/uploads', express.static(UPLOAD_DIR)) — añadir si usas mount fuera de /public.
  // En Render con mount /data/uploads, habilita:
  // app.use('/uploads', express.static('/data/uploads'));
  const rel = path.relative(path.join(__dirname, 'public'), req.file.path);
  const url = '/' + rel.replace(/\\/g, '/'); // ej: /uploads/archivo.png
  res.json({ ok:true, url });
});

// ====== WebSocket ======
io.on('connection', (socket) => {
  // Estado inicial
  socket.emit('state:init', state);

  // Preview en vivo (no persiste)
  socket.on('item:preview', ({ id, x, y }) => {
    socket.broadcast.emit('item:preview', { id, x, y });
  });

  // Altas/actualizaciones/remociones (sí persisten)
  socket.on('item:add', (item) => {
    item.id = item.id || `it_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    item.x = item.x ?? 200; item.y = item.y ?? 150; item.scale = item.scale ?? 1;
    item.rot = item.rot ?? 0; item.opacity = item.opacity ?? 1; item.visible = item.visible ?? true;
    item.zIndex = item.zIndex ?? (state.length ? Math.max(...state.map(i=>i.zIndex||0))+1 : 1);
    state.push(item);
    io.emit('item:added', item);
  });

  socket.on('item:update', ({ id, patch }) => {
    const i = state.findIndex(it => it.id === id);
    if (i === -1) return;
    state[i] = { ...state[i], ...patch };
    io.emit('item:updated', { id, patch: state[i] });
  });

  socket.on('item:remove', (id) => {
    state = state.filter(it => it.id !== id);
    io.emit('item:removed', id);
  });

  socket.on('items:clear', () => {
    state = [];
    io.emit('items:cleared');
  });
});

// ====== Run ======
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
