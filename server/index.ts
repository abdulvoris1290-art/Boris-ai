import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { loadUser, requireAuth } from './auth.ts';
import { HttpError } from './http.ts';
import { effectiveMaxImages, providerStatus } from './providers/index.ts';
import { searchConfigured } from './search.ts';
import { authRouter, hasUsers, signupOpen } from './routes/auth.ts';
import { chatsRouter } from './routes/chats.ts';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// ── Security headers ────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
  }
  next();
});

// ── CSRF defence: state-changing requests must come from our own origin ─────
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === host;
    } catch {
      /* malformed origin */
    }
    if (!sameHost && !config.appOrigins.includes(origin)) return next(new HttpError(403, 'Cross-origin request blocked.', 'forbidden'));
  }
  if (!req.is('application/json') && req.headers['content-length'] && req.headers['content-length'] !== '0') {
    return next(new HttpError(415, 'Requests must be JSON.', 'unsupported_media_type'));
  }
  next();
});

app.use('/api', express.json({ limit: '30mb' }));
app.use('/api', loadUser);

// ── API routes ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    ai: providerStatus(),
    search: { configured: searchConfigured() },
    auth: { signupOpen: signupOpen(), hasUsers: hasUsers() },
    limits: {
      maxMessageChars: config.limits.maxMessageChars,
      maxImagesPerMessage: effectiveMaxImages(),
      maxDocumentsPerMessage: config.limits.maxDocumentsPerMessage,
      maxDocumentChars: config.limits.maxDocumentChars,
    },
  });
});

app.use('/api/auth', authRouter);
app.use('/api/chats', requireAuth, chatsRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.', 'not_found')));

// ── Static frontend (production build) ─────────────────────────────────────
const distDir = path.resolve('dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  const assetsDir = path.join(distDir, 'assets');
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, file) => {
        // Only content-hashed build assets can be cached forever; everything else is revalidated.
        if (file.startsWith(assetsDir)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    // A missing file (e.g. an old build's chunk) is a 404, not the app shell.
    if (path.extname(req.path)) return next(new HttpError(404, 'Not found.', 'not_found'));
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    console.error('[server] error after response started', err);
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { message: 'That request is too large. Try smaller attachments.', code: 'too_large' } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'Malformed request body.', code: 'bad_request' } });
    return;
  }
  console.error('[server]', err);
  res.status(500).json({ error: { message: 'Something went wrong on our side. Please try again.', code: 'internal' } });
});

app.listen(config.port, () => {
  const ai = providerStatus();
  console.log(`\n  ◆ Voris AI server listening on http://localhost:${config.port}`);
  console.log(ai.configured ? `  ◆ AI provider: ${ai.provider} · ${ai.model}` : `  ⚠ AI provider not configured: ${ai.problem} Run "npm run setup" to connect one.`);
  console.log(searchConfigured() ? `  ◆ Web search: ${config.search.provider}` : '  · Web search: not configured (optional)\n');
});
