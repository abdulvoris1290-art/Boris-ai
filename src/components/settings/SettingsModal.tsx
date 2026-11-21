import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu,
  Database,
  Download,
  Keyboard,
  LogOut,
  Mic,
  Monitor,
  Moon,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  User as UserIcon,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { LANGUAGES, SHORTCUTS, VOICE_LANGUAGES } from '../../lib/constants';
import { speechRecognitionSupported, speechSynthesisSupported, useSpeech, voiceNeedsSecureContext } from '../../lib/speech';
import type { Preferences, Theme } from '../../lib/types';
import { useAuth } from '../../store/auth';
import { useChats } from '../../store/chats';
import { useUI, type SettingsTab } from '../../store/ui';
import { Modal } from '../ui/Modal';

const TABS: { id: SettingsTab; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'personalization', label: 'Personalization', icon: Sparkles },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'data', label: 'Data & privacy', icon: Database },
  { id: 'account', label: 'Account', icon: UserIcon },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
];

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {description && <div className="setting-desc">{description}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-thumb" />
    </button>
  );
}

function usePrefSetter() {
  const update = useAuth((s) => s.updatePreferences);
  const toast = useUI((s) => s.toast);
  return (patch: Partial<Preferences>) => update(patch).catch((e) => toast(e.message, 'error'));
}

