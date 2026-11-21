import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Code2,
  FileText,
  Globe,
  Languages,
  Loader2,
  Mic,
  Paperclip,
  PenLine,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { LANGUAGES } from '../../lib/constants';
import { ACCEPT_ATTR, isImageFile, processFile } from '../../lib/files';
import { useSpeech, useSpeechRecognition } from '../../lib/speech';
import type { AppConfig, Attachment, Mode } from '../../lib/types';
import type { ComposerOptions } from '../../store/chats';
import { useUI } from '../../store/ui';
import { Menu } from '../ui/Menu';

export interface ComposerHandle {
  prefill: (text: string) => void;
  openFilePicker: () => void;
  addFiles: (files: File[]) => void;
  focus: () => void;
  restore: (text: string, attachments: Attachment[]) => void;
}

interface PendingFile {
  id: string;
  name: string;
  status: 'processing' | 'ready';
  attachment?: Attachment;
  preview?: string;
}

interface Props {
  config: AppConfig;
  options: ComposerOptions;
  setOptions: (o: ComposerOptions) => void;
  streaming: boolean;
  sendOnEnter: boolean;
  voiceLang: string;
  /** `viaVoice` is true when the message was dictated with the microphone. */
  onSubmit: (content: string, attachments: Attachment[], viaVoice: boolean) => Promise<boolean>;
  onStop: () => void;
}

const MODE_META: Record<Exclude<Mode, 'chat'>, { label: string; icon: typeof PenLine; placeholder: string }> = {
  write: { label: 'Writing', icon: PenLine, placeholder: 'What should I write, rewrite or summarize?' },
  code: { label: 'Coding', icon: Code2, placeholder: 'Describe the code you need, or paste code to debug…' },
  translate: { label: 'Translate', icon: Languages, placeholder: 'Enter text to translate…' },
};

let fileSeq = 0;

