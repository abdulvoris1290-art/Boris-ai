import { config } from './config.ts';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const searchConfigured = () => !!(config.search.provider && config.search.apiKey);

export async function webSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const { provider, apiKey } = config.search;
  if (!provider || !apiKey) throw new Error('Web search is not configured.');
  const q = query.slice(0, 380);
  const timeout = AbortSignal.timeout(12_000);
  const s = signal ? AbortSignal.any([signal, timeout]) : timeout;

  if (provider === 'tavily') {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: q, max_results: 6, search_depth: 'basic' }),
      signal: s,
    });
    if (!res.ok) throw new Error(`Search service returned ${res.status}`);
    const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.content ?? '').slice(0, 700) }));
  }

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=6`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: s,
  });
  if (!res.ok) throw new Error(`Search service returned ${res.status}`);
  const json = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (json.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title ?? r.url!,
      url: r.url!,
      snippet: (r.description ?? '').replace(/<[^>]+>/g, '').slice(0, 700),
    }));
}
