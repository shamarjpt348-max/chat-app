import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mitra-local-development-secret-change-me';
export const authRouter = express.Router();
const credentials = z.object({ name: z.string().trim().min(2).max(60), username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/), contact: z.string().trim().min(3).max(120), password: z.string().min(8).max(72) });
const tokenFor = (user) => jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
const publicUser = (user) => ({ id: user.id, name: user.name, username: user.username, contact: user.contact, about: user.about, avatarUrl: user.avatar_url, lastSeen: user.last_seen });

export function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Your session has expired' }); }
}
export function authenticateSocket(socket, next) {
  try { socket.user = jwt.verify(socket.handshake.auth?.token, JWT_SECRET); next(); }
  catch { next(new Error('Authentication required')); }
}

authRouter.post('/register', (req, res) => {
  const result = credentials.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: 'Use a name, username, contact, and password of at least 8 characters.' });
  const { name, username, contact, password } = result.data;
  try {
    const info = db.prepare('INSERT INTO users (name, username, contact, password_hash) VALUES (?, ?, ?, ?)').run(name, username, contact, bcrypt.hashSync(password, 12));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) { res.status(409).json({ error: error.code?.includes('username') ? 'That username is already taken.' : 'That contact is already registered.' }); }
});

authRouter.post('/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR contact = ?').get(req.body.identifier, req.body.identifier);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Incorrect username or password.' });
  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  res.json({ token: tokenFor(user), user: publicUser(user) });
});

authRouter.get('/me', authMiddleware, (req, res) => res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) }));
