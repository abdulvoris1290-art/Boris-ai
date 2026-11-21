import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChats } from '../../store/chats';
import { useUI } from '../../store/ui';
import { ChatView } from '../chat/ChatView';
import { SettingsModal } from '../settings/SettingsModal';
import { hasOpenLayer } from '../ui/layers';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const navigate = useNavigate();
  const loadChats = useChats((s) => s.loadChats);
  const toast = useUI((s) => s.toast);

  useEffect(() => {
    loadChats().catch((err) => toast(err.message, 'error'));
  }, [loadChats, toast]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const ui = useUI.getState();
      const key = e.key.toLowerCase();
      // While a dialog or menu is open, it owns the keyboard.
      if (hasOpenLayer()) return;
      if (mod && key === 'k') {
        e.preventDefault();
        ui.focusSearch();
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault();
        navigate('/');
        ui.focusComposer();
      } else if (mod && key === 'b') {
        e.preventDefault();
        ui.toggleSidebar();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        ui.openSettings('general');
      } else if (e.key === 'Escape' && useChats.getState().stream) {
        useChats.getState().stop();
      } else if (e.key === '/' && !mod) {
        const el = document.activeElement as HTMLElement | null;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!typing) {
          e.preventDefault();
          ui.focusComposer();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="app">
      <Sidebar />
      <ChatView />
      <SettingsModal />
    </div>
  );
}
