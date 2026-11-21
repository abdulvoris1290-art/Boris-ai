import { Code2, FileSearch, Languages, Lightbulb, PenLine, Sparkles, TriangleAlert } from 'lucide-react';
import type { AppConfig, Mode } from '../../lib/types';
import { LogoMark } from '../ui/Logo';

export interface Suggestion {
  title: string;
  description: string;
  icon: typeof PenLine;
  prompt: string;
  mode: Mode;
  attach?: boolean;
  tone: 'violet' | 'blue' | 'cyan' | 'pink' | 'amber' | 'green';
}

export const SUGGESTIONS: Suggestion[] = [
  { title: 'Write something for me', description: 'Emails, posts, essays and stories', icon: PenLine, prompt: 'Write a ', mode: 'write', tone: 'violet' },
  { title: 'Explain a complex topic', description: 'Clear explanations, at any level', icon: Lightbulb, prompt: 'Explain in simple terms how ', mode: 'chat', tone: 'amber' },
  { title: 'Help me write code', description: 'Build, review and debug code', icon: Code2, prompt: 'Help me write ', mode: 'code', tone: 'blue' },
  { title: 'Analyze a document', description: 'Summarize PDFs and text files', icon: FileSearch, prompt: 'Summarize the key points of this document and list any action items.', mode: 'chat', attach: true, tone: 'cyan' },
  { title: 'Generate creative ideas', description: 'Brainstorm names, plans and more', icon: Sparkles, prompt: 'Give me 10 creative ideas for ', mode: 'chat', tone: 'pink' },
  { title: 'Improve my English', description: 'Grammar, clarity and natural tone', icon: Languages, prompt: 'Improve the grammar and style of this English text and briefly explain the main corrections:\n\n', mode: 'write', tone: 'green' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function WelcomeHero({ name, config }: { name: string; config: AppConfig }) {
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <LogoMark size={56} />
      </div>
      <p className="welcome-eyebrow">
        {greeting()}, {name.split(' ')[0]}
      </p>
      <h1 className="welcome-title">
        Welcome to <span className="text-gradient">Voris AI.</span>
      </h1>
      <p className="welcome-sub">Your ideas deserve intelligent answers. What can I help you with today?</p>

      {!config.ai.configured && (
        <div className="setup-card" role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>AI provider not connected</strong>
            <p>
              {config.ai.problem} In the project folder, run <code>npm run setup</code> to add your key (for example a Groq key), then restart the
              server. See <code>README.md</code> for all supported providers.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function SuggestionGrid({ onPick }: { onPick: (s: Suggestion) => void }) {
  return (
    <div className="suggestions">
      {SUGGESTIONS.map((s) => (
        <button key={s.title} className={`suggestion tone-${s.tone}`} onClick={() => onPick(s)}>
          <span className="suggestion-icon">
            <s.icon size={17} />
          </span>
          <span className="suggestion-text">
            <span className="suggestion-title">{s.title}</span>
            <span className="suggestion-desc">{s.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
