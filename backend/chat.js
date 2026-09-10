import express from 'express';
import { z } from 'zod';
import { db } from './db.js';

export const chatRouter = express.Router();
const userSelect = `SELECT u.id, u.name, u.username, u.about, u.avatar_url AS avatarUrl, u.last_seen AS lastSeen FROM users u`;
const conversationFor = (id, userId) => db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.status != 'read') AS unreadCount, (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessage, (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessageAt, (SELECT json_group_array(json_object('id', u.id, 'name', u.name, 'username', u.username, 'avatarUrl', u.avatar_url, 'about', u.about, 'lastSeen', u.last_seen)) FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = c.id) AS members FROM conversations c JOIN conversation_members me ON me.conversation_id = c.id WHERE c.id = ? AND me.user_id = ?`).get(userId, id, userId);
const isMember = (conversationId, userId) => db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId);

chatRouter.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const users = db.prepare(`${userSelect} WHERE u.id != ? AND (u.username LIKE ? OR u.name LIKE ?) ORDER BY u.name LIMIT 20`).all(req.user.id, `%${q}%`, `%${q}%`);
  res.json({ users });
});
chatRouter.get('/conversations', (req, res) => {
  const rows = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id WHERE cm.user_id = ? ORDER BY c.updated_at DESC`).all(req.user.id);
  res.json({ conversations: rows.map(({ id }) => conversationFor(id, req.user.id)) });
});
chatRouter.post('/conversations/direct', (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.body.username);
  if (!target || target.id === req.user.id) return res.status(404).json({ error: 'User not found.' });
  let existing = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id = c.id JOIN conversation_members b ON b.conversation_id = c.id WHERE c.kind = 'direct' AND a.user_id = ? AND b.user_id = ?`).get(req.user.id, target.id);
  if (!existing) {
    const create = db.transaction(() => {
      const conversation = db.prepare('INSERT INTO conversations (kind) VALUES (?)').run('direct');
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)').run(conversation.lastInsertRowid, req.user.id, conversation.lastInsertRowid, target.id);
      return conversation.lastInsertRowid;
    });
    existing = { id: create() };
  }
  res.status(201).json({ conversation: conversationFor(existing.id, req.user.id) });
});
chatRouter.get('/conversations/:id/messages', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'You do not have access to this conversation.' });
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const messages = db.prepare(`SELECT m.id, m.body, m.status, m.reply_to_id AS replyToId, m.created_at AS createdAt, m.sender_id AS senderId, u.name AS senderName, u.username AS senderUsername FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(req.params.id, before, limit).reverse();
  db.prepare('UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_id != ? AND status != ?').run('read', req.params.id, req.user.id, 'read');
  res.json({ messages });
});
chatRouter.post('/conversations/:id/messages', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'You do not have access to this conversation.' });
  const parsed = z.object({ body: z.string().trim().min(1).max(4000), replyToId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Message cannot be empty.' });
  const result = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, reply_to_id) VALUES (?, ?, ?, ?)').run(req.params.id, req.user.id, parsed.data.body, parsed.data.replyToId || null);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  const message = db.prepare(`SELECT m.id, m.conversation_id AS conversationId, m.body, m.status, m.reply_to_id AS replyToId, m.created_at AS createdAt, m.sender_id AS senderId, u.name AS senderName, u.username AS senderUsername FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`).get(result.lastInsertRowid);
  req.app.get('io')?.to(`conversation:${req.params.id}`).emit('message:new', message);
  res.status(201).json({ message });
});
chatRouter.patch('/profile', (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(60), about: z.string().trim().max(140) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check your profile details.' });
  db.prepare('UPDATE users SET name = ?, about = ? WHERE id = ?').run(parsed.data.name, parsed.data.about, req.user.id);
  res.json({ user: db.prepare('SELECT id, name, username, contact, about, avatar_url AS avatarUrl, last_seen AS lastSeen FROM users WHERE id = ?').get(req.user.id) });
});
