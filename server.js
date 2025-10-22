// server.js — Opción 1: Render FREE (uploads locales, no persistentes)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000; // Render setea PORT
const MOD_KEY = process.env.MOD_KEY || 'CAMBIA-ESTA-CLAVE';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // si quieres restringir, pon tu dominio

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGIN } });

app.use(express.json());
app.use(express.static('public')); // sirve overlay.html / modpanel.html y /uploads

// === Subidas locales dentro de /public/uploads (NO persistentes en plan free) ===
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
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

// === Estado en memoria (se pierde al reiniciar) ===
let state = [];

// Rutas
app.get('/overlay', (_, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));
app.get('/modpanel', (_, res) => res.sendFile(path.join(__dirname, 'public', 'modpanel.html')));

// Auth básica
function auth(req, res, next) {
  const key = req.headers['x-mod-key'] || req.query.key;
  if (key !== MOD_KEY) return res.status(401).json({ ok:false, error:'unauthorized' });
  next();
}

// API subida (devuelve URL relativa servida por express.static)
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, error:'no_file' });
  const rel = path.relative(path.join(__dirname, 'public'), req.file.path);
  const url = '/' + rel.replace(/\\/g, '/'); // ej: /uploads/xxx.png
  res.json({ ok:true, url });
});

// WebSocket (preview en vivo + cambios persistentes)
io.on('connection', (socket) => {
  socket.emit('state:init', state);

  // Preview en vivo (no persiste)
  socket.on('item:preview', ({ id, x, y }) => {
    socket.broadcast.emit('item:preview', { id, x, y });
  });

  // Altas/actualizaciones/remociones (sí persisten en memoria)
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

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
