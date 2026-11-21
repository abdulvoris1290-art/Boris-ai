import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Keyboard,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { MOD, shortcutLabel } from '../../lib/constants';
import type { Chat } from '../../lib/types';
import { useAuth } from '../../store/auth';
import { useChats } from '../../store/chats';
import { useUI } from '../../store/ui';
import { Logo, LogoMark } from '../ui/Logo';
import { Menu } from '../ui/Menu';

function groupChats(chats: Chat[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t = startOfToday.getTime();
  const day = 86_400_000;
  const groups: { label: string; items: Chat[] }[] = [
    { label: 'Pinned', items: [] },
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Previous 30 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const c of chats) {
    if (c.pinned) groups[0].items.push(c);
    else if (c.updatedAt >= t) groups[1].items.push(c);
    else if (c.updatedAt >= t - day) groups[2].items.push(c);
    else if (c.updatedAt >= t - 7 * day) groups[3].items.push(c);
    else if (c.updatedAt >= t - 30 * day) groups[4].items.push(c);
    else groups[5].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || 'U';

function ChatItem({ chat, active, streaming }: { chat: Chat; active: boolean; streaming: boolean }) {
  const navigate = useNavigate();
  const renameChat = useChats((s) => s.renameChat);
  const togglePin = useChats((s) => s.togglePin);
  const deleteChat = useChats((s) => s.deleteChat);
  const askConfirm = useUI((s) => s.askConfirm);
  const toast = useUI((s) => s.toast);
  const setMobileSidebar = useUI((s) => s.setMobileSidebar);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(chat.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setValue(chat.title);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, chat.title]);

  const commit = async () => {
    const title = value.trim();
    setEditing(false);
    if (!title || title === chat.title) return;
    try {
      await renameChat(chat.id, title);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (editing) {
    return (
      <div className="chat-item editing">
        <input
          ref={inputRef}
          className="chat-rename-input"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          aria-label="Conversation title"
        />
      </div>
    );
  }

  return (
    <div className={`chat-item${active ? ' active' : ''}`}>
      <button
        className="chat-item-link"
        onClick={() => {
          navigate(`/c/${chat.id}`);
          setMobileSidebar(false);
        }}
        onDoubleClick={() => setEditing(true)}
        title={chat.title}
        aria-current={active ? 'page' : undefined}
      >
        {streaming && <span className="chat-item-live" aria-label="Generating" />}
        <span className="chat-item-title">{chat.title}</span>
      </button>
      <Menu
        width={190}
        trigger={({ toggle, ref, open }) => (
          <button ref={ref} className={`chat-item-more${open ? ' open' : ''}`} onClick={toggle} aria-label={`Options for ${chat.title}`}>
            <MoreHorizontal size={16} />
          </button>
        )}
        items={[
          { label: 'Rename', icon: <Pencil size={15} />, onSelect: () => setEditing(true) },
          {
            label: chat.pinned ? 'Unpin' : 'Pin to top',
            icon: chat.pinned ? <PinOff size={15} /> : <Pin size={15} />,
            onSelect: () => togglePin(chat.id).catch((e) => toast(e.message, 'error')),
          },
          {
            label: 'Delete',
            icon: <Trash2 size={15} />,
            danger: true,
            separatorBefore: true,
            onSelect: () =>
              askConfirm({
                title: 'Delete conversation?',
                message: `“${chat.title}” will be permanently deleted. This can’t be undone.`,
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: async () => {
                  await deleteChat(chat.id);
                  if (active) navigate('/');
                  toast('Conversation deleted', 'success');
                },
              }),
          },
        ]}
      />
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const chats = useChats((s) => s.chats);
  const chatsLoaded = useChats((s) => s.chatsLoaded);
  const activeChatId = useChats((s) => s.activeChatId);
  const streamChatId = useChats((s) => s.stream?.chatId);
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const mobileOpen = useUI((s) => s.mobileSidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setMobileSidebar = useUI((s) => s.setMobileSidebar);
  const openSettings = useUI((s) => s.openSettings);
  const focusSearch = useUI((s) => s.focusSearch);
  const searchFocusTick = useUI((s) => s.searchFocusTick);
  const focusComposer = useUI((s) => s.focusComposer);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Chat[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchFocusTick) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchFocusTick]);

  // Debounced server-side search across titles and message content.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = { cancelled: false };
    const t = setTimeout(async () => {
      try {
        const { chats } = await api.listChats(q);
        if (!ctrl.cancelled) setResults(chats);
      } catch {
        if (!ctrl.cancelled) setResults([]);
      } finally {
        if (!ctrl.cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // Keep search results in sync with renames / deletes.
  const visible = useMemo(() => {
    if (!results) return chats;
    const byId = new Map(chats.map((c) => [c.id, c]));
    return results.filter((r) => byId.has(r.id)).map((r) => byId.get(r.id)!);
  }, [results, chats]);
  const groups = useMemo(() => groupChats(visible), [visible]);

  const newChat = () => {
    navigate('/');
    setMobileSidebar(false);
    focusComposer();
  };

  const profileMenu = (
    <Menu
      side="top"
      align="start"
      width={248}
      header={
        <div className="menu-header">
          <div className="menu-header-name">{user.name}</div>
          <div className="menu-header-email">{user.email}</div>
        </div>
      }
      trigger={({ toggle, ref }) => (
        <button ref={ref} className={`profile-btn${collapsed ? ' compact' : ''}`} onClick={toggle} aria-label="Account menu">
          <span className="avatar">{initials(user.name)}</span>
          {!collapsed && (
            <span className="profile-meta">
              <span className="profile-name">{user.name}</span>
              <span className="profile-email">{user.email}</span>
            </span>
          )}
        </button>
      )}
      items={[
        { label: 'Settings', icon: <Settings size={15} />, hint: shortcutLabel(MOD, ','), onSelect: () => openSettings('general') },
        { label: 'Keyboard shortcuts', icon: <Keyboard size={15} />, onSelect: () => openSettings('shortcuts') },
        {
          label: 'Log out',
          icon: <LogOut size={15} />,
          separatorBefore: true,
          onSelect: async () => {
            useChats.getState().stop();
            await logout();
            navigate('/login', { replace: true });
          },
        },
      ]}
    />
  );

  return (
    <>
      <div className={`sidebar-backdrop${mobileOpen ? ' show' : ''}`} onClick={() => setMobileSidebar(false)} />
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`} aria-label="Sidebar">
        {collapsed ? (
          <div className="rail">
            <button className="rail-logo" onClick={newChat} aria-label="Voris AI — new chat">
              <LogoMark size={30} />
            </button>
            <button className="icon-btn" data-tip="Expand sidebar" onClick={toggleSidebar} aria-label="Expand sidebar">
              <PanelLeftOpen size={19} />
            </button>
            <button className="icon-btn" data-tip="New chat" onClick={newChat} aria-label="New chat">
              <SquarePen size={19} />
            </button>
            <button className="icon-btn" data-tip="Search" onClick={focusSearch} aria-label="Search conversations">
              <Search size={19} />
            </button>
            <div className="rail-spacer" />
            <button className="icon-btn" data-tip="Settings" onClick={() => openSettings('general')} aria-label="Settings">
              <Settings size={19} />
            </button>
            {profileMenu}
          </div>
        ) : (
          <div className="sidebar-inner">
            <div className="sidebar-top">
              <button className="sidebar-brand" onClick={newChat} aria-label="Voris AI home">
                <Logo size={28} />
              </button>
              <button className="icon-btn sidebar-collapse" onClick={toggleSidebar} aria-label="Collapse sidebar" data-tip="Collapse">
                <PanelLeftClose size={18} />
              </button>
              <button className="icon-btn sidebar-close-mobile" onClick={() => setMobileSidebar(false)} aria-label="Close sidebar">
                <X size={18} />
              </button>
            </div>

            <button className="new-chat-btn" onClick={newChat}>
              <SquarePen size={16} />
              <span>New chat</span>
              <kbd className="kbd-hint">{shortcutLabel(MOD, 'Shift', 'O')}</kbd>
            </button>

            <div className="sidebar-search">
              <Search size={15} className="sidebar-search-icon" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    searchRef.current?.blur();
                  }
                }}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
              {query ? (
                <button className="sidebar-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={14} />
                </button>
              ) : (
                <kbd className="kbd-hint">{shortcutLabel(MOD, 'K')}</kbd>
              )}
            </div>

            <nav className="chat-list" aria-label="Conversations">
              {!chatsLoaded ? (
                <div className="chat-list-skeleton">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ width: `${88 - i * 9}%` }} />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className="chat-list-empty">
                  {query ? (
                    searching ? (
                      <span className="spinner" />
                    ) : (
                      <>
                        <Search size={20} />
                        <p>No conversations match “{query}”.</p>
                      </>
                    )
                  ) : (
                    <>
                      <p className="chat-list-empty-title">No conversations yet</p>
                      <p>Your chats will appear here.</p>
                    </>
                  )}
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.label} className="chat-group">
                    <h3 className="chat-group-label">{g.label}</h3>
                    {g.items.map((c) => (
                      <ChatItem key={c.id} chat={c} active={c.id === activeChatId} streaming={c.id === streamChatId} />
                    ))}
                  </section>
                ))
              )}
            </nav>

            <div className="sidebar-bottom">
              <button className="sidebar-link" onClick={() => openSettings('general')}>
                <Settings size={16} />
                <span>Settings</span>
              </button>
              {profileMenu}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
