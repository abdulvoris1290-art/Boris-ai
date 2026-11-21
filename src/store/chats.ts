import { create } from 'zustand';
import { ApiError, api, streamCompletion, type CompletionRequest } from '../lib/api';
import type { Attachment, Chat, Message, Mode, Source } from '../lib/types';

export interface ComposerOptions {
  mode: Mode;
  targetLanguage: string;
  webSearch: boolean;
}

export interface StreamState {
  chatId: string;
  assistantId: string;
  phase: 'connecting' | 'searching' | 'thinking' | 'streaming';
}

export interface ChatError {
  chatId: string;
  message: string;
  canRetry: boolean;
}

interface ChatsState {
  chats: Chat[];
  chatsLoaded: boolean;
  activeChatId: string | null;
  messages: Message[];
  loadingChat: boolean;
  stream: StreamState | null;
  error: ChatError | null;
  notice: string | null;

  loadChats: () => Promise<void>;
  openChat: (id: string) => Promise<boolean>;
  resetActive: () => void;
  /** Resolves with the chat id once the server accepted the message; rejects if it was not sent. */
  send: (content: string, attachments: Attachment[], opts: ComposerOptions) => Promise<string>;
  regenerate: (opts: ComposerOptions) => Promise<void>;
  editAndResend: (messageId: string, content: string, opts: ComposerOptions) => Promise<void>;
  stop: () => void;
  renameChat: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  clearChat: (id: string) => Promise<void>;
  deleteAll: () => Promise<void>;
  dismissError: () => void;
  /** Clears everything (used on sign-out). */
  reset: () => void;
}

let controller: AbortController | null = null;

const tempId = () => `tmp-${Math.random().toString(36).slice(2)}`;

