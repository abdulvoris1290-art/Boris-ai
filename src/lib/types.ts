export type Theme = 'dark' | 'light' | 'system';
export type Mode = 'chat' | 'write' | 'code' | 'translate';

export interface Preferences {
  theme: Theme;
  responseLanguage: string;
  customInstructions: string;
  voiceLanguage: string;
  sendOnEnter: boolean;
  autoTitle: boolean;
  autoSpeak: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  preferences: Preferences;
}

export interface AppConfig {
  ai: { configured: boolean; provider: string | null; model: string | null; vision: boolean; problem: string | null };
  search: { configured: boolean };
  auth: { signupOpen: boolean; hasUsers: boolean };
  limits: { maxMessageChars: number; maxImagesPerMessage: number; maxDocumentsPerMessage: number; maxDocumentChars: number };
}

export interface Chat {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export type Attachment =
  | { type: 'image'; name: string; mediaType: string; data: string }
  | { type: 'document'; name: string; mediaType: string; text: string; truncated?: boolean };

export interface Source {
  title: string;
  url: string;
  snippet: string;
}

export type MessageStatus = 'complete' | 'stopped' | 'error' | 'streaming' | 'pending';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: Attachment[];
  sources: Source[];
  mode: Mode | null;
  status: MessageStatus;
  createdAt: number;
}
