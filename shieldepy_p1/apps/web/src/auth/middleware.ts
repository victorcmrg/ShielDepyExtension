import type { IncomingMessage } from 'node:http';
import { getSessionUser, type AuthUser } from './session';
import { getUserByDeviceToken } from './deviceTokens';

export function requireSession(req: IncomingMessage): AuthUser | null {
  return getSessionUser(req);
}

export function requireDeviceToken(req: IncomingMessage): { id: number; email: string; companyId: number } | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return getUserByDeviceToken(header.slice('Bearer '.length).trim());
}

export function isAdmin(user: { email: string } | null): boolean {
  if (!user) return false;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;
  return user.email.toLowerCase() === adminEmail.toLowerCase();
}
