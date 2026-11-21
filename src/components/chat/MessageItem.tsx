import { memo, useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Globe, Pencil, RefreshCw, Square, Volume2 } from 'lucide-react';
import { speechSynthesisSupported, useSpeech } from '../../lib/speech';
import type { Message } from '../../lib/types';
import type { StreamState } from '../../store/chats';
import { LogoMark } from '../ui/Logo';
import { Modal } from '../ui/Modal';
import { Markdown, copyText } from './Markdown';

interface Props {
  message: Message;
  isLast: boolean;
  stream: StreamState | null;
  busy: boolean;
  voiceLang: string;
  onRegenerate: () => void;
  onEdit: (id: string, content: string) => void;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-action"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      aria-label={label}
      data-tip={copied ? 'Copied!' : label}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function Attachments({ message }: { message: Message }) {
  const [preview, setPreview] = useState<string | null>(null);
  if (!message.attachments.length) return null;
  return (
    <div className="msg-attachments">
      {message.attachments.map((a, i) =>
        a.type === 'image' ? (
          <button key={i} className="msg-image" onClick={() => setPreview(`data:${a.mediaType};base64,${a.data}`)} aria-label={`View ${a.name}`}>
            {a.data ? <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} loading="lazy" /> : <span>{a.name}</span>}
          </button>
        ) : (
          <div key={i} className="file-chip" title={a.name}>
            <span className="file-chip-icon">
              <FileText size={16} />
            </span>
            <span className="file-chip-meta">
              <span className="file-chip-name">{a.name}</span>
              <span className="file-chip-sub">{a.mediaType === 'application/pdf' ? 'PDF' : 'Document'}{a.truncated ? ' · truncated' : ''}</span>
            </span>
          </div>
        ),
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Image preview" size="lg" className="image-modal">
        {preview && <img src={preview} alt="Attachment preview" className="image-preview" />}
      </Modal>
    </div>
  );
}

function UserMessage({ message, busy, onEdit }: Pick<Props, 'message' | 'busy' | 'onEdit'>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.content);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !taRef.current) return;
    const ta = taRef.current;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 360)}px`;
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      setValue(message.content);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      });
    }
  }, [editing, message.content]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    setEditing(false);
    if (v !== message.content) onEdit(message.id, v);
  };

  return (
    <div className="msg msg-user">
      <Attachments message={message} />
      {editing ? (
        <div className="msg-edit">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            aria-label="Edit message"
          />
          <div className="msg-edit-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={!value.trim()}>
              Send
            </button>
          </div>
        </div>
      ) : (
        message.content && <div className="msg-bubble">{message.content}</div>
      )}
      {!editing && message.status !== 'pending' && (
        <div className="msg-actions msg-actions-user">
          {message.content && <CopyButton text={message.content} />}
          {!busy && message.content && (
            <button className="msg-action" onClick={() => setEditing(true)} aria-label="Edit message" data-tip="Edit">
              <Pencil size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator({ phase }: { phase: StreamState['phase'] }) {
  return (
    <div className="thinking" role="status">
      <span className="thinking-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="thinking-label">{phase === 'searching' ? 'Searching the web' : 'Thinking'}</span>
    </div>
  );
}

function AssistantMessage({ message, isLast, stream, busy, voiceLang, onRegenerate }: Omit<Props, 'onEdit'>) {
  const speakingId = useSpeech((s) => s.speakingId);
  const speak = useSpeech((s) => s.speak);
  const stopSpeaking = useSpeech((s) => s.stop);
  const isStreaming = message.status === 'streaming' && stream?.assistantId === message.id;
  const speaking = speakingId === message.id;

  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar" aria-hidden="true">
        <LogoMark size={28} />
      </div>
      <div className="msg-body">
        {message.sources.length > 0 && (
          <div className="sources">
            <span className="sources-label">
              <Globe size={13} /> Sources
            </span>
            {message.sources.map((s, i) => (
              <a key={i} className="source-chip" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
                <span className="source-num">{i + 1}</span>
                <span className="source-host">{hostname(s.url)}</span>
              </a>
            ))}
          </div>
        )}

        {isStreaming && !message.content ? (
          <ThinkingIndicator phase={stream!.phase} />
        ) : (
          <div className={isStreaming ? 'streaming' : undefined}>
            <Markdown content={message.content} sources={message.sources} />
          </div>
        )}

        {message.status === 'stopped' && <span className="msg-tag">Stopped</span>}
        {message.status === 'error' && <span className="msg-tag msg-tag-error">Incomplete response</span>}

        {!isStreaming && message.content && (
          <div className="msg-actions">
            <CopyButton text={message.content} />
            {speechSynthesisSupported() && (
              <button
                className={`msg-action${speaking ? ' active' : ''}`}
                onClick={() => (speaking ? stopSpeaking() : speak(message.id, message.content, voiceLang))}
                aria-label={speaking ? 'Stop reading' : 'Read aloud'}
                data-tip={speaking ? 'Stop' : 'Read aloud'}
              >
                {speaking ? <Square size={14} /> : <Volume2 size={15} />}
              </button>
            )}
            {isLast && !busy && (
              <button className="msg-action" onClick={onRegenerate} aria-label="Regenerate response" data-tip="Regenerate">
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem(props: Props) {
  return props.message.role === 'user' ? (
    <UserMessage message={props.message} busy={props.busy} onEdit={props.onEdit} />
  ) : (
    <AssistantMessage {...props} />
  );
});
