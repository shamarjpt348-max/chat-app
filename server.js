import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { authRouter, authenticateSocket, authMiddleware } from './backend/auth.js';
import { db, initDatabase } from './backend/db.js';
import { chatRouter } from './backend/chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendPath = path.join(__dirname, 'dist');
const app = express();
const server = http.createServer(app);
const allowExternal = process.env.ALLOW_EXTERNAL !== 'false';
const corsOptions = {
  origin: (origin, callback) => callback(null, !origin || allowExternal || origin === (process.env.CLIENT_URL || 'http://localhost:5173')),
};
const io = new Server(server, { cors: corsOptions });
const onlineUsers = new Map();

initDatabase();
app.set('io', io);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Mitra Chat API' }));
app.use('/api/auth', authRouter);
app.use('/api', authMiddleware, chatRouter);
app.use(express.static(frontendPath));

// Vite's client-side routes must resolve to the same browser entry point in production.
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(frontendPath, 'index.html'));
  next();
});

io.use(authenticateSocket);
io.on('connection', (socket) => {
  const userId = socket.user.id;
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  io.emit('presence:update', { userId, online: true });

  socket.on('conversation:join', (conversationId) => socket.join(`conversation:${conversationId}`));
  socket.on('typing:start', ({ conversationId }) => socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId, typing: true }));
  socket.on('typing:stop', ({ conversationId }) => socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId, typing: false }));
  socket.on('message:delivered', ({ messageId, conversationId }) => {
    db.prepare('UPDATE messages SET status = ? WHERE id = ? AND status = ?').run('delivered', messageId, 'sent');
    socket.to(`conversation:${conversationId}`).emit('message:status', { messageId, status: 'delivered' });
  });
  socket.on('message:read', ({ conversationId }) => {
    db.prepare('UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_id != ?').run('read', conversationId, userId);
    socket.to(`conversation:${conversationId}`).emit('conversation:read', { conversationId, userId });
  });
  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) {
      onlineUsers.delete(userId);
      db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      io.emit('presence:update', { userId, online: false, lastSeen: new Date().toISOString() });
    }
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`Mitra Chat listening on port ${PORT}`));
export { app, server, io };
