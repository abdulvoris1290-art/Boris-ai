import { create } from 'zustand';
import { api, onUnauthorized } from '../lib/api';
import { useChats } from './chats';
import type { AppConfig, Preferences, User } from '../lib/types';
import { applyTheme } from './ui';

interface AuthState {
  status: 'loading' | 'ready' | 'error';
  bootError: string | null;
  user: User | null;
  config: AppConfig | null;
  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  updateName: (name: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  bootError: null,
  user: null,
  config: null,

  boot: async () => {
    set({ status: 'loading', bootError: null });
    try {
      const [{ user }, config] = await Promise.all([api.me(), api.config()]);
      if (user) applyTheme(user.preferences.theme);
      set({ user, config, status: 'ready' });
    } catch (err) {
      set({ status: 'error', bootError: (err as Error).message });
    }
  },

  login: async (email, password) => {
    const { user } = await api.login(email, password);
    get().setUser(user);
  },

  signup: async (name, email, password) => {
    const { user } = await api.signup(name, email, password);
    get().setUser(user);
  },

  logout: async () => {
    useChats.getState().stop();
    await api.logout().catch(() => undefined);
    set({ user: null });
    useChats.getState().reset();
  },

  setUser: (user) => {
    if (user) applyTheme(user.preferences.theme);
    set({ user });
  },

  updatePreferences: async (patch) => {
    const prev = get().user;
    if (!prev) return;
    // Optimistic update
    get().setUser({ ...prev, preferences: { ...prev.preferences, ...patch } });
    try {
      const { user } = await api.updateMe({ preferences: patch });
      get().setUser(user);
    } catch (err) {
      // Roll back only the keys this call changed, so a later successful change isn't undone.
      const current = get().user;
      if (current) {
        const reverted = { ...current.preferences };
        for (const k of Object.keys(patch) as (keyof Preferences)[]) (reverted as Record<string, unknown>)[k] = prev.preferences[k];
        get().setUser({ ...current, preferences: reverted });
      }
      throw err;
    }
  },

  updateName: async (name) => {
    const { user } = await api.updateMe({ name });
    get().setUser(user);
  },
}));

// Session expired or was revoked on another device: return to the sign-in screen.
onUnauthorized(() => {
  if (!useAuth.getState().user) return;
  useChats.getState().stop();
  useAuth.setState({ user: null });
  useChats.getState().reset();
});
