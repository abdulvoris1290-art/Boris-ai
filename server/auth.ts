import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';
import { db } from './db.ts';
import { HttpError } from './http.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

// A real hash to compare against when the user doesn't exist (keeps timing uniform).
// Built synchronously at startup so there is no early window where unknown emails answer faster.
const dummySalt = crypto.randomBytes(16);
const dummyHash = `scrypt${dummySalt.toString('base64')}${crypto
  .scryptSync(crypto.randomBytes(16).toString('hex'), dummySalt, 64, SCRYPT)
  .toString('base64')}`;
export const getDummyHash = () => dummyHash;

export interface Preferences {
  theme: 'dark' | 'light' | 'system';
  responseLanguage: string; // 'auto' or a language name
  customInstructions: string;
  voiceLanguage: string; // BCP-47 tag for speech recognition / synthesis
  sendOnEnter: boolean;
  autoTitle: boolean;
  autoSpeak: boolean; // read replies aloud when the question was asked by voice
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  responseLanguage: 'auto',
  customInstructions: '',
  voiceLanguage: 'en-US',
  sendOnEnter: true,
  autoTitle: true,
  autoSpeak: true,
};

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  preferences: string;
  created_at: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  preferences: Preferences;
}

export function toPublicUser(row: UserRow): PublicUser {
  let prefs: Partial<Preferences> = {};
  try {
    prefs = JSON.parse(row.preferences);
  } catch {
    /* ignore corrupt prefs */
  }
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at, preferences: { ...DEFAULT_PREFERENCES, ...prefs } };
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)');
const findSession = db.prepare(
  'SELECT u.* , s.expires_at AS s_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
);
const touchSession = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?');
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction || req.secure,
    path: '/',
    maxAge: config.session.maxAgeMs,
  };
}

export function createSession(req: Request, res: Response, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  insertSession.run(sha256(token), userId, now, now + config.session.maxAgeMs, String(req.headers['user-agent'] ?? '').slice(0, 300));
  res.cookie(config.session.cookieName, token, cookieOptions(req));
}

export function destroySession(req: Request, res: Response) {
  const token = readCookie(req, config.session.cookieName);
  if (token) deleteSession.run(sha256(token));
  res.clearCookie(config.session.cookieName, { ...cookieOptions(req), maxAge: undefined });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Resolves the session user (if any) and stores it on res.locals.user. */
export function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, config.session.cookieName);
  if (token) {
    const hash = sha256(token);
    const row = findSession.get(hash, Date.now()) as (UserRow & { s_expires: number }) | undefined;
    if (row) {
      res.locals.user = row;
      // Sliding expiration: extend when less than half the lifetime remains.
      if (row.s_expires - Date.now() < config.session.maxAgeMs / 2) {
        touchSession.run(Date.now() + config.session.maxAgeMs, hash);
        res.cookie(config.session.cookieName, token, cookieOptions(req));
      }
    }
  }
  next();
}

export function requireAuth(_req: Request, res: Response, next: NextFunction) {
  if (!res.locals.user) return next(new HttpError(401, 'Please sign in to continue.', 'unauthenticated'));
  next();
}

export const currentUser = (res: Response): UserRow => res.locals.user as UserRow;