function GeneralTab() {
  const prefs = useAuth((s) => s.user!.preferences);
  const config = useAuth((s) => s.config!);
  const set = usePrefSetter();
  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'system', label: 'System', icon: Monitor },
  ];
  return (
    <>
      <Row label="Theme" description="Choose how Voris AI looks to you.">
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {themes.map((t) => (
            <button key={t.id} role="radio" aria-checked={prefs.theme === t.id} className={prefs.theme === t.id ? 'active' : ''} onClick={() => set({ theme: t.id })}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Response language" description="Auto replies in the language you write in.">
        <select className="select" value={prefs.responseLanguage} onChange={(e) => set({ responseLanguage: e.target.value })}>
          <option value="auto">Auto-detect</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Send with Enter" description={prefs.sendOnEnter ? 'Enter sends, Shift + Enter adds a new line.' : 'Ctrl/⌘ + Enter sends, Enter adds a new line.'}>
        <Toggle checked={prefs.sendOnEnter} onChange={(v) => set({ sendOnEnter: v })} label="Send with Enter" />
      </Row>
      <Row label="Smart titles" description="Let the AI name new conversations automatically.">
        <Toggle checked={prefs.autoTitle} onChange={(v) => set({ autoTitle: v })} label="Smart titles" />
      </Row>
      <div className="engine-card">
        <Cpu size={18} />
        <div>
          <div className="engine-title">AI engine</div>
          {config.ai.configured ? (
            <div className="engine-desc">
              <span className="status-dot ok" /> Connected · {config.ai.provider} · <code>{config.ai.model}</code>
              {config.ai.vision ? ' · image understanding on' : ''}
            </div>
          ) : (
            <div className="engine-desc">
              <span className="status-dot off" /> Not connected — {config.ai.problem}
            </div>
          )}
          <div className="engine-desc">
            <span className={`status-dot ${config.search.configured ? 'ok' : 'off'}`} /> Web search {config.search.configured ? 'available' : 'not configured'}
          </div>
        </div>
      </div>
    </>
  );
}

function PersonalizationTab() {
  const prefs = useAuth((s) => s.user!.preferences);
  const update = useAuth((s) => s.updatePreferences);
  const toast = useUI((s) => s.toast);
  const [value, setValue] = useState(prefs.customInstructions);
  const [busy, setBusy] = useState(false);
  const dirty = value !== prefs.customInstructions;
  return (
    <div className="settings-section">
      <label className="setting-label" htmlFor="ci">
        Custom instructions
      </label>
      <p className="setting-desc">What should Voris AI know about you, and how would you like it to respond? Applies to all new messages.</p>
      <textarea
        id="ci"
        className="textarea"
        rows={8}
        maxLength={3000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={'e.g. I’m a frontend developer in Tashkent. Keep answers concise, use TypeScript for code examples, and explain trade-offs.'}
      />
      <div className="settings-actions">
        <span className="muted small">{value.length} / 3000</span>
        <button className="btn btn-ghost" disabled={!dirty || busy} onClick={() => setValue(prefs.customInstructions)}>
          Reset
        </button>
        <button
          className="btn btn-primary"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await update({ customInstructions: value });
              toast('Custom instructions saved', 'success');
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function VoiceTab() {
  const prefs = useAuth((s) => s.user!.preferences);
  const set = usePrefSetter();
  const speak = useSpeech((s) => s.speak);
  const stop = useSpeech((s) => s.stop);
  const testing = useSpeech((s) => s.speakingId === 'voice-test');
  const sttSupported = speechRecognitionSupported();
  const ttsSupported = speechSynthesisSupported();
  const insecure = voiceNeedsSecureContext();
  useEffect(
    () => () => {
      if (useSpeech.getState().speakingId === 'voice-test') stop();
    },
    [stop],
  );
  return (
    <>
      <Row label="Voice language" description="Used for voice input and for reading responses aloud.">
        <select className="select" value={prefs.voiceLanguage} onChange={(e) => set({ voiceLanguage: e.target.value })} aria-label="Voice language">
          {VOICE_LANGUAGES.map((v) => (
            <option key={v.tag} value={v.tag}>
              {v.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Read replies aloud" description="After you ask something by voice, Voris reads the answer back to you.">
        <Toggle checked={prefs.autoSpeak} onChange={(v) => set({ autoSpeak: v })} label="Read replies aloud after voice input" />
      </Row>
      <Row label="Test voice" description="Hear how responses will sound.">
        <button
          className="btn btn-secondary btn-sm"
          disabled={!ttsSupported}
          onClick={() => (testing ? stop() : speak('voice-test', VOICE_SAMPLES[prefs.voiceLanguage.slice(0, 2)] ?? VOICE_SAMPLES.en, prefs.voiceLanguage))}
        >
          {testing ? <Square size={13} /> : <Volume2 size={14} />} {testing ? 'Stop' : 'Play sample'}
        </button>
      </Row>
      <div className="engine-card">
        <Mic size={18} />
        <div>
          <div className="engine-title">Browser support</div>
          <div className="engine-desc">
            <span className={`status-dot ${sttSupported && !insecure ? 'ok' : 'off'}`} /> Voice input{' '}
            {!sttSupported ? 'is not supported in this browser (try Chrome, Edge or Safari)' : insecure ? 'needs HTTPS. Open Voris AI over a secure connection' : 'available'}
          </div>
          <div className="engine-desc">
            <span className={`status-dot ${ttsSupported ? 'ok' : 'off'}`} /> Read aloud {ttsSupported ? 'available' : 'is not supported in this browser'}
          </div>
          <div className="engine-desc muted">Voice uses your browser’s built-in speech services. Some browsers, such as Chrome, process speech in the cloud.</div>
        </div>
      </div>
    </>
  );
}

const VOICE_SAMPLES: Record<string, string> = {
  en: 'Hello! This is Voris AI. How can I help you today?',
  uz: 'Salom! Men Voris AI. Bugun sizga qanday yordam bera olaman?',
  ru: 'Привет! Это Voris AI. Чем я могу помочь сегодня?',
  de: 'Hallo! Hier ist Voris AI. Wie kann ich dir heute helfen?',
  tr: 'Merhaba! Ben Voris AI. Bugün size nasıl yardımcı olabilirim?',
  es: '¡Hola! Soy Voris AI. ¿En qué puedo ayudarte hoy?',
  fr: 'Bonjour ! Ici Voris AI. Comment puis-je vous aider aujourd’hui ?',
  it: 'Ciao! Sono Voris AI. Come posso aiutarti oggi?',
  pt: 'Olá! Aqui é a Voris AI. Como posso ajudar hoje?',
  uk: 'Привіт! Це Voris AI. Чим я можу допомогти сьогодні?',
  kk: 'Сәлем! Бұл Voris AI. Бүгін сізге қалай көмектесе аламын?',
};

function DataTab() {
  const askConfirm = useUI((s) => s.askConfirm);
  const toast = useUI((s) => s.toast);
  const deleteAll = useChats((s) => s.deleteAll);
  const chatCount = useChats((s) => s.chats.length);
  const navigate = useNavigate();
  const closeSettings = useUI((s) => s.closeSettings);
  const [exporting, setExporting] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try {
      const data = await api.exportChats();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `voris-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Export downloaded', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Row label="Export data" description="Download all your conversations as a JSON file.">
        <button className="btn btn-secondary btn-sm" onClick={exportAll} disabled={exporting}>
          {exporting ? <span className="spinner" /> : <Download size={14} />} Export
        </button>
      </Row>
      <Row label="Delete all conversations" description={`Permanently remove ${chatCount} conversation${chatCount === 1 ? '' : 's'}.`}>
        <button
          className="btn btn-danger-ghost btn-sm"
          disabled={chatCount === 0}
          onClick={() =>
            askConfirm({
              title: 'Delete all conversations?',
              message: 'Every conversation and message in your history will be permanently deleted. This can’t be undone.',
              confirmLabel: 'Delete all',
              danger: true,
              onConfirm: async () => {
                await deleteAll();
                closeSettings();
                navigate('/');
                toast('All conversations deleted', 'success');
              },
            })
          }
        >
          <Trash2 size={14} /> Delete all
        </button>
      </Row>
      <Row label="Sign out of other devices" description="End every session except this one.">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() =>
            api
              .revokeOtherSessions()
              .then(() => toast('Signed out of all other devices', 'success'))
              .catch((e) => toast(e.message, 'error'))
          }
        >
          <LogOut size={14} /> Sign out others
        </button>
      </Row>
      <div className="privacy-note">
        <strong>How your data is handled</strong>
        <ul>
          <li>Conversations are stored on this Voris AI server and are only visible to your account.</li>
          <li>Messages are sent to the configured AI provider to generate responses. AI keys stay on the server and are never exposed to your browser.</li>
          <li>Passwords are hashed with scrypt; sessions use secure, HTTP-only cookies.</li>
        </ul>
      </div>
    </>
  );
}

function AccountTab() {
  const user = useAuth((s) => s.user!);
  const updateName = useAuth((s) => s.updateName);
  const setUser = useAuth((s) => s.setUser);
  const toast = useUI((s) => s.toast);
  const closeSettings = useUI((s) => s.closeSettings);
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  return (
    <>
      <div className="settings-section">
        <label className="setting-label" htmlFor="acc-name">
          Name
        </label>
        <div className="inline-form">
          <input id="acc-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn btn-primary"
            disabled={!name.trim() || name.trim() === user.name}
            onClick={() =>
              updateName(name.trim())
                .then(() => toast('Name updated', 'success'))
                .catch((e) => toast(e.message, 'error'))
            }
          >
            Save
          </button>
        </div>
        <label className="setting-label" htmlFor="acc-email">
          Email
        </label>
        <input id="acc-email" className="input" value={user.email} disabled />
        <p className="setting-desc">Member since {new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <form
        className="settings-section"
        onSubmit={async (e) => {
          e.preventDefault();
          setPwBusy(true);
          try {
            await api.changePassword(pw.current, pw.next);
            setPw({ current: '', next: '' });
            toast('Password changed. Other devices were signed out.', 'success');
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally {
            setPwBusy(false);
          }
        }}
      >
        <div className="setting-label">Change password</div>
        <input
          className="input"
          type="password"
          placeholder="Current password"
          autoComplete="current-password"
          value={pw.current}
          onChange={(e) => setPw({ ...pw, current: e.target.value })}
          aria-label="Current password"
        />
        <input
          className="input"
          type="password"
          placeholder="New password (8+ characters, letters and numbers)"
          autoComplete="new-password"
          value={pw.next}
          onChange={(e) => setPw({ ...pw, next: e.target.value })}
          aria-label="New password"
        />
        <div className="settings-actions">
          <button className="btn btn-secondary" type="submit" disabled={pwBusy || !pw.current || pw.next.length < 8}>
            {pwBusy && <span className="spinner" />} Update password
          </button>
        </div>
      </form>

      <div className="settings-section danger-zone">
        <div className="setting-label">Delete account</div>
        <p className="setting-desc">Permanently delete your account, all conversations and settings.</p>
        {!deleteOpen ? (
          <div>
            <button className="btn btn-danger-ghost btn-sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={14} /> Delete my account
            </button>
          </div>
        ) : (
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setDeleteBusy(true);
              try {
                await api.deleteAccount(deletePw);
                useChats.getState().stop();
                closeSettings();
                setUser(null);
                navigate('/signup', { replace: true });
              } catch (err) {
                toast((err as Error).message, 'error');
                setDeleteBusy(false);
              }
            }}
          >
            <input
              className="input"
              type="password"
              placeholder="Confirm with your password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
              autoFocus
              aria-label="Password to confirm deletion"
            />
            <button className="btn btn-danger" type="submit" disabled={!deletePw || deleteBusy}>
              Delete forever
            </button>
            <button type="button" className="icon-btn" onClick={() => setDeleteOpen(false)} aria-label="Cancel">
              <X size={16} />
            </button>
          </form>
        )}
      </div>
    </>
  );
}

function ShortcutsTab() {
  return (
    <div className="shortcuts">
      {SHORTCUTS.map((s) => (
        <div key={s.label} className="shortcut-row">
          <span>{s.label}</span>
          <span className="shortcut-keys">
            {s.keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SettingsModal() {
  const tab = useUI((s) => s.settingsTab);
  const openSettings = useUI((s) => s.openSettings);
  const close = useUI((s) => s.closeSettings);
  const [active, setActive] = useState<SettingsTab>('general');

  useEffect(() => {
    if (tab) setActive(tab);
  }, [tab]);

  return (
    <Modal open={!!tab} onClose={close} title="Settings" size="lg" className="settings-modal">
      <div className="settings">
        <nav className="settings-nav" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              className={active === t.id ? 'active' : ''}
              onClick={() => {
                setActive(t.id);
                openSettings(t.id);
              }}
            >
              <t.icon size={16} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-panel" role="tabpanel">
          <h3 className="settings-panel-title">{TABS.find((t) => t.id === active)?.label}</h3>
          {active === 'general' && <GeneralTab />}
          {active === 'personalization' && <PersonalizationTab />}
          {active === 'voice' && <VoiceTab />}
          {active === 'data' && <DataTab />}
          {active === 'account' && <AccountTab />}
          {active === 'shortcuts' && <ShortcutsTab />}
        </div>
      </div>
    </Modal>
  );
}
