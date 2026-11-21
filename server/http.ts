import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const newId = (): string => crypto.randomUUID();

// ── Input validation helpers ────────────────────────────────────────────────

export function str(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; optional?: boolean; trim?: boolean } = {},
): string {
  const { min = 0, max = 10_000, optional = false, trim = true } = opts;
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    throw new HttpError(400, `${field} is required.`, 'validation');
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`, 'validation');
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new HttpError(400, `${field} must be at least ${min} characters.`, 'validation');
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`, 'validation');
  return v;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── Simple in-memory fixed-window rate limiter ─────────────────────────────

export function rateLimiter(opts: { windowMs: number; max: number; key: (req: Request, res: Response) => string; message?: string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, opts.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key(req, res);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return next(new HttpError(429, opts.message ?? 'Too many requests. Please slow down and try again shortly.', 'rate_limited'));
    }
    next();
  };
}
