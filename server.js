import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { authRouter, authenticateSocket, authMiddleware } from './backend/auth.js';
import { db, initDatabase } from './backend/db.js';
import { chatRouter } from './backend/chat.js';
import { markConversationRead } from './backend/readReceipts.js';

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
app.set('onlineUsers', onlineUsers);

const canSignal = (conversationId, userId, targetUserId) => db.prepare('SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ? AND user_id IN (?, ?)').get(conversationId, userId, targetUserId)?.count === 2;
const relayCall = (event, payload, userId) => {
  const targetUserId = Number(payload.targetUserId);
  if (!Number.isInteger(targetUserId) || !canSignal(payload.conversationId, userId, targetUserId)) return;
  for (const socketId of onlineUsers.get(targetUserId) || []) io.to(socketId).emit(event, { ...payload, targetUserId, fromUserId: userId });
};
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
  socket.emit('presence:initial', { userIds: [...onlineUsers.keys()] });
  io.emit('presence:update', { userId, online: true });

  socket.on('conversation:join', (conversationId) => {
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId);
    if (!member) return;
    socket.join(`conversation:${conversationId}`);
    const messages = db.prepare("SELECT id, sender_id AS senderId FROM messages WHERE conversation_id = ? AND sender_id != ? AND status = 'sent'").all(conversationId, userId);
    if (!messages.length) return;
    db.prepare("UPDATE messages SET status = 'delivered' WHERE conversation_id = ? AND sender_id != ? AND status = 'sent'").run(conversationId, userId);
    for (const senderId of new Set(messages.map(({ senderId }) => senderId))) {
      for (const socketId of onlineUsers.get(senderId) || []) io.to(socketId).emit('message:status:batch', { conversationId: Number(conversationId), messageIds: messages.filter((message) => message.senderId === senderId).map(({ id }) => id), status: 'delivered' });
    }
  });
  socket.on('conversation:read', ({ conversationId }) => markConversationRead(conversationId, userId, io, onlineUsers));
  socket.on('typing:start', ({ conversationId }) => socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId, typing: true }));
  socket.on('typing:stop', ({ conversationId }) => socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId, typing: false }));
  socket.on('message:delivered', ({ messageId, conversationId }) => {
    db.prepare('UPDATE messages SET status = ? WHERE id = ? AND status = ?').run('delivered', messageId, 'sent');
    socket.to(`conversation:${conversationId}`).emit('message:status', { messageId, status: 'delivered' });
  });
  socket.on('message:read', ({ conversationId }) => markConversationRead(conversationId, userId, io, onlineUsers));
  socket.on('call-user', (payload) => relayCall('incoming-call', payload, userId));
  socket.on('call-accepted', (payload) => relayCall('call-accepted', payload, userId));
  socket.on('call-rejected', (payload) => relayCall('call-rejected', payload, userId));
  socket.on('call-ended', (payload) => relayCall('call-ended', payload, userId));
  socket.on('webrtc-offer', (payload) => relayCall('webrtc-offer', payload, userId));
  socket.on('webrtc-answer', (payload) => relayCall('webrtc-answer', payload, userId));
  socket.on('ice-candidate', (payload) => relayCall('ice-candidate', payload, userId));
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
