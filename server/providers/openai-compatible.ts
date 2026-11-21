import type { AIProvider, GenerateOptions, ProviderMessage, StreamResult } from './types.ts';
import { ProviderError, createThinkFilter, friendlyStatusMessage, stripThinking } from './types.ts';

/**
 * Works with any OpenAI-compatible Chat Completions endpoint:
 * OpenAI, Groq, OpenRouter, Together, Ollama, vLLM, LM Studio, …
 */
export function createOpenAICompatibleProvider(opts: {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string | null;
  maxImagesPerRequest?: number;
  /** Provider-specific request fields for a model (e.g. reasoning settings). */
  extraBody?: (model: string, kind: 'stream' | 'complete') => Record<string, unknown>;
}): AIProvider {
  const { baseUrl, apiKey, model, visionModel } = opts;
  /** Reasoning models spend completion tokens on thinking first, so short calls need headroom. */
  const isReasoning = (m: string) => /gpt-oss|qwen3|deepseek-r1|(^|\/)o[1-9]|reason|think/i.test(m);

  function toMessages(system: string, messages: ProviderMessage[]) {
    return [
      { role: 'system', content: system },
      ...messages.map((m) => {
        if (m.role === 'user' && m.images?.length) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: m.content || 'Please look at the attached image(s).' },
              ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      }),
    ];
  }

  async function request(o: GenerateOptions, stream: boolean) {
    const hasImages = o.messages.some((m) => m.images?.length);
    if (hasImages && !visionModel) {
      throw new ProviderError('The configured AI model does not support images. Set AI_VISION_MODEL on the server to enable image understanding.', 400);
    }
    const chosen = (hasImages ? visionModel : model) as string;
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: chosen,
          messages: toMessages(o.system, o.messages),
          max_tokens: stream ? (o.maxTokens ?? 8192) : isReasoning(chosen) ? Math.max(o.maxTokens ?? 0, 1024) : (o.maxTokens ?? 256),
          stream,
          ...(opts.extraBody?.(chosen, stream ? 'stream' : 'complete') ?? {}),
        }),
        signal: o.signal,
      });
    } catch (err) {
      if (o.signal?.aborted) throw err;
      throw new ProviderError('Could not reach the AI service. Check the server’s network connection and AI_BASE_URL.', 502);
    }
    if (!res.ok) {
      let detail: string | undefined;
      try {
        const body = (await res.json()) as { error?: { message?: string } | string };
        detail = typeof body.error === 'string' ? body.error : body.error?.message;
      } catch {
        /* non-JSON error body */
      }
      throw new ProviderError(friendlyStatusMessage(res.status, detail?.slice(0, 300)), res.status === 429 ? 429 : 502);
    }
    return res;
  }

  return {
    id: opts.id,
    label: opts.label,
    model,
    visionModel,
    maxImagesPerRequest: opts.maxImagesPerRequest ?? 4,

    async stream(o, onText): Promise<StreamResult> {
      let finish: string | null = null;
      const filter = createThinkFilter();
      try {
        const res = await request(o, true);
        if (!res.body) throw new ProviderError('The AI service returned an empty response.');
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data) as {
                choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
                error?: { message?: string };
              };
              if (json.error) throw new ProviderError(json.error.message ?? 'The AI service reported an error.');
              const choice = json.choices?.[0];
              if (choice?.delta?.content) {
                const visible = filter(choice.delta.content);
                if (visible) onText(visible);
              }
              if (choice?.finish_reason) finish = choice.finish_reason;
            } catch (err) {
              if (err instanceof ProviderError) throw err;
              /* ignore keep-alive / partial lines */
            }
          }
        }
        const tail = filter.flush();
        if (tail) onText(tail);
        return { stopReason: finish === 'length' ? 'length' : 'end' };
      } catch (err) {
        if (o.signal?.aborted) return { stopReason: 'aborted' };
        throw err;
      }
    },

    async complete(o) {
      const res = await request(o, false);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return stripThinking(json.choices?.[0]?.message?.content ?? '').trim();
    },
  };
}
