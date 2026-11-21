import type { AppConfig, Attachment, Chat, Message, Mode, Preferences, Source, User } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Called when the server says the session is gone (expired, revoked, or signed out elsewhere). */
let unauthorizedHandler: (() => void) | null = null;
export const onUnauthorized = (fn: () => void) => {
  unauthorizedHandler = fn;
};

function toApiError(res: Response, data: any): ApiError {
  const err = new ApiError(data?.error?.message ?? `Request failed (${res.status}).`, res.status, data?.error?.code);
  if (res.status === 401 && err.code === 'unauthenticated') unauthorizedHandler?.();
  return err;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError('Unable to reach Voris AI. Check your connection and try again.', 0, 'network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw toApiError(res, data);
  }
  return data as T;
}

export const api = {
  config: () => request<AppConfig>('/config'),

  // Auth
  me: () => request<{ user: User | null }>('/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/auth/login', { method: 'POST', json: { email, password } }),
  signup: (name: string, email: string, password: string) =>
    request<{ user: User }>('/auth/signup', { method: 'POST', json: { name, email, password } }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST', json: {} }),
  updateMe: (patch: { name?: string; preferences?: Partial<Preferences> }) =>
    request<{ user: User }>('/auth/me', { method: 'PATCH', json: patch }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/password', { method: 'POST', json: { currentPassword, newPassword } }),
  revokeOtherSessions: () => request<{ ok: true }>('/auth/sessions/revoke-others', { method: 'POST', json: {} }),
  deleteAccount: (password: string) => request<{ ok: true }>('/auth/me', { method: 'DELETE', json: { password } }),

  // Chats
  listChats: (q?: string) => request<{ chats: Chat[] }>(`/chats${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createChat: () => request<{ chat: Chat }>('/chats', { method: 'POST', json: {} }),
  getChat: (id: string) => request<{ chat: Chat; messages: Message[] }>(`/chats/${id}`),
  updateChat: (id: string, patch: { title?: string; pinned?: boolean }) =>
    request<{ chat: Chat }>(`/chats/${id}`, { method: 'PATCH', json: patch }),
  deleteChat: (id: string) => request<{ ok: true }>(`/chats/${id}`, { method: 'DELETE' }),
  clearChat: (id: string) => request<{ ok: true }>(`/chats/${id}/messages`, { method: 'DELETE' }),
  deleteAllChats: () => request<{ deleted: number }>('/chats', { method: 'DELETE' }),
  exportChats: () => request<unknown>('/chats/export'),
};

// ── Streaming completions (Server-Sent Events over fetch) ──────────────────

export interface CompletionRequest {
  action: 'send' | 'regenerate' | 'edit';
  content?: string;
  attachments?: Attachment[];
  messageId?: string;
  mode: Mode;
  targetLanguage?: string;
  webSearch?: boolean;
}

export interface StreamHandlers {
  onStart?: (d: { userMessage: Message; assistantMessageId: string }) => void;
  onStatus?: (state: 'searching' | 'thinking') => void;
  onSources?: (sources: Source[]) => void;
  onDelta?: (text: string) => void;
  onTitle?: (title: string) => void;
  onNotice?: (message: string) => void;
  onDone?: (message: Message | null) => void;
  onError?: (message: string, persisted: boolean) => void;
}

export async function streamCompletion(chatId: string, body: CompletionRequest, handlers: StreamHandlers, signal: AbortSignal) {
  const res = await fetch(`/api/chats/${chatId}/completions`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw toApiError(res, data);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let terminal = false;

  const dispatch = (event: string, raw: string) => {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    switch (event) {
      case 'start': return handlers.onStart?.(data);
      case 'status': return handlers.onStatus?.(data.state);
      case 'sources': return handlers.onSources?.(data.sources);
      case 'delta': return handlers.onDelta?.(data.text);
      case 'title': return handlers.onTitle?.(data.title);
      case 'notice': return handlers.onNotice?.(data.message);
      case 'done': terminal = true; return handlers.onDone?.(data.message);
      case 'error': terminal = true; return handlers.onError?.(data.message, !!data.persisted);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) dispatch(event, dataLines.join('\n'));
    }
  }
  if (!terminal && !signal.aborted) handlers.onError?.('The connection was interrupted. Please try again.', false);
}
