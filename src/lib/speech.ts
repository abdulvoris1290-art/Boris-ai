import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

// ── Speech-to-text (Web Speech API) ─────────────────────────────────────────

type SpeechRecognitionCtor = new () => any;

const getRecognitionCtor = (): SpeechRecognitionCtor | null =>
  typeof window === 'undefined' ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

export const speechRecognitionSupported = () => !!getRecognitionCtor();

/** Browsers only allow the microphone on HTTPS or localhost. */
export const voiceNeedsSecureContext = () => typeof window !== 'undefined' && !window.isSecureContext;

const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it from the address bar, then try again.',
  'service-not-allowed': 'Voice input is turned off in this browser’s settings.',
  'audio-capture': 'No microphone was found. Check that one is connected.',
  network: 'Voice input needs an internet connection in this browser.',
  'no-speech': 'I didn’t hear anything. Tap the microphone and try again.',
  'language-not-supported': 'Voice input isn’t available for the selected voice language. Choose another in Settings → Voice.',
};

export function useSpeechRecognition(opts: { lang: string; onFinal: (text: string) => void; onError: (msg: string) => void }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<any>(null);
  const interimRef = useRef('');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const updateInterim = (v: string) => {
    interimRef.current = v;
    setInterim(v);
  };

  /** Finish listening; any words still being recognized are delivered through onFinal. */
  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  /**
   * Stop immediately and discard late results. Returns the words that were
   * still being recognized so the caller can keep them.
   */
  const abort = useCallback((): string => {
    const rec = recRef.current;
    const pending = interimRef.current.trim();
    if (rec) {
      rec.onresult = null;
      rec.abort();
    }
    recRef.current = null;
    updateInterim('');
    setListening(false);
    return pending;
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return optsRef.current.onError('Voice input isn’t supported in this browser. Try Chrome, Edge or Safari.');
    if (voiceNeedsSecureContext()) return optsRef.current.onError('Voice input needs a secure (HTTPS) connection.');
    if (recRef.current) return;

    const rec = new Ctor();
    rec.lang = optsRef.current.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const transcript = String(r[0]?.transcript ?? '');
        if (r.isFinal) {
          if (transcript.trim()) optsRef.current.onFinal(transcript.trim());
        } else interimText += transcript;
      }
      updateInterim(interimText);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'aborted') return;
      optsRef.current.onError(RECOGNITION_ERRORS[e.error] ?? 'Voice input stopped unexpectedly. Please try again.');
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      updateInterim('');
      setListening(false);
    };

    try {
      rec.start();
    } catch {
      optsRef.current.onError('Couldn’t start the microphone. Please try again.');
      return;
    }
    recRef.current = rec;
    setListening(true);
  }, []);

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        rec.onresult = rec.onend = rec.onerror = null;
        rec.abort();
      }
    },
    [],
  );

  return { listening, interim, start, stop, abort, supported: speechRecognitionSupported() };
}

// ── Text-to-speech ──────────────────────────────────────────────────────────

export const speechSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/** Reads tables row by row ("Uzbek: Salom.") and gives list items and lines their own sentence. */
function structureForSpeech(md: string) {
  const end = (s: string) => (/[.!?:;,。！？]$/.test(s) ? s : `${s}.`);
  return md
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return '';
      if (/^\|?\s*:?-{3,}/.test(t)) return ''; // table separator row
      if (t.startsWith('|') || (t.includes(' | ') && t.split('|').length > 2)) {
        const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
        return cells.length ? end(cells.length === 2 ? `${cells[0]}: ${cells[1]}` : cells.join(', ')) : '';
      }
      return end(t);
    })
    .join('\n');
}

export function markdownToSpeech(md: string) {
  return structureForSpeech(md.replace(/```[\s\S]*?(```|$)/g, '\n'))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();
}

/**
 * Splits text into sentence-sized pieces. Chrome silently stops speaking
 * utterances longer than ~15 seconds, so long replies must be queued in parts.
 */
export function chunkForSpeech(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const raw of sentences) {
    let s = raw;
    while (s.length > max) {
      const cut = s.lastIndexOf(' ', max);
      const at = cut > max * 0.5 ? cut : max;
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(s.slice(0, at).trim());
      s = s.slice(at);
    }
    if ((current + s).length > max && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

let voices: SpeechSynthesisVoice[] = [];
if (speechSynthesisSupported()) {
  const load = () => (voices = window.speechSynthesis.getVoices());
  load();
  window.speechSynthesis.addEventListener?.('voiceschanged', load);
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (!voices.length && speechSynthesisSupported()) voices = window.speechSynthesis.getVoices();
  const want = lang.toLowerCase();
  const base = want.slice(0, 2);
  const exact = voices.filter((v) => v.lang.toLowerCase().replace('_', '-') === want);
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = exact.length ? exact : sameLang;
  // Prefer the higher-quality network / "natural" voices when the browser offers them.
  return pool.find((v) => /natural|neural|google|premium|enhanced/i.test(v.name)) ?? pool.find((v) => v.localService) ?? pool[0];
}

interface SpeakState {
  speakingId: string | null;
  speak: (id: string, markdown: string, lang: string) => void;
  stop: () => void;
}

let generation = 0;
let keepAlive: ReturnType<typeof setInterval> | null = null;

export const useSpeech = create<SpeakState>((set, get) => ({
  speakingId: null,
  speak: (id, markdown, lang) => {
    if (!speechSynthesisSupported()) return;
    const synth = window.speechSynthesis;
    const gen = ++generation;
    synth.cancel();
    if (keepAlive) clearInterval(keepAlive);

    const chunks = chunkForSpeech(markdownToSpeech(markdown));
    if (!chunks.length) return set({ speakingId: null });
    const voice = pickVoice(lang);

    const finish = () => {
      if (gen !== generation) return;
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      if (get().speakingId === id) set({ speakingId: null });
    };

    chunks.forEach((chunk, i) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      utter.lang = voice?.lang ?? lang;
      if (voice) utter.voice = voice;
      utter.rate = 1;
      if (i === chunks.length - 1) utter.onend = finish;
      utter.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') finish();
      };
      synth.speak(utter);
    });

    // Some Chrome builds pause long queues on their own; a periodic resume keeps them going.
    keepAlive = setInterval(() => {
      if (gen !== generation) return;
      if (!synth.speaking && !synth.pending) finish();
      else if (synth.paused) synth.resume();
    }, 5000);
    set({ speakingId: id });
  },
  stop: () => {
    generation++;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (speechSynthesisSupported()) window.speechSynthesis.cancel();
    set({ speakingId: null });
  },
}));

// Don't keep talking after the page is closed or reloaded.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => useSpeech.getState().stop());
