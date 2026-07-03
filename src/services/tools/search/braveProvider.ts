import type { SearchProvider, SearchResult } from './types';

/** Label shared by both Brave backends (keyless scrape and official API). */
export const BRAVE_LABEL = 'Brave';

/** Shape of the official Brave Web Search API fields we consume. */
type BraveApiResponse = {
  web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
};

/**
 * Official Brave Web Search API (api.search.brave.com). Opt-in: the query still
 * only ever reaches Brave, but a key buys a real JSON API instead of scraping the
 * HTML page (which Brave rate-limits with a 429 CAPTCHA for keyless requests).
 * Used automatically when the user has stored a Brave key; otherwise the keyless
 * on-device scrape below remains the default.
 */
export function createBraveProvider(apiKey: string): SearchProvider {
  return {
    id: 'brave',
    label: BRAVE_LABEL,
    requiresApiKey: false,
    async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
      if (!apiKey.trim()) {
        throw new Error('Brave API key is missing. Add it in Settings > Web Search.');
      }
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
      const response = await fetch(url, {
        signal,
        headers: { 'X-Subscription-Token': apiKey.trim(), Accept: 'application/json' },
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Brave rejected the API key (${response.status}). Check it in Settings > Web Search.`);
      }
      if (!response.ok) {
        throw new Error(`Brave request failed (${response.status}).`);
      }
      const data = (await response.json()) as BraveApiResponse;
      return mapBraveApiResults(data);
    },
  };
}

function mapBraveApiResults(data: BraveApiResponse): SearchResult[] {
  const results: SearchResult[] = [];
  for (const r of data.web?.results ?? []) {
    const title = r.title?.trim();
    // Brave descriptions carry <strong> highlight tags — strip them to plain text.
    const snippet = r.description ? stripHtmlTags(decodeHTMLEntities(r.description)).trim() : '';
    if (!title && !snippet) continue;
    results.push({ title: title || '(no title)', snippet: snippet || '(no snippet)', url: r.url });
    if (results.length >= 5) break;
  }
  return results.slice(0, 5);
}

/**
 * On-device Brave provider: fetches Brave's public HTML search page and scrapes
 * results. No API key, no third-party proxy - the query only ever reaches
 * Brave. This is the privacy-preserving default, but Brave rate-limits keyless
 * scraping (429), so results can be intermittent - add a Brave key to switch to
 * the official API above.
 */
export const braveProvider: SearchProvider = {
  id: 'brave',
  label: BRAVE_LABEL,
  requiresApiKey: false,
  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    const response = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
      },
    });
    // fetch does not reject on HTTP error codes, and Brave serves a 429 CAPTCHA
    // page to keyless scraping. Without this guard the scraper parses that block
    // page, finds nothing, and returns [] — surfacing as a misleading "No results
    // found" instead of the real cause. Throw so the failure reaches the user.
    if (response.status === 429) {
      throw new Error('Brave search is rate-limiting this device. Add a Serper API key in Settings > Web Search for dependable web results.');
    }
    if (!response.ok) {
      throw new Error(`Brave search request failed (${response.status}).`);
    }
    const html = await response.text();
    return parseBraveResults(html);
  },
};

function stripHtmlTags(html: string): string {
  let result = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') { inTag = true; continue; }
    if (ch === '>') { inTag = false; continue; }
    if (!inTag) result += ch;
  }
  return result;
}

function parseResultBlock(block: string): SearchResult | null {
  const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
  const url = urlMatch ? decodeHTMLEntities(urlMatch[1]) : '';

  const titleMatch = block.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</) ||
                     block.match(/<a[^>]*href="https?:\/\/[^"]*"[^>]*>\s*<span[^>]*>([^<]+)/);
  const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : '';

  const snippetMatch = block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
                       block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const snippet = snippetMatch
    ? decodeHTMLEntities(stripHtmlTags(snippetMatch[1]).trim())
    : '';

  if (!title && !snippet) return null;
  return { title: title || '(no title)', snippet: snippet || '(no snippet)', url };
}

function parseBraveResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result-wrapper/).slice(1);

  for (const block of blocks) {
    if (results.length >= 5) break;
    const parsed = parseResultBlock(block);
    if (parsed) results.push(parsed);
  }

  if (results.length === 0) {
    const linkPattern = /<a[^>]*href="(https?:\/\/(?!search\.brave)[^"]*)"[^>]*>([^<]{10,})<\/a>/g;
    let match;
    while ((match = linkPattern.exec(html)) !== null && results.length < 5) {
      const title = decodeHTMLEntities(match[2].trim());
      if (!title.includes('Brave')) {
        results.push({ title, snippet: '', url: match[1] });
      }
    }
  }

  return results;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&apos;', "'")
    .replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}
