import path from 'node:path';

export type ProviderId = 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'custom';

const env = (key: string): string => (process.env[key] ?? '').trim();

const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'groq', 'openrouter', 'custom'];

function resolveProvider(): ProviderId | null {
  const raw = env('AI_PROVIDER').toLowerCase();
  if (!raw) return null;
  return (PROVIDERS as string[]).includes(raw) ? (raw as ProviderId) : null;
}

function parseTrustProxy(v: string): string | number {
  if (!v) return 'loopback, linklocal, uniquelocal';
  return /^\d+$/.test(v) ? Number(v) : v;
}

export const config = {
  port: Number(env('PORT')) || 3001,
  /**
   * Which proxies to trust for the client IP (used by rate limits). Default: local proxies only.
   * Behind Cloudflare or a hosting load balancer, set TRUST_PROXY to the hop count (e.g. 1).
   */
  trustProxy: parseTrustProxy(env('TRUST_PROXY')),
  isProduction: process.env.NODE_ENV === 'production',
  appOrigins: env('APP_ORIGIN')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  /** Voris is a private assistant: after the first (owner) account, sign-up is closed unless ALLOW_SIGNUP=true. */
  allowSignup: env('ALLOW_SIGNUP').toLowerCase() === 'true',
  databasePath: path.resolve(env('DATABASE_PATH') || './data/voris.db'),
  ai: {
    provider: resolveProvider(),
    rawProvider: env('AI_PROVIDER'),
    apiKey: env('AI_API_KEY'),
    model: env('AI_MODEL'),
    visionModel: env('AI_VISION_MODEL'),
    baseUrl: env('AI_BASE_URL').replace(/\/$/, ''),
    effort: env('AI_EFFORT').toLowerCase(),
  },
  search: {
    provider: (['tavily', 'brave'].includes(env('SEARCH_PROVIDER').toLowerCase())
      ? env('SEARCH_PROVIDER').toLowerCase()
      : null) as 'tavily' | 'brave' | null,
    apiKey: env('SEARCH_API_KEY'),
  },
  session: {
    cookieName: 'voris_session',
    maxAgeMs: 1000 * 60 * 60 * 24 * 30,
  },
  limits: {
    maxMessageChars: 32_000,
    maxImagesPerMessage: 4,
    maxImageBase64Chars: 7_000_000, // ≈5 MB binary
    maxDocumentChars: 250_000,
    maxDocumentsPerMessage: 5,
  },
};