export const useChats = create<ChatsState>((set, get) => {
  /** Shared streaming runner for send / regenerate / edit. */
  async function run(chatId: string, body: CompletionRequest, placeholderUserId: string | null, started?: (err: Error | null) => void) {
    controller?.abort();
    const ctrl = new AbortController();
    controller = ctrl;
    set({ stream: { chatId, assistantId: 'pending', phase: 'connecting' }, error: null, notice: null });

    // Batch deltas per animation frame to keep rendering smooth.
    let pending = '';
    let full = '';
    let sources: Source[] = [];
    let frame = 0;
    let assistantId = '';
    const streamingMessage = (): Message => ({
      id: assistantId,
      role: 'assistant',
      content: full,
      attachments: [],
      sources,
      mode: body.mode,
      status: 'streaming',
      createdAt: Date.now(),
    });
    const flush = () => {
      frame = 0;
      if (!pending || get().activeChatId !== chatId) return;
      const text = pending;
      pending = '';
      set((s) =>
        s.messages.some((m) => m.id === assistantId)
          ? { messages: s.messages.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)) }
          : // The user left and came back to this chat mid-stream: re-attach the live reply.
            { messages: s.loadingChat ? s.messages : [...s.messages, streamingMessage()] },
      );
    };

    const isActive = () => get().activeChatId === chatId;

    try {
      await streamCompletion(
        chatId,
        body,
        {
          onStart: ({ userMessage, assistantMessageId }) => {
            assistantId = assistantMessageId;
            started?.(null);
            if (!isActive()) return;
            set((s) => {
              const msgs = placeholderUserId
                ? s.messages.map((m) => (m.id === placeholderUserId ? userMessage : m))
                : s.messages.map((m) => (m.id === userMessage.id ? userMessage : m));
              return {
                stream: { chatId, assistantId, phase: 'thinking' },
                messages: [
                  ...msgs,
                  {
                    id: assistantId,
                    role: 'assistant',
                    content: '',
                    attachments: [],
                    sources: [],
                    mode: body.mode,
                    status: 'streaming',
                    createdAt: Date.now(),
                  },
                ],
              };
            });
          },
          onStatus: (state) => set((s) => (s.stream ? { stream: { ...s.stream, phase: state } } : s)),
          onSources: (found: Source[]) => {
            sources = found;
            if (isActive()) set((s) => ({ messages: s.messages.map((m) => (m.id === assistantId ? { ...m, sources: found } : m)) }));
          },
          onDelta: (text) => {
            pending += text;
            full += text;
            if (get().stream?.phase !== 'streaming') set((s) => (s.stream ? { stream: { ...s.stream, phase: 'streaming' } } : s));
            if (!frame) frame = requestAnimationFrame(flush);
          },
          onTitle: (title) => set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)) })),
          onNotice: (message) => set({ notice: message }),
          onDone: (message) => {
            if (frame) cancelAnimationFrame(frame);
            flush();
            if (message && isActive()) {
              set((s) => ({
                messages: s.messages.some((m) => m.id === assistantId)
                  ? s.messages.map((m) => (m.id === assistantId ? message : m))
                  : s.loadingChat
                    ? s.messages
                    : [...s.messages, message],
              }));
            }
          },
          onError: (message, persisted) => {
            if (frame) cancelAnimationFrame(frame);
            flush();
            if (isActive()) {
              set((s) => ({
                messages: persisted
                  ? s.messages.map((m) => (m.id === assistantId ? { ...m, status: 'error' } : m))
                  : s.messages.filter((m) => m.id !== assistantId),
                error: { chatId, message, canRetry: true },
              }));
            }
          },
        },
        ctrl.signal,
      );
    } catch (err) {
      if (frame) cancelAnimationFrame(frame);
      flush();
      if (ctrl.signal.aborted) {
        if (!assistantId && started) {
          // Cancelled before the server accepted it — undo and hand the draft back.
          set((s) => ({ messages: s.messages.filter((m) => m.id !== placeholderUserId) }));
          started(new Error('Cancelled.'));
        } else if (isActive()) {
          // Stopped by the user — keep partial content, mark as stopped.
          set((s) => ({
            messages: s.messages
              .map((m) => (m.id === assistantId ? { ...m, status: 'stopped' as const } : m))
              .filter((m) => !(m.id === assistantId && !m.content.trim())),
          }));
        }
      } else {
        const error = err instanceof Error ? err : new Error('Something went wrong.');
        if (!assistantId && started) {
          // Never reached the server's stream: undo the optimistic message and let the caller restore the draft.
          set((s) => ({ messages: s.messages.filter((m) => m.id !== placeholderUserId) }));
          started(error);
        } else if (isActive()) {
          const canRetry = !(err instanceof ApiError && (err.code === 'ai_not_configured' || err.code === 'validation'));
          set((s) => ({
            messages: s.messages.filter((m) => m.id !== assistantId || m.content),
            error: { chatId, message: error.message, canRetry },
          }));
        }
      }
    } finally {
      if (controller === ctrl) controller = null;
      set((s) => ({
        stream: s.stream?.chatId === chatId ? null : s.stream,
        chats: s.chats
          .map((c) => (c.id === chatId ? { ...c, updatedAt: Date.now() } : c))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
      }));
    }
  }

  return {
    chats: [],
    chatsLoaded: false,
    activeChatId: null,
    messages: [],
    loadingChat: false,
    stream: null,
    error: null,
    notice: null,

    loadChats: async () => {
      const { chats } = await api.listChats();
      set({ chats, chatsLoaded: true });
    },

    openChat: async (id) => {
      if (get().activeChatId === id) return true;
      set({ activeChatId: id, messages: [], loadingChat: true, error: null, notice: null });
      try {
        const { chat, messages } = await api.getChat(id);
        if (get().activeChatId !== id) return true;
        set((s) => ({
          messages,
          loadingChat: false,
          chats: s.chats.some((c) => c.id === id) ? s.chats.map((c) => (c.id === id ? chat : c)) : [chat, ...s.chats],
        }));
        return true;
      } catch {
        if (get().activeChatId === id) set({ activeChatId: null, loadingChat: false });
        return false;
      }
    },

    resetActive: () => set({ activeChatId: null, messages: [], error: null, notice: null, loadingChat: false }),

    send: async (content, attachments, opts) => {
      let chatId = get().activeChatId;
      if (!chatId) {
        const { chat } = await api.createChat();
        chatId = chat.id;
        set((s) => ({ chats: [chat, ...s.chats], activeChatId: chat.id, messages: [] }));
      }
      const placeholder: Message = {
        id: tempId(),
        role: 'user',
        content,
        attachments,
        sources: [],
        mode: opts.mode,
        status: 'pending',
        createdAt: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, placeholder] }));
      await new Promise<void>((resolve, reject) => {
        void run(
          chatId!,
          { action: 'send', content, attachments, mode: opts.mode, targetLanguage: opts.targetLanguage, webSearch: opts.webSearch },
          placeholder.id,
          (err) => (err ? reject(err) : resolve()),
        );
      });
      return chatId;
    },

    regenerate: async (opts) => {
      const chatId = get().activeChatId;
      if (!chatId || get().stream) return;
      set((s) => {
        const last = s.messages[s.messages.length - 1];
        return { messages: last?.role === 'assistant' ? s.messages.slice(0, -1) : s.messages };
      });
      const lastUser = [...get().messages].reverse().find((m) => m.role === 'user');
      await run(
        chatId,
        {
          action: 'regenerate',
          mode: (lastUser?.mode as Mode) ?? opts.mode,
          targetLanguage: opts.targetLanguage,
          webSearch: opts.webSearch,
        },
        null,
      );
    },

    editAndResend: async (messageId, content, opts) => {
      const chatId = get().activeChatId;
      if (!chatId || get().stream) return;
      set((s) => {
        const idx = s.messages.findIndex((m) => m.id === messageId);
        if (idx === -1) return s;
        return { messages: [...s.messages.slice(0, idx), { ...s.messages[idx], content }] };
      });
      await run(chatId, { action: 'edit', messageId, content, mode: opts.mode, targetLanguage: opts.targetLanguage, webSearch: opts.webSearch }, null);
    },

    stop: () => controller?.abort(),

    renameChat: async (id, title) => {
      const { chat } = await api.updateChat(id, { title });
      set((s) => ({ chats: s.chats.map((c) => (c.id === id ? chat : c)) }));
    },

    togglePin: async (id) => {
      const current = get().chats.find((c) => c.id === id);
      if (!current) return;
      const { chat } = await api.updateChat(id, { pinned: !current.pinned });
      set((s) => ({
        chats: s.chats
          .map((c) => (c.id === id ? chat : c))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
      }));
    },

    deleteChat: async (id) => {
      if (get().stream?.chatId === id) get().stop();
      await api.deleteChat(id);
      set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
      if (get().activeChatId === id) get().resetActive();
    },

    clearChat: async (id) => {
      if (get().stream?.chatId === id) get().stop();
      await api.clearChat(id);
      if (get().activeChatId === id) set({ messages: [], error: null });
    },

    deleteAll: async () => {
      get().stop();
      await api.deleteAllChats();
      set({ chats: [] });
      get().resetActive();
    },

    dismissError: () => set({ error: null }),

    reset: () => set({ chats: [], chatsLoaded: false, activeChatId: null, messages: [], loadingChat: false, stream: null, error: null, notice: null }),
  };
});
