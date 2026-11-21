import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  Download,
  Eraser,
  Menu as MenuIcon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { useSpeech } from '../../lib/speech';
import type { Attachment, Message } from '../../lib/types';
import { useAuth } from '../../store/auth';
import { useChats, type ComposerOptions } from '../../store/chats';
import { useUI } from '../../store/ui';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Composer, type ComposerHandle } from './Composer';
import { MessageItem } from './MessageItem';
import { SuggestionGrid, WelcomeHero, type Suggestion } from './Welcome';

function exportMarkdown(title: string, messages: Message[]) {
  const body = messages
    .map((m) => {
      const who = m.role === 'user' ? '**You**' : '**Voris AI**';
      const files = m.attachments.length ? `\n\n_Attachments: ${m.attachments.map((a) => a.name).join(', ')}_` : '';
      const sources = m.sources.length ? `\n\nSources:\n${m.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}` : '';
      return `${who}\n\n${m.content}${files}${sources}`;
    })
    .join('\n\n---\n\n');
  const blob = new Blob([`# ${title}\n\n${body}\n`], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'conversation'}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function RenameDialog({ open, initial, onClose, onSave }: { open: boolean; initial: string; onClose: () => void; onSave: (t: string) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Modal open={open} onClose={onClose} title="Rename conversation" size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setBusy(true);
          try {
            await onSave(value.trim());
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus aria-label="Title" />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ChatView() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const config = useAuth((s) => s.config)!;
  const prefs = user.preferences;

  const chats = useChats((s) => s.chats);
  const activeChatId = useChats((s) => s.activeChatId);
  const messages = useChats((s) => s.messages);
  const loadingChat = useChats((s) => s.loadingChat);
  const stream = useChats((s) => s.stream);
  const error = useChats((s) => s.error);
  const notice = useChats((s) => s.notice);
  const { openChat, resetActive, send, regenerate, editAndResend, stop, renameChat, togglePin, deleteChat, clearChat, dismissError } = useChats.getState();

  const toast = useUI((s) => s.toast);
  const askConfirm = useUI((s) => s.askConfirm);
  const setMobileSidebar = useUI((s) => s.setMobileSidebar);

  const [options, setOptions] = useState<ComposerOptions>({ mode: 'chat', targetLanguage: 'English', webSearch: false });
  const [renameOpen, setRenameOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const dragDepth = useRef(0);
  const speakReplyRef = useRef<string | null>(null);

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const streamingHere = !!stream && stream.chatId === activeChatId;
  const isEmpty = !chatId && messages.length === 0;

  // Sync route → store.
  useEffect(() => {
    const state = useChats.getState();
    if (!chatId) {
      resetActive();
      return;
    }
    if (chatId !== state.activeChatId) {
      openChat(chatId).then((ok) => {
        if (!ok) {
          toast('That conversation could not be found.', 'error');
          navigate('/', { replace: true });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    document.title = chat ? `${chat.title} · Voris AI` : 'Voris AI';
  }, [chat]);

  // Stop reading aloud when leaving a conversation.
  useEffect(() => {
    speakReplyRef.current = null;
    return () => useSpeech.getState().stop();
  }, [activeChatId]);

  // Voice conversation: when a question was asked by voice, read the answer aloud once it is complete.
  useEffect(() => {
    if (stream || !speakReplyRef.current) return;
    const wanted = speakReplyRef.current;
    speakReplyRef.current = null;
    const last = messages[messages.length - 1];
    if (wanted === activeChatId && last?.role === 'assistant' && last.status === 'complete' && last.content.trim()) {
      useSpeech.getState().speak(last.id, last.content, prefs.voiceLanguage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // Auto-scroll while the user is at the bottom.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = near;
    setAtBottom(near);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, error]);
  useEffect(() => {
    stickRef.current = true;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [activeChatId, loadingChat]);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    stickRef.current = true;
  };

  const handleSubmit = useCallback(
    async (content: string, attachments: Attachment[], viaVoice: boolean) => {
      stickRef.current = true;
      try {
        const id = await send(content, attachments, options);
        if (viaVoice && prefs.autoSpeak) speakReplyRef.current = id;
        if (!chatId) navigate(`/c/${id}`);
        return true;
      } catch (err) {
        if ((err as Error).message !== 'Cancelled.') toast((err as Error).message, 'error');
        return false;
      }
    },
    [send, options, chatId, navigate, toast, prefs.autoSpeak],
  );

  const onRegenerate = useCallback(() => {
    stickRef.current = true;
    regenerate(options);
  }, [regenerate, options]);

  const onEdit = useCallback(
    (id: string, content: string) => {
      stickRef.current = true;
      editAndResend(id, content, options);
    },
    [editAndResend, options],
  );

  const pickSuggestion = (s: Suggestion) => {
    setOptions((o) => ({ ...o, mode: s.mode }));
    composerRef.current?.prefill(s.prompt);
    if (s.attach) composerRef.current?.openFilePicker();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) composerRef.current?.addFiles(files);
  };

  const confirmClear = () =>
    chat &&
    askConfirm({
      title: 'Clear conversation?',
      message: 'All messages in this conversation will be removed. The conversation itself will stay in your history.',
      confirmLabel: 'Clear messages',
      danger: true,
      onConfirm: async () => {
        await clearChat(chat.id);
        toast('Conversation cleared', 'success');
      },
    });

  const confirmDelete = () =>
    chat &&
    askConfirm({
      title: 'Delete conversation?',
      message: `“${chat.title}” will be permanently deleted. This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await deleteChat(chat.id);
        navigate('/');
        toast('Conversation deleted', 'success');
      },
    });

  const lastIndex = messages.length - 1;

  return (
    <main
      className="chat"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="chat-header">
        <div className="chat-header-left">
          <button className="icon-btn mobile-only" onClick={() => setMobileSidebar(true)} aria-label="Open sidebar">
            <MenuIcon size={20} />
          </button>
          <h1 className="chat-title" title={chat?.title}>
            {chat ? chat.title : chatId ? '' : 'New chat'}
          </h1>
        </div>
        <div className="chat-header-right">
          {config.ai.configured ? (
            <span className="model-badge" title={`${config.ai.provider} · ${config.ai.model}`}>
              <span className="model-dot" />
              {config.ai.model}
            </span>
          ) : (
            <span className="model-badge offline" title={config.ai.problem ?? ''}>
              <span className="model-dot" />
              Not connected
            </span>
          )}
          <button className="icon-btn mobile-only" onClick={() => navigate('/')} aria-label="New chat">
            <SquarePen size={19} />
          </button>
          {chat && (
            <Menu
              width={220}
              trigger={({ toggle, ref }) => (
                <button ref={ref} className="icon-btn" onClick={toggle} aria-label="Conversation options" data-tip="Options">
                  <MoreHorizontal size={19} />
                </button>
              )}
              items={[
                { label: 'Rename', icon: <Pencil size={15} />, onSelect: () => setRenameOpen(true) },
                {
                  label: chat.pinned ? 'Unpin' : 'Pin to top',
                  icon: chat.pinned ? <PinOff size={15} /> : <Pin size={15} />,
                  onSelect: () => togglePin(chat.id).catch((e) => toast(e.message, 'error')),
                },
                {
                  label: 'Export as Markdown',
                  icon: <Download size={15} />,
                  disabled: messages.length === 0,
                  onSelect: () => exportMarkdown(chat.title, messages),
                },
                { label: 'Clear conversation', icon: <Eraser size={15} />, separatorBefore: true, disabled: messages.length === 0, onSelect: confirmClear },
                { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: confirmDelete },
              ]}
            />
          )}
        </div>
      </header>

      <div className={`chat-body${isEmpty ? ' empty' : ''}`}>
        <div className="messages-scroll" ref={scrollRef} onScroll={onScroll}>
          {isEmpty ? (
            <WelcomeHero name={user.name} config={config} />
          ) : loadingChat ? (
            <div className="messages">
              <div className="msg-skeleton right"><div className="skeleton" /></div>
              <div className="msg-skeleton"><div className="skeleton" /><div className="skeleton" /><div className="skeleton short" /></div>
            </div>
          ) : (
            <div className="messages" role="log" aria-live="polite" aria-busy={streamingHere}>
              {messages.length === 0 && !streamingHere && (
                <div className="messages-empty">
                  <p>This conversation is empty. Send a message to start.</p>
                </div>
              )}
              {messages.map((m, i) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  isLast={i === lastIndex}
                  stream={m.role === 'assistant' && i === lastIndex ? stream : null}
                  busy={streamingHere}
                  voiceLang={prefs.voiceLanguage}
                  onRegenerate={onRegenerate}
                  onEdit={onEdit}
                />
              ))}
              {streamingHere && stream?.phase === 'connecting' && (
                <div className="msg msg-assistant pending-assistant">
                  <div className="thinking"><span className="thinking-dots"><i /><i /><i /></span></div>
                </div>
              )}
              {error && error.chatId === activeChatId && (
                <div className="chat-error" role="alert">
                  <AlertCircle size={17} />
                  <span>{error.message}</span>
                  <div className="chat-error-actions">
                    {error.canRetry && messages.some((m) => m.role === 'user') && (
                      <button className="btn btn-sm btn-secondary" onClick={onRegenerate}>
                        <RefreshCw size={14} /> Retry
                      </button>
                    )}
                    <button className="icon-btn" onClick={dismissError} aria-label="Dismiss error">
                      <X size={15} />
                    </button>
                  </div>
                </div>
              )}
              {notice && !streamingHere && <p className="chat-notice">{notice}</p>}
            </div>
          )}
        </div>

        <div className="composer-dock">
          {!atBottom && !isEmpty && (
            <button className="scroll-bottom" onClick={scrollToBottom} aria-label="Scroll to latest message">
              <ArrowDown size={17} />
            </button>
          )}
          <Composer
            ref={composerRef}
            config={config}
            options={options}
            setOptions={setOptions}
            streaming={streamingHere}
            sendOnEnter={prefs.sendOnEnter}
            voiceLang={prefs.voiceLanguage}
            onSubmit={handleSubmit}
            onStop={stop}
          />
          {isEmpty && <SuggestionGrid onPick={pickSuggestion} />}
          <p className="disclaimer">Voris AI can make mistakes. Verify important information.</p>
        </div>
      </div>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Paperclip size={26} />
            <p>Drop files to attach</p>
            <span>Images, PDFs and text or code files</span>
          </div>
        </div>
      )}

      {chat && <RenameDialog open={renameOpen} initial={chat.title} onClose={() => setRenameOpen(false)} onSave={(t) => renameChat(chat.id, t).catch((e) => toast(e.message, 'error'))} />}
    </main>
  );
}
