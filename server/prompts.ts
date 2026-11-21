import type { Preferences } from './auth.ts';
import type { SearchResult } from './search.ts';

export const MODES = ['chat', 'write', 'code', 'translate'] as const;
export type Mode = (typeof MODES)[number];

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  chat: '',
  write: `The user is using the Writing tool. Act as an expert editor and writer.
- When asked to write, produce polished, well-structured text that fits the requested tone and audience.
- When given text to improve, rewrite it for clarity, flow, grammar and impact while keeping the author's meaning and voice. After the rewrite, add a short bullet list of the most important changes.
- When asked to summarize, lead with the key point, then concise bullets.`,
  code: `The user is using the Coding tool. Act as a senior software engineer.
- Write correct, idiomatic, production-quality code with clear names and brief comments where they add value.
- Always use fenced code blocks with a language tag.
- When debugging, identify the root cause first, then give the fix and explain why it works.
- Mention important edge cases, security or performance concerns briefly.`,
  translate: '',
};

export function buildSystemPrompt(opts: {
  userName: string;
  prefs: Preferences;
  mode: Mode;
  targetLanguage?: string;
  sources?: SearchResult[];
}): string {
  const { userName, prefs, mode, targetLanguage, sources } = opts;
  const today = new Date().toISOString().slice(0, 10);

  const parts: string[] = [
    `You are Voris AI, a highly capable, friendly and precise AI assistant. Today's date is ${today}. The user's name is ${userName}.`,
    `Guidelines:
- Be genuinely helpful, accurate and concise. Lead with the answer, then add detail as needed.
- Use Markdown for structure (headings, lists, tables, bold) when it improves readability; keep short answers short.
- Use fenced code blocks with a language tag for any code.
- If you are unsure or lack information, say so honestly instead of guessing.
- Never claim to have browsed the web unless search results are provided below.`,
  ];

  if (prefs.responseLanguage && prefs.responseLanguage !== 'auto') {
    parts.push(`Always respond in ${prefs.responseLanguage} unless the user explicitly asks for another language.`);
  } else {
    parts.push(
      'Respond in the same language the user writes in. You are fluent in English, Uzbek (Latin and Cyrillic), Russian, German, Turkish, Spanish, French, Arabic, Chinese and many other languages.',
    );
  }

  if (mode === 'translate') {
    const target = targetLanguage?.trim() || 'English';
    parts.push(`The user is using the Translation tool. Translate the user's text into ${target}.
- Output only the translation, preserving formatting, tone and meaning.
- If something is ambiguous or idiomatic, add a brief note after the translation, prefixed with "Note:".
- If the text is already in ${target}, translate it into English instead and say so in one short line.`);
  } else if (MODE_INSTRUCTIONS[mode]) {
    parts.push(MODE_INSTRUCTIONS[mode]);
  }

  if (prefs.customInstructions.trim()) {
    parts.push(`The user has provided these custom instructions. Follow them unless they conflict with the guidelines above:\n<custom_instructions>\n${prefs.customInstructions.trim()}\n</custom_instructions>`);
  }

  if (sources) {
    if (sources.length) {
      const list = sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).join('\n\n');
      parts.push(`Live web search results for the user's latest message are below. Use them to give an up-to-date answer and cite sources inline using their bracketed numbers, e.g. [1] or [2][3]. If the results don't answer the question, say so.\n<search_results>\n${list}\n</search_results>`);
    } else {
      parts.push('A web search was performed for the latest message but returned no results. Tell the user if current information may be missing.');
    }
  }

  return parts.join('\n\n');
}

export const TITLE_PROMPT =
  'Write a short, specific title (2-6 words) for a conversation that starts with the message below. Use the same language as the message. Reply with the title only — no quotes, no punctuation at the end.';
