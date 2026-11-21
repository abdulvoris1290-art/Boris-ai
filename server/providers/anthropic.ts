import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, GenerateOptions, ProviderMessage, StreamResult } from './types.ts';
import { ProviderError, friendlyStatusMessage } from './types.ts';

// Models that support server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = /^claude-(fable-5|opus-5|sonnet-5-5)/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function toAnthropicMessages(messages: ProviderMessage[]) {
  return messages.map((m) => {
    if (m.role === 'user' && m.images?.length) {
      return {
        role: 'user' as const,
        content: [
          ...m.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
          })),
          { type: 'text' as const, text: m.content || 'Please look at the attached image(s).' },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

function mapError(err: unknown): never {
  if (err instanceof Anthropic.APIUserAbortError) throw err;
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
    throw new ProviderError(friendlyStatusMessage(err.status, detail), err.status === 429 ? 429 : 502);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new ProviderError('Could not reach the AI service. Check the server’s network connection.', 502);
  }
  throw err;
}

export function createAnthropicProvider(opts: { apiKey: string; model?: string; visionModel?: string; effort?: string }): AIProvider {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 });
  const model = opts.model || 'claude-opus-5-5';
  const visionModel = opts.visionModel || model;
  const effort = EFFORTS.includes(opts.effort ?? '') ? opts.effort : undefined;

  function buildParams(o: GenerateOptions, maxTokens: number) {
    const hasImages = o.messages.some((m) => m.images?.length);
    const chosen = hasImages ? visionModel : model;
    const params: Record<string, unknown> = {
      model: chosen,
      max_tokens: maxTokens,
      system: o.system,
      messages: toAnthropicMessages(o.messages),
    };
    if (effort) params.output_config = { effort };
    if (FALLBACK_MODELS.test(chosen)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    return params;
  }

  return {
    id: 'anthropic',
    label: 'Anthropic',
    model,
    visionModel,
    maxImagesPerRequest: 20,

    async stream(o, onText): Promise<StreamResult> {
      try {
        const params = buildParams(o, o.maxTokens ?? 64000);
        // Cast: params are assembled dynamically (beta fields are model-dependent).
        const stream = client.beta.messages.stream(params as unknown as Parameters<typeof client.beta.messages.stream>[0], {
          signal: o.signal,
        });
        let produced = false;
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            produced = true;
            onText(event.delta.text);
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') {
          if (!produced) onText('I’m not able to help with that request.');
          return { stopReason: 'refusal' };
        }
        return { stopReason: final.stop_reason === 'max_tokens' ? 'length' : 'end' };
      } catch (err) {
        if (o.signal?.aborted || err instanceof Anthropic.APIUserAbortError) return { stopReason: 'aborted' };
        mapError(err);
      }
    },

    async complete(o) {
      try {
        const params = buildParams(o, o.maxTokens ?? 1024);
        const res = await client.beta.messages.create(
          params as unknown as Parameters<typeof client.beta.messages.create>[0],
          { signal: o.signal },
        );
        if (!('content' in res)) return '';
        return res.content
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('')
          .trim();
      } catch (err) {
        mapError(err);
      }
    },
  };
}