/** Phones and tablets: an on-screen keyboard where Return should insert a line break. */
const isTouchKeyboard = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { config, options, setOptions, streaming, sendOnEnter, voiceLang, onSubmit, onStop },
  ref,
) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useUI((s) => s.toast);
  const composerFocusTick = useUI((s) => s.composerFocusTick);
  const limits = config.limits;

  const resize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
  }, []);
  useEffect(resize, [text, resize]);

  useEffect(() => {
    if (composerFocusTick) taRef.current?.focus();
  }, [composerFocusTick]);

  const addFiles = useCallback(
    (list: File[]) => {
      if (!list.length) return;
      const imageCount = files.filter((f) => f.attachment?.type === 'image' || f.preview).length;
      const docCount = files.length - imageCount;
      let imgs = 0;
      let docs = 0;
      for (const file of list) {
        const isImg = isImageFile(file);
        if (isImg && !config.ai.vision) {
          toast('The connected AI model doesn’t support images.', 'error');
          continue;
        }
        if (isImg && imageCount + ++imgs > limits.maxImagesPerMessage) {
          toast(`You can attach up to ${limits.maxImagesPerMessage} images per message.`, 'error');
          continue;
        }
        if (!isImg && docCount + ++docs > limits.maxDocumentsPerMessage) {
          toast(`You can attach up to ${limits.maxDocumentsPerMessage} documents per message.`, 'error');
          continue;
        }
        const id = `f${++fileSeq}`;
        const preview = isImg ? URL.createObjectURL(file) : undefined;
        setFiles((prev) => [...prev, { id, name: file.name, status: 'processing', preview }]);
        processFile(file, limits.maxDocumentChars)
          .then((attachment) => {
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'ready', attachment } : f)));
            if (attachment.type === 'document' && attachment.truncated) toast(`“${file.name}” is long — only the first part will be analyzed.`, 'info');
          })
          .catch((err) => {
            setFiles((prev) => prev.filter((f) => f.id !== id));
            if (preview) URL.revokeObjectURL(preview);
            toast(err.message, 'error');
          });
      }
      taRef.current?.focus();
    },
    [files, config.ai.vision, limits, toast],
  );

  const removeFile = (id: string) =>
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return prev.filter((x) => x.id !== id);
    });

  useImperativeHandle(ref, () => ({
    prefill: (t) => {
      setText(t);
      taRef.current?.focus();
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(t.length, t.length);
        }
      });
    },
    openFilePicker: () => fileRef.current?.click(),
    addFiles,
    focus: () => taRef.current?.focus(),
    restore: (t, atts) => {
      setText(t);
      setFiles(
        atts.map((a) => ({
          id: `f${++fileSeq}`,
          name: a.name,
          status: 'ready',
          attachment: a,
          preview: a.type === 'image' ? `data:${a.mediaType};base64,${a.data}` : undefined,
        })),
      );
    },
  }));

  // Voice input
  const usedVoice = useRef(false);
  const appendText = (t: string) => setText((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${t}` : prev + t));
  const speech = useSpeechRecognition({
    lang: voiceLang,
    onFinal: (t) => {
      usedVoice.current = true;
      appendText(t);
    },
    onError: (m) => toast(m, 'error'),
  });
  const stopSpeaking = useSpeech((s) => s.stop);
  const toggleMic = () => {
    if (speech.listening) return speech.stop();
    stopSpeaking(); // don't let the microphone hear Voris reading aloud
    speech.start();
    taRef.current?.focus();
  };

  const processing = files.some((f) => f.status === 'processing');
  const ready = files.filter((f) => f.status === 'ready' && f.attachment).map((f) => f.attachment!);
  const overLimit = text.length > limits.maxMessageChars;
  const hasText = text.trim().length > 0 || (speech.listening && speech.interim.trim().length > 0);
  const canSend = config.ai.configured && !streaming && !submitting && !processing && !overLimit && (hasText || ready.length > 0);

  const submit = async () => {
    if (!canSend) return;
    let content = text.trim();
    if (speech.listening) {
      // Keep words that were still being recognized, and drop any late results.
      const pending = speech.abort();
      if (pending) {
        content = content ? `${content} ${pending}` : pending;
        usedVoice.current = true;
      }
    }
    const viaVoice = usedVoice.current;
    usedVoice.current = false;
    const snapshot = files;
    setSubmitting(true);
    setText('');
    setFiles([]);
    stopSpeaking();
    const ok = await onSubmit(content, ready, viaVoice);
    setSubmitting(false);
    if (!ok) {
      // Restore the draft so nothing is lost.
      setText(content);
      setFiles(snapshot);
    } else {
      snapshot.forEach((f) => f.preview?.startsWith('blob:') && URL.revokeObjectURL(f.preview));
    }
  };

  const setMode = (mode: Mode) => setOptions({ ...options, mode: options.mode === mode ? 'chat' : mode });
  const modeMeta = options.mode !== 'chat' ? MODE_META[options.mode] : null;
  const placeholder = speech.listening
    ? 'Listening…'
    : !config.ai.configured
      ? 'AI provider not connected — see setup instructions above'
      : options.webSearch
        ? 'Ask anything — Voris will search the web…'
        : (modeMeta?.placeholder ?? 'Message Voris AI…');

  return (
    <div className={`composer${speech.listening ? ' listening' : ''}`}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      {files.length > 0 && (
        <div className="composer-files">
          {files.map((f) =>
            f.preview ? (
              <div key={f.id} className="composer-thumb" title={f.name}>
                <img src={f.preview} alt={f.name} />
                {f.status === 'processing' && (
                  <span className="composer-thumb-loading">
                    <Loader2 size={16} className="spin" />
                  </span>
                )}
                <button className="composer-file-remove" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div key={f.id} className="file-chip composer-doc" title={f.name}>
                <span className="file-chip-icon">{f.status === 'processing' ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}</span>
                <span className="file-chip-meta">
                  <span className="file-chip-name">{f.name}</span>
                  <span className="file-chip-sub">{f.status === 'processing' ? 'Reading…' : 'Ready'}</span>
                </span>
                <button className="composer-file-remove" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                  <X size={12} />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      <textarea
        ref={taRef}
        className="composer-input"
        value={speech.listening && speech.interim ? `${text}${text ? ' ' : ''}${speech.interim}` : text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value) usedVoice.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            // On touch keyboards Return adds a new line; the send button sends.
            const shouldSend = sendOnEnter && !isTouchKeyboard() ? !e.shiftKey : e.metaKey || e.ctrlKey;
            if (shouldSend) {
              e.preventDefault();
              submit();
            }
          }
        }}
        onPaste={(e) => {
          const pasted = [...e.clipboardData.files];
          if (pasted.length) {
            e.preventDefault();
            addFiles(pasted);
          }
        }}
        placeholder={placeholder}
        rows={1}
        aria-label="Message"
        readOnly={speech.listening}
      />

      <div className="composer-toolbar">
        <div className="composer-tools">
          <Menu
            side="top"
            align="start"
            width={250}
            trigger={({ toggle, ref, open }) => (
              <button ref={ref} className={`icon-btn composer-plus${open ? ' active' : ''}`} onClick={toggle} aria-label="Tools and attachments" data-tip="Tools">
                <Plus size={19} />
              </button>
            )}
            items={[
              { label: 'Attach files or images', icon: <Paperclip size={15} />, onSelect: () => fileRef.current?.click() },
              {
                label: 'Web search',
                icon: <Globe size={15} />,
                checked: options.webSearch,
                disabled: !config.search.configured,
                hint: config.search.configured ? (options.webSearch ? 'On' : undefined) : 'Not configured',
                onSelect: () => setOptions({ ...options, webSearch: !options.webSearch }),
                separatorBefore: true,
              },
              { label: 'Writing assistant', icon: <PenLine size={15} />, checked: options.mode === 'write', onSelect: () => setMode('write') },
              { label: 'Coding assistant', icon: <Code2 size={15} />, checked: options.mode === 'code', onSelect: () => setMode('code') },
              { label: 'Translate', icon: <Languages size={15} />, checked: options.mode === 'translate', onSelect: () => setMode('translate') },
            ]}
          />

          {modeMeta && (
            <span className="tool-chip">
              <modeMeta.icon size={14} />
              <span>{modeMeta.label}</span>
              {options.mode === 'translate' && (
                <select
                  className="tool-chip-select"
                  value={options.targetLanguage}
                  onChange={(e) => setOptions({ ...options, targetLanguage: e.target.value })}
                  aria-label="Translate into"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      → {l}
                    </option>
                  ))}
                </select>
              )}
              <button className="tool-chip-x" onClick={() => setOptions({ ...options, mode: 'chat' })} aria-label={`Turn off ${modeMeta.label}`}>
                <X size={12} />
              </button>
            </span>
          )}
          {options.webSearch && (
            <span className="tool-chip tool-chip-blue">
              <Globe size={14} />
              <span>Search</span>
              <button className="tool-chip-x" onClick={() => setOptions({ ...options, webSearch: false })} aria-label="Turn off web search">
                <X size={12} />
              </button>
            </span>
          )}
        </div>

        <div className="composer-actions">
          {text.length > limits.maxMessageChars * 0.8 && (
            <span className={`char-count${overLimit ? ' over' : ''}`}>
              {text.length.toLocaleString()} / {limits.maxMessageChars.toLocaleString()}
            </span>
          )}
          {speech.supported && (
            <button
              className={`icon-btn mic-btn${speech.listening ? ' recording' : ''}`}
              onClick={toggleMic}
              aria-label={speech.listening ? 'Stop voice input' : 'Voice input'}
              aria-pressed={speech.listening}
              data-tip={speech.listening ? 'Stop listening' : 'Voice input'}
            >
              <Mic size={18} />
            </button>
          )}
          {streaming ? (
            <button className="send-btn stop" onClick={onStop} aria-label="Stop generating" data-tip="Stop (Esc)">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={!canSend} aria-label="Send message" data-tip="Send">
              {submitting ? <Loader2 size={18} className="spin" /> : processing ? <Loader2 size={18} className="spin" /> : <ArrowUp size={18} strokeWidth={2.4} />}
            </button>
          )}
        </div>
      </div>
      {speech.listening && (
        <div className="listening-bar" aria-live="polite">
          <span className="listening-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="listening-text">{speech.interim ? 'Listening…' : 'Listening… speak now'}</span>
          <button className="listening-done" onClick={speech.stop}>
            <Check size={13} /> Done
          </button>
        </div>
      )}
    </div>
  );
});
