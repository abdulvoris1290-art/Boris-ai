import { memo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy, WrapText } from 'lucide-react';
import type { Source } from '../../lib/types';

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const codeEl = (children as { props?: { className?: string } } | undefined)?.props;
  const lang = /language-([\w+#-]+)/.exec(codeEl?.className ?? '')?.[1] ?? 'text';

  const onCopy = async () => {
    const text = ref.current?.querySelector('code')?.textContent ?? '';
    if (await copyText(text.replace(/\n$/, ''))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{lang}</span>
        <div className="code-actions">
          <button className="code-btn" onClick={() => setWrap((w) => !w)} aria-pressed={wrap} aria-label="Toggle line wrap" title="Wrap lines">
            <WrapText size={14} />
          </button>
          <button className="code-btn" onClick={onCopy} aria-label="Copy code">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre ref={ref} {...props} className={wrap ? 'wrap' : undefined}>
        {children}
      </pre>
    </div>
  );
}

/** Turn bare [n] citation markers into links to the corresponding source (outside code). */
function linkCitations(md: string, sources: Source[]) {
  if (!sources.length) return md;
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[(\d{1,2})\](?![(:])/g, (m, n) => {
            const s = sources[Number(n) - 1];
            return s ? `[${n}](${s.url} "cite")` : m;
          }),
    )
    .join('');
}

const components = {
  pre: CodeBlock,
  a: ({ href, title, children }: ComponentProps<'a'>) => {
    if (title === 'cite') {
      return (
        <a className="cite" href={href} target="_blank" rel="noopener noreferrer" title={href}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title}>
        {children}
      </a>
    );
  },
  table: ({ children }: { children?: ReactNode }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

export const Markdown = memo(function Markdown({ content, sources = [] }: { content: string; sources?: Source[] }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {linkCitations(content, sources)}
      </ReactMarkdown>
    </div>
  );
});
