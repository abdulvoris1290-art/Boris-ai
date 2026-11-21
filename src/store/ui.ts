import { create } from 'zustand';
import type { Theme } from '../lib/types';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export type SettingsTab = 'general' | 'personalization' | 'voice' | 'data' | 'account' | 'shortcuts';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

interface UIState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  settingsTab: SettingsTab | null;
  toasts: Toast[];
  confirm: ConfirmOptions | null;
  searchFocusTick: number;
  composerFocusTick: number;
  toggleSidebar: () => void;
  setMobileSidebar: (open: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  askConfirm: (opts: ConfirmOptions) => void;
  closeConfirm: () => void;
  focusSearch: () => void;
  focusComposer: () => void;
}

const readCollapsed = () => {
  try {
    return localStorage.getItem('voris-sidebar-collapsed') === '1';
  } catch {
    return false;
  }
};

let toastId = 0;

export const useUI = create<UIState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  mobileSidebarOpen: false,
  settingsTab: null,
  toasts: [],
  confirm: null,
  searchFocusTick: 0,
  composerFocusTick: 0,

  toggleSidebar: () => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      set({ mobileSidebarOpen: !get().mobileSidebarOpen });
      return;
    }
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem('voris-sidebar-collapsed', next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    set({ sidebarCollapsed: next });
  },
  setMobileSidebar: (open) => set({ mobileSidebarOpen: open }),
  openSettings: (tab = 'general') => set({ settingsTab: tab, mobileSidebarOpen: false }),
  closeSettings: () => set({ settingsTab: null }),

  toast: (message, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  askConfirm: (opts) => set({ confirm: opts }),
  closeConfirm: () => set({ confirm: null }),

  focusSearch: () => {
    if (window.matchMedia('(max-width: 768px)').matches) set({ mobileSidebarOpen: true });
    else if (get().sidebarCollapsed) get().toggleSidebar();
    set((s) => ({ searchFocusTick: s.searchFocusTick + 1 }));
  },
  focusComposer: () => set((s) => ({ composerFocusTick: s.composerFocusTick + 1 })),
}));

// ── Theme ───────────────────────────────────────────────────────────────────

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
let currentTheme: Theme = 'dark';

function paint() {
  const resolved = currentTheme === 'system' ? (media?.matches ? 'light' : 'dark') : currentTheme;
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f6f6fa' : '#07080d');
}

media?.addEventListener('change', () => currentTheme === 'system' && paint());

export function applyTheme(theme: Theme) {
  currentTheme = theme;
  try {
    localStorage.setItem('voris-theme', theme);
  } catch {
    /* storage unavailable */
  }
  paint();
}
