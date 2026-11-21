import { Router } from 'express';
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type UserRow,
  createSession,
  currentUser,
  destroySession,
  getDummyHash,
  hashPassword,
  requireAuth,
  toPublicUser,
  verifyPassword,
} from '../auth.ts';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { EMAIL_RE, HttpError, newId, rateLimiter, str } from '../http.ts';

export const authRouter = Router();

const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: (req) => `auth:${req.ip}`,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');

export const hasUsers = () => Number((countUsers.get() as { n: number }).n) > 0;
/** The first account can always be created; more only when ALLOW_SIGNUP=true. */
export const signupOpen = () => config.allowSignup || !hasUsers();

function validatePassword(pw: unknown, field = 'Password'): string {
  const v = str(pw, field, { min: 8, max: 200, trim: false });
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) {
    throw new HttpError(400, `${field} must contain at least one letter and one number.`, 'validation');
  }
  return v;
}

authRouter.post('/signup', authLimiter, async (req, res) => {
  if (!signupOpen()) throw new HttpError(403, 'Sign-up is closed on this Voris AI server. Ask the owner for access.', 'signup_closed');
  const name = str(req.body?.name, 'Name', { min: 1, max: 80 });
  const email = str(req.body?.email, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address.', 'validation');
  const password = validatePassword(req.body?.password);

  if (findByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists. Try signing in.', 'email_taken');

  // Hash first (async), then re-check and insert synchronously so concurrent sign-ups
  // can't both slip past the "first account only" rule or the duplicate-email check.
  const passwordHash = await hashPassword(password);
  if (!signupOpen()) throw new HttpError(403, 'Sign-up is closed on this Voris AI server. Ask the owner for access.', 'signup_closed');
  if (findByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists. Try signing in.', 'email_taken');
  const id = newId();
  db.prepare('INSERT INTO users (id, email, name, password_hash, preferences, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    email,
    name,
    passwordHash,
    JSON.stringify(DEFAULT_PREFERENCES),
    Date.now(),
  );
  createSession(req, res, id);
  res.status(201).json({ user: toPublicUser(findById.get(id) as unknown as UserRow) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 254 }).toLowerCase();
  const password = str(req.body?.password, 'Password', { max: 200, trim: false });
  const user = findByEmail.get(email) as UserRow | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? getDummyHash());
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password.', 'invalid_credentials');
  createSession(req, res, user.id);
  res.json({ user: toPublicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', (_req, res) => {
  const user = res.locals.user as UserRow | undefined;
  res.json({ user: user ? toPublicUser(user) : null });
});

const PREF_VALIDATORS: { [K in keyof Preferences]: (v: unknown) => Preferences[K] } = {
  theme: (v) => {
    if (v !== 'dark' && v !== 'light' && v !== 'system') throw new HttpError(400, 'Invalid theme.', 'validation');
    return v;
  },
  responseLanguage: (v) => str(v, 'Response language', { min: 1, max: 40 }),
  customInstructions: (v) => str(v, 'Custom instructions', { optional: true, max: 3000 }),
  voiceLanguage: (v) => {
    const s = str(v, 'Voice language', { min: 2, max: 20 });
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(s)) throw new HttpError(400, 'Invalid voice language.', 'validation');
    return s;
  },
  sendOnEnter: (v) => !!v,
  autoTitle: (v) => !!v,
  autoSpeak: (v) => !!v,
};

authRouter.patch('/me', requireAuth, (req, res) => {
  const user = toPublicUser(currentUser(res));
  let name = user.name;
  if (req.body?.name !== undefined) name = str(req.body.name, 'Name', { min: 1, max: 80 });

  const prefs: Preferences = { ...user.preferences };
  const incoming = req.body?.preferences;
  if (incoming && typeof incoming === 'object') {
    for (const key of Object.keys(PREF_VALIDATORS) as (keyof Preferences)[]) {
      if (key in incoming) (prefs as unknown as Record<string, unknown>)[key] = PREF_VALIDATORS[key](incoming[key]);
    }
  }
  db.prepare('UPDATE users SET name = ?, preferences = ? WHERE id = ?').run(name, JSON.stringify(prefs), user.id);
  res.json({ user: toPublicUser(findById.get(user.id) as unknown as UserRow) });
});

authRouter.post('/password', requireAuth, authLimiter, async (req, res) => {
  const user = currentUser(res);
  const current = str(req.body?.currentPassword, 'Current password', { max: 200, trim: false });
  const next = validatePassword(req.body?.newPassword, 'New password');
  if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(400, 'Your current password is incorrect.', 'invalid_credentials');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), user.id);
  // Sign out every other session, then issue a fresh one for this device.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  createSession(req, res, user.id);
  res.json({ ok: true });
});

authRouter.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const user = currentUser(res);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  createSession(req, res, user.id);
  res.json({ ok: true });
});

authRouter.delete('/me', requireAuth, authLimiter, async (req, res) => {
  const user = currentUser(res);
  const password = str(req.body?.password, 'Password', { max: 200, trim: false });
  if (!(await verifyPassword(password, user.password_hash))) throw new HttpError(400, 'Password is incorrect.', 'invalid_credentials');
  destroySession(req, res);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // cascades to sessions, chats, messages
  res.json({ ok: true });
});
