import { config } from '../config.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createOpenAICompatibleProvider } from './openai-compatible.ts';
import type { AIProvider } from './types.ts';

export * from './types.ts';

const PRESETS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', vision: true },
  // Groq retires models often: see https://console.groq.com/docs/deprecations.
  // Override with AI_MODEL / AI_VISION_MODEL when these change.
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    vision: 'qwen/qwen3.8-27b',
    maxImages: 3,
  },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', vision: true },
} as const;

export interface ProviderStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  vision: boolean;
  maxImagesPerRequest: number;
  problem: string | null;
}

function build(): { provider: AIProvider | null; problem: string | null } {
  const { provider, rawProvider, apiKey, model, visionModel, baseUrl, effort } = config.ai;

  if (!rawProvider) return { provider: null, problem: 'AI_PROVIDER is not set.' };
  if (!provider) return { provider: null, problem: `Unknown AI_PROVIDER "${rawProvider}".` };

  if (provider === 'anthropic') {
    if (!apiKey) return { provider: null, problem: 'AI_API_KEY is not set.' };
    return { provider: createAnthropicProvider({ apiKey, model, visionModel, effort }), problem: null };
  }

  if (provider === 'custom') {
    if (!baseUrl) return { provider: null, problem: 'AI_BASE_URL is required for the custom provider.' };
    if (!model) return { provider: null, problem: 'AI_MODEL is required for the custom provider.' };
    return {
      provider: createOpenAICompatibleProvider({
        id: 'custom',
        label: 'Custom',
        baseUrl,
        apiKey,
        model,
        visionModel: visionModel || null,
      }),
      problem: null,
    };
  }

  const preset = PRESETS[provider];
  if (!apiKey) return { provider: null, problem: 'AI_API_KEY is not set.' };
  const chosenModel = model || preset.model;
  const vision = visionModel || (preset.vision === true ? chosenModel : preset.vision);
  const maxImages = 'maxImages' in preset ? preset.maxImages : 4;
  return {
    provider: createOpenAICompatibleProvider({
      id: provider,
      label: preset.label,
      baseUrl: baseUrl || preset.baseUrl,
      apiKey,
      model: chosenModel,
      visionModel: vision,
      maxImagesPerRequest: maxImages,
      extraBody: provider === 'groq' ? groqExtras : undefined,
    }),
    problem: null,
  };
}

/** Groq reasoning settings: hide model "thinking" and keep short calls (titles) fast. */
function groqExtras(model: string, kind: 'stream' | 'complete'): Record<string, unknown> {
  if (/gpt-oss/i.test(model)) return { include_reasoning: false, ...(kind === 'complete' ? { reasoning_effort: 'low' } : {}) };
  if (/qwen3/i.test(model)) return { reasoning_format: 'hidden' };
  return {};
}

const built = build();
export const aiProvider = built.provider;

export function providerStatus(): ProviderStatus {
  return {
    configured: !!aiProvider,
    provider: aiProvider?.label ?? null,
    model: aiProvider?.model ?? null,
    vision: !!aiProvider?.visionModel,
    maxImagesPerRequest: aiProvider?.maxImagesPerRequest ?? 0,
    problem: built.problem,
  };
}

/** Images allowed in one message: the app limit, capped by what the model accepts per request. */
export function effectiveMaxImages(): number {
  return Math.min(config.limits.maxImagesPerMessage, aiProvider?.maxImagesPerRequest ?? config.limits.maxImagesPerMessage);
}
