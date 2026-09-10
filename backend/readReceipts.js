import { db } from './db.js';

export function markConversationRead(conversationId, readerId, io, onlineUsers) {
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, readerId);
  if (!member) return [];
  const messages = db.prepare('SELECT id, sender_id AS senderId FROM messages WHERE conversation_id = ? AND sender_id != ? AND status != ?').all(conversationId, readerId, 'read');
  if (!messages.length) return [];
  const readAt = new Date().toISOString();
  db.prepare("UPDATE messages SET status = 'read', read_at = ? WHERE conversation_id = ? AND sender_id != ? AND status != 'read'").run(readAt, conversationId, readerId);
  db.prepare('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?').run(messages[messages.length - 1].id, conversationId, readerId);
  const payload = { conversationId: Number(conversationId), messageIds: messages.map(({ id }) => id), readerId, readAt };
  for (const senderId of new Set(messages.map(({ senderId }) => senderId))) {
    for (const socketId of onlineUsers.get(senderId) || []) io.to(socketId).emit('messages:read', payload);
  }
  return messages.map(({ id }) => id);
}
