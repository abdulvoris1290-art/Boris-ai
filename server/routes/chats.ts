import { Router, type Response } from 'express';
import { config } from '../config.ts';
import { currentUser, toPublicUser } from '../auth.ts';
import { db, transaction } from '../db.ts';
import { HttpError, newId, oneOf, rateLimiter, str } from '../http.ts';
import { MODES, TITLE_PROMPT, buildSystemPrompt, type Mode } from '../prompts.ts';
import { ProviderError, aiProvider, effectiveMaxImages, type ProviderMessage } from '../providers/index.ts';
import { searchConfigured, webSearch, type SearchResult } from '../search.ts';

export const chatsRouter = Router();

// ── Types & mappers ─────────────────────────────────────────────────────────

interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  seq: number;
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: string;
  sources: string;
  mode: string | null;
  status: string;
  created_at: number;
}

type Attachment =
  | { type: 'image'; name: string; mediaType: string; data: string }
  | { type: 'document'; name: string; mediaType: string; text: string; truncated?: boolean };

const DEFAULT_TITLE = 'New chat';

const chatDto = (c: ChatRow) => ({ id: c.id, title: c.title, pinned: !!c.pinned, createdAt: c.created_at, updatedAt: c.updated_at });

const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const messageDto = (m: MessageRow) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  attachments: parse<Attachment[]>(m.attachments, []),
  sources: parse<SearchResult[]>(m.sources, []),
  mode: m.mode,
  status: m.status,
  createdAt: m.created_at,
});

// ── Statements ──────────────────────────────────────────────────────────────

const getChat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?');
const listMessages = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq ASC');
const insertMessage = db.prepare(
  'INSERT INTO messages (id, chat_id, role, content, attachments, sources, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const touchChat = db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?');
const setTitle = db.prepare('UPDATE chats SET title = ? WHERE id = ?');

function ownedChat(res: Response, id: string): ChatRow {
  const chat = getChat.get(id, currentUser(res).id) as ChatRow | undefined;
  if (!chat) throw new HttpError(404, 'Conversation not found.', 'not_found');
  return chat;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

chatsRouter.get('/', (req, res) => {
  const userId = currentUser(res).id;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  let rows: ChatRow[];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    rows = db
      .prepare(
        `SELECT DISTINCT c.* FROM chats c LEFT JOIN messages m ON m.chat_id = c.id
         WHERE c.user_id = ? AND (c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
         ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`,
      )
      .all(userId, like, like) as unknown as ChatRow[];
  } else {
    rows = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 500').all(userId) as unknown as ChatRow[];
  }
  res.json({ chats: rows.map(chatDto) });
});

