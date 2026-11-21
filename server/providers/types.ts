export interface ProviderImage {
  mediaType: string;
  data: string; // base64, no data: prefix
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: ProviderImage[];
}

export interface GenerateOptions {
  system: string;
  messages: ProviderMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface StreamResult {
  stopReason: 'end' | 'length' | 'refusal' | 'aborted';
}

export interface AIProvider {
  id: string;
  label: string;
  model: string;
  visionModel: string | null;
  /** Most images the model accepts in one request (older images in the history are described in text instead). */
  maxImagesPerRequest: number;
  /** Stream a response, calling onText for each text delta. */
  stream(opts: GenerateOptions, onText: (text: string) => void): Promise<StreamResult>;
  /** Single short non-streaming completion (used for titles). */
  complete(opts: GenerateOptions): Promise<string>;
}

/**
 * Removes <think>…</think> reasoning blocks that some open models (Qwen, DeepSeek R1…)
 * emit inline, so users only see the final answer. Works incrementally on streamed text.
 */
export function createThinkFilter() {
  let inThink = false;
  let carry = '';
  const filter = (chunk: string): string => {
    let text = carry + chunk;
    carry = '';
    let out = '';
    while (text) {
      if (inThink) {
        const end = text.indexOf('</think>');
        if (end === -1) {
          // Keep a possible partial closing tag for the next chunk.
          const keep = Math.min(text.length, 7);
          carry = text.slice(-keep);
          return out;
        }
        text = text.slice(end + 8).replace(/^\s+/, '');
        inThink = false;
      } else {
        const start = text.indexOf('<think>');
        if (start === -1) {
          const lt = text.lastIndexOf('<');
          if (lt !== -1 && '<think>'.startsWith(text.slice(lt))) {
            carry = text.slice(lt);
            return out + text.slice(0, lt);
          }
          return out + text;
        }
        out += text.slice(0, start);
        text = text.slice(start + 7);
        inThink = true;
      }
    }
    return out;
  };
  /** Returns text held back at the end of the stream (a trailing "<" that wasn't a tag). */
  filter.flush = (): string => {
    const rest = inThink ? '' : carry;
    carry = '';
    return rest;
  };
  return filter;
}

export const stripThinking = (text: string) => {
  const f = createThinkFilter();
  return f(text) + f.flush();
};

/** Error with a message that is safe to show to end users. */
export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function friendlyStatusMessage(status: number, detail?: string): string {
  switch (status) {
    case 400:
      return `The AI service rejected the request${detail ? `: ${detail}` : '.'}`;
    case 401:
    case 403:
      return 'The AI service rejected the server credentials. Check AI_API_KEY in the server configuration.';
    case 404:
      return `The configured AI model was not found${detail ? ` (${detail})` : ''}. Check AI_MODEL.`;
    case 413:
      return 'This conversation is too large for the model. Try starting a new chat or removing attachments.';
    case 429:
      return 'The AI service is rate limiting requests right now. Please wait a moment and try again.';
    case 529:
    case 503:
      return 'The AI service is temporarily overloaded. Please try again in a few seconds.';
    default:
      return status >= 500
        ? 'The AI service had a temporary problem. Please try again.'
        : `The AI service returned an error (${status})${detail ? `: ${detail}` : '.'}`;
  }
}
