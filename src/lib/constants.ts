export const LANGUAGES = [
  'English', 'Uzbek', 'Russian', 'German', 'Turkish', 'Spanish', 'French', 'Italian', 'Portuguese', 'Arabic',
  'Chinese (Simplified)', 'Japanese', 'Korean', 'Hindi', 'Kazakh', 'Ukrainian', 'Polish', 'Dutch', 'Persian', 'Indonesian',
];

export const VOICE_LANGUAGES: { tag: string; label: string }[] = [
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'uz-UZ', label: 'Oʻzbekcha' },
  { tag: 'ru-RU', label: 'Русский' },
  { tag: 'de-DE', label: 'Deutsch' },
  { tag: 'tr-TR', label: 'Türkçe' },
  { tag: 'es-ES', label: 'Español' },
  { tag: 'fr-FR', label: 'Français' },
  { tag: 'it-IT', label: 'Italiano' },
  { tag: 'pt-BR', label: 'Português (BR)' },
  { tag: 'ar-SA', label: 'العربية' },
  { tag: 'zh-CN', label: '中文 (简体)' },
  { tag: 'ja-JP', label: '日本語' },
  { tag: 'ko-KR', label: '한국어' },
  { tag: 'hi-IN', label: 'हिन्दी' },
  { tag: 'kk-KZ', label: 'Қазақша' },
  { tag: 'uk-UA', label: 'Українська' },
];

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
/** Compact shortcut label: "⌘⇧O" on Mac, "Ctrl+Shift+O" elsewhere. */
export const shortcutLabel = (...keys: string[]) =>
  isMac ? keys.map((k) => (k === 'Shift' ? '⇧' : k)).join('') : keys.join('+');

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'], label: 'Search conversations' },
  { keys: [MOD, 'Shift', 'O'], label: 'New chat' },
  { keys: [MOD, 'B'], label: 'Toggle sidebar' },
  { keys: [MOD, ','], label: 'Open settings' },
  { keys: ['/'], label: 'Focus message box' },
  { keys: ['Enter'], label: 'Send message' },
  { keys: ['Shift', 'Enter'], label: 'New line' },
  { keys: ['Esc'], label: 'Stop generating / close dialog' },
];
