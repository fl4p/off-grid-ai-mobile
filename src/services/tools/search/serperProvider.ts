import type { SearchProvider, SearchResult } from './types';

/** Shape of the Serper (google.serper.dev) response fields we consume. */
type SerperResponse = {
  message?: string;
  answerBox?: { answer?: string; snippet?: string; title?: string; link?: string };
  knowledgeGraph?: { title?: string; description?: string; descriptionLink?: string };
  organic?: Array<{ title?: string; snippet?: string; link?: string }>;
};

/**
 * Factory for a Serper-backed provider (serper.dev). Queries are POSTed to
 * google.serper.dev with the user's API key, so this is opt-in (see
 * settings.searchProvider). The key is captured at construction so the provider
 * stays a pure SearchProvider.
 */
export function createSerperProvider(apiKey: string): SearchProvider {
  return {
    id: 'serper',
    label: SERPER_LABEL,
    requiresApiKey: true,
    async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
      if (!apiKey.trim()) {
        throw new Error('Serper key is missing. Add it in Settings > Web Search.');
      }
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        signal,
        headers: {
          'X-API-KEY': apiKey.trim(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ q: query, num: 10 }),
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Serper rejected the API key (${response.status}). Check it in Settings > Web Search.`);
      }
      // Rate-limit / server errors may return a non-JSON body; guard before
      // parsing so callers get a status message, not a raw JSON.parse exception.
      if (!response.ok) {
        const detail = await safeErrorDetail(response);
        throw new Error(`Serper request failed (${response.status})${detail}`);
      }
      const data = (await response.json()) as SerperResponse;
      return mapSerperResults(data);
    },
  };
}

/** Metadata for the settings UI. */
export const SERPER_LABEL = 'Serper (Google)';

/** Best-effort extraction of an error message from a failed response body. */
async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as SerperResponse;
    return data.message ? `: ${data.message}` : '';
  } catch {
    return '';
  }
}

function mapSerperResults(data: SerperResponse): SearchResult[] {
  const results: SearchResult[] = [];

  // Surface the answer box / knowledge graph first - highest-signal hits.
  const box = data.answerBox;
  const boxText = box?.answer || box?.snippet;
  if (box && boxText) {
    results.push({ title: box.title || 'Answer', snippet: boxText, url: box.link });
  } else if (data.knowledgeGraph?.description) {
    const kg = data.knowledgeGraph;
    results.push({ title: kg.title || 'Overview', snippet: kg.description!, url: kg.descriptionLink });
  }

  for (const r of data.organic ?? []) {
    const title = r.title?.trim();
    const snippet = r.snippet?.trim();
    if (!title && !snippet) continue;
    results.push({
      title: title || '(no title)',
      snippet: snippet || '(no snippet)',
      url: r.link,
    });
    if (results.length >= 5) break;
  }

  return results.slice(0, 5);
}