chatsRouter.post('/', (req, res) => {
  const userId = currentUser(res).id;
  const title = str(req.body?.title, 'Title', { optional: true, max: 120 }) || DEFAULT_TITLE;
  const now = Date.now();
  const id = newId();
  db.prepare('INSERT INTO chats (id, user_id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(id, userId, title, now, now);
  res.status(201).json({ chat: chatDto(getChat.get(id, userId) as unknown as ChatRow) });
});

chatsRouter.get('/export', (_req, res) => {
  const user = currentUser(res);
  const chats = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY created_at ASC').all(user.id) as unknown as ChatRow[];
  const data = {
    exportedAt: new Date().toISOString(),
    app: 'Voris AI',
    account: { name: user.name, email: user.email },
    chats: chats.map((c) => ({
      ...chatDto(c),
      messages: (listMessages.all(c.id) as unknown as MessageRow[]).map((m) => {
        const dto = messageDto(m);
        // Keep exports readable: drop raw image bytes.
        return { ...dto, attachments: dto.attachments.map((a) => (a.type === 'image' ? { type: a.type, name: a.name } : a)) };
      }),
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="voris-ai-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

chatsRouter.delete('/', (_req, res) => {
  const result = db.prepare('DELETE FROM chats WHERE user_id = ?').run(currentUser(res).id);
  res.json({ deleted: Number(result.changes) });
});

chatsRouter.get('/:id', (req, res) => {
  const chat = ownedChat(res, String(req.params.id));
  res.json({ chat: chatDto(chat), messages: (listMessages.all(chat.id) as unknown as MessageRow[]).map(messageDto) });
});

chatsRouter.patch('/:id', (req, res) => {
  const chat = ownedChat(res, String(req.params.id));
  if (req.body?.title !== undefined) setTitle.run(str(req.body.title, 'Title', { min: 1, max: 120 }), chat.id);
  if (req.body?.pinned !== undefined) db.prepare('UPDATE chats SET pinned = ? WHERE id = ?').run(req.body.pinned ? 1 : 0, chat.id);
  res.json({ chat: chatDto(getChat.get(chat.id, chat.user_id) as unknown as ChatRow) });
});

chatsRouter.delete('/:id', (req, res) => {
  const chat = ownedChat(res, String(req.params.id));
  db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
  res.json({ ok: true });
});

chatsRouter.delete('/:id/messages', (req, res) => {
  const chat = ownedChat(res, String(req.params.id));
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chat.id);
  touchChat.run(Date.now(), chat.id);
  res.json({ ok: true });
});

// ── Completions (streaming) ────────────────────────────────────────────────

const completionLimiter = rateLimiter({
  windowMs: 60_000,
  max: 30,
  key: (_req, res) => `ai:${currentUser(res).id}`,
  message: 'You are sending messages very quickly. Please wait a moment.',
});

function validateAttachments(raw: unknown): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'Invalid attachments.', 'validation');
  const { maxImageBase64Chars, maxDocumentChars, maxDocumentsPerMessage } = config.limits;
  const maxImagesPerMessage = effectiveMaxImages();
  const out: Attachment[] = [];
  let images = 0;
  let docs = 0;
  for (const a of raw) {
    if (!a || typeof a !== 'object') throw new HttpError(400, 'Invalid attachment.', 'validation');
    const name = str(a.name, 'File name', { min: 1, max: 200 });
    if (a.type === 'image') {
      if (++images > maxImagesPerMessage) throw new HttpError(400, `You can attach up to ${maxImagesPerMessage} images per message.`, 'validation');
      const mediaType = oneOf(a.mediaType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const, 'image/jpeg');
      if (typeof a.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(a.data)) throw new HttpError(400, `Image "${name}" is invalid.`, 'validation');
      if (a.data.length > maxImageBase64Chars) throw new HttpError(400, `Image "${name}" is too large (max 5 MB).`, 'validation');
      out.push({ type: 'image', name, mediaType, data: a.data });
    } else if (a.type === 'document') {
      if (++docs > maxDocumentsPerMessage) throw new HttpError(400, `You can attach up to ${maxDocumentsPerMessage} documents per message.`, 'validation');
      if (typeof a.text !== 'string') throw new HttpError(400, `Document "${name}" is invalid.`, 'validation');
      const truncated = a.text.length > maxDocumentChars;
      out.push({
        type: 'document',
        name,
        mediaType: str(a.mediaType, 'Media type', { optional: true, max: 120 }) || 'text/plain',
        text: truncated ? a.text.slice(0, maxDocumentChars) : a.text,
        truncated: truncated || !!a.truncated,
      });
    } else {
      throw new HttpError(400, 'Unsupported attachment type.', 'validation');
    }
  }
  return out;
}

/** Converts stored history into provider messages, bounded to a sensible context budget. */
function toProviderMessages(rows: MessageRow[]): ProviderMessage[] {
  const CHAR_BUDGET = aiProvider?.id === 'anthropic' ? 600_000 : 120_000;
  const MAX_IMAGE_TURNS = 2; // only the most recent image-bearing turns keep their pixels
  const imageBudget = aiProvider?.maxImagesPerRequest ?? 4;
  let imageTurns = 0;
  let imagesUsed = 0;
  let used = 0;
  const out: ProviderMessage[] = [];

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.role === 'assistant' && !row.content.trim()) continue;
    const attachments = parse<Attachment[]>(row.attachments, []);
    const docs = attachments.filter((a) => a.type === 'document');
    const imgs = attachments.filter((a) => a.type === 'image');

    let text = row.content;
    if (docs.length) {
      const docText = docs
        .map((d) => `<document name="${d.name.replace(/"/g, "'")}"${d.truncated ? ' truncated="true"' : ''}>\n${d.text}\n</document>`)
        .join('\n\n');
      text = `${docText}\n\n${text || 'Please analyze the attached document(s).'}`;
    }

    let images: ProviderMessage['images'];
    if (imgs.length) {
      // Newest images keep their pixels, within the model's per-request image limit.
      const room = imageTurns < MAX_IMAGE_TURNS ? Math.max(0, imageBudget - imagesUsed) : 0;
      const keep = imgs.slice(0, room);
      const dropped = imgs.slice(room);
      if (keep.length) {
        images = keep.map((img) => ({ mediaType: img.mediaType, data: img.data }));
        imagesUsed += keep.length;
        imageTurns++;
      }
      if (dropped.length) text = `${dropped.map((img) => `[Earlier image: ${img.name}]`).join(' ')}\n${text}`;
    }

    used += text.length;
    if (used > CHAR_BUDGET && out.length > 0) break;
    out.unshift({ role: row.role, content: text, images });
  }

  // Providers require the conversation to start with a user turn.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return DEFAULT_TITLE;
  return clean.length > 48 ? `${clean.slice(0, 46).trimEnd()}…` : clean;
}

chatsRouter.post('/:id/completions', completionLimiter, async (req, res) => {
  const user = currentUser(res);
  const prefs = toPublicUser(user).preferences;
  const chat = ownedChat(res, String(req.params.id));

  if (!aiProvider) {
    throw new HttpError(503, 'Voris AI is not connected to an AI provider yet. An administrator needs to set AI_PROVIDER and AI_API_KEY on the server.', 'ai_not_configured');
  }

  const action = oneOf(req.body?.action, ['send', 'regenerate', 'edit'] as const, 'send');
  const mode: Mode = oneOf(req.body?.mode, MODES, 'chat');
  const targetLanguage = str(req.body?.targetLanguage, 'Target language', { optional: true, max: 40 });
  const wantsSearch = !!req.body?.webSearch;
  if (wantsSearch && !searchConfigured()) throw new HttpError(400, 'Web search is not configured on this server.', 'search_not_configured');

  const now = Date.now();
  let userMessage: MessageRow | null = null;

  // 1) Mutate history according to the action.
  transaction(() => {
    const history = listMessages.all(chat.id) as unknown as MessageRow[];
    if (action === 'send') {
      const content = str(req.body?.content, 'Message', { optional: true, max: config.limits.maxMessageChars });
      const attachments = validateAttachments(req.body?.attachments);
      if (!content && attachments.length === 0) throw new HttpError(400, 'Message cannot be empty.', 'validation');
      const id = newId();
      insertMessage.run(id, chat.id, 'user', content, JSON.stringify(attachments), '[]', mode, 'complete', now);
      userMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow;
    } else if (action === 'edit') {
      const messageId = str(req.body?.messageId, 'Message id', { max: 64 });
      const content = str(req.body?.content, 'Message', { min: 1, max: config.limits.maxMessageChars });
      const target = history.find((m) => m.id === messageId && m.role === 'user');
      if (!target) throw new HttpError(404, 'Message not found.', 'not_found');
      db.prepare('UPDATE messages SET content = ?, mode = ? WHERE id = ?').run(content, mode, target.id);
      db.prepare('DELETE FROM messages WHERE chat_id = ? AND seq > ?').run(chat.id, target.seq);
      userMessage = { ...target, content, mode };
    } else {
      const last = history[history.length - 1];
      if (!last) throw new HttpError(400, 'Nothing to regenerate.', 'validation');
      if (last.role === 'assistant') db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);
      const prev = (listMessages.all(chat.id) as unknown as MessageRow[]).at(-1);
      if (!prev || prev.role !== 'user') throw new HttpError(400, 'Nothing to regenerate.', 'validation');
      userMessage = prev;
    }
    touchChat.run(now, chat.id);
  });

  const userMsg = userMessage as unknown as MessageRow;
  const isFirstExchange = (listMessages.all(chat.id) as unknown as MessageRow[]).length === 1;

  // 2) Open the SSE stream.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abort = new AbortController();
  let finished = false;
  res.on('close', () => {
    if (!finished) abort.abort();
  });

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  const assistantId = newId();
  send('start', { userMessage: messageDto(userMsg), assistantMessageId: assistantId });

  // Title: set a quick fallback immediately, refine with AI in parallel.
  let titlePromise: Promise<string | null> = Promise.resolve(null);
  if (chat.title === DEFAULT_TITLE && userMsg) {
    const firstText = userMsg.content || parse<Attachment[]>(userMsg.attachments, [])[0]?.name || '';
    const quick = fallbackTitle(firstText);
    setTitle.run(quick, chat.id);
    send('title', { title: quick });
    if (prefs.autoTitle && firstText.trim() && isFirstExchange) {
      titlePromise = aiProvider
        .complete({
          system: TITLE_PROMPT,
          messages: [{ role: 'user', content: firstText.slice(0, 2000) }],
          maxTokens: 40,
          signal: AbortSignal.timeout(15_000),
        })
        .then((t) => {
          const title = t.replace(/^["'“”«»\s#*]+|["'“”«».\s*]+$/g, '').slice(0, 80);
          if (!title) return null;
          setTitle.run(title, chat.id);
          return title;
        })
        .catch(() => null);
    }
  }

  let content = '';
  let sources: SearchResult[] | undefined;
  let status: 'complete' | 'stopped' | 'error' = 'complete';
  let errorMessage: string | null = null;

  try {
    // 3) Optional web search.
    if (wantsSearch) {
      send('status', { state: 'searching' });
      try {
        sources = await webSearch(userMsg.content || 'latest news', abort.signal);
      } catch {
        sources = [];
        send('notice', { message: 'Web search failed, answering without live results.' });
      }
      send('sources', { sources });
    }

    // 4) Stream the model response.
    send('status', { state: 'thinking' });
    const history = listMessages.all(chat.id) as unknown as MessageRow[];
    const result = await aiProvider.stream(
      {
        system: buildSystemPrompt({ userName: user.name, prefs, mode, targetLanguage, sources }),
        messages: toProviderMessages(history),
        signal: abort.signal,
      },
      (text) => {
        content += text;
        send('delta', { text });
      },
    );
    if (result.stopReason === 'aborted') status = 'stopped';
    if (result.stopReason === 'length') send('notice', { message: 'The response reached the maximum length.' });
  } catch (err) {
    status = 'error';
    errorMessage = err instanceof ProviderError ? err.message : 'Something went wrong while generating a response.';
    if (!(err instanceof ProviderError)) console.error('[completion]', err);
  }

  // 5) Persist the assistant message (partial content is kept when stopped).
  if (content.trim() || status !== 'error') {
    insertMessage.run(assistantId, chat.id, 'assistant', content, '[]', JSON.stringify(sources ?? []), mode, status, Date.now());
    touchChat.run(Date.now(), chat.id);
  }

  const title = await Promise.race([titlePromise, new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
  if (title) send('title', { title });

  if (status === 'error') {
    send('error', { message: errorMessage, persisted: !!content.trim() });
  } else {
    const saved = db.prepare('SELECT * FROM messages WHERE id = ?').get(assistantId) as unknown as MessageRow | undefined;
    send('done', { message: saved ? messageDto(saved) : null });
  }
  finished = true;
  clearInterval(heartbeat);
  res.end();
});
