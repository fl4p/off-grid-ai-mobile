/**
 * Search provider abstraction - unit tests.
 *
 * Covers the provider selector (settings -> active provider, with fallback) and
 * the Serper provider's request shaping, result mapping, and error handling.
 * Priority: P0 - web_search backend selection drives assistant search results.
 */

import {
  getActiveSearchProvider,
  SEARCH_PROVIDER_OPTIONS,
} from '../../../../../src/services/tools/search';
import { braveProvider, createBraveProvider } from '../../../../../src/services/tools/search/braveProvider';
import { createSerperProvider } from '../../../../../src/services/tools/search/serperProvider';

describe('getActiveSearchProvider', () => {
  it('returns the Brave provider by default', () => {
    const provider = getActiveSearchProvider({ searchProvider: 'brave', apiKey: '' });
    expect(provider).toBe(braveProvider);
    expect(provider.id).toBe('brave');
    expect(provider.requiresApiKey).toBe(false);
  });

  it('returns a Serper provider when serper is selected with a key', () => {
    const provider = getActiveSearchProvider({ searchProvider: 'serper', apiKey: 'abc123' });
    expect(provider.id).toBe('serper');
    expect(provider.requiresApiKey).toBe(true);
  });

  it('falls back to Brave when serper is selected but the key is missing', () => {
    expect(getActiveSearchProvider({ searchProvider: 'serper', apiKey: '' })).toBe(braveProvider);
    expect(getActiveSearchProvider({ searchProvider: 'serper', apiKey: '   ' })).toBe(braveProvider);
    expect(getActiveSearchProvider({ searchProvider: 'serper' })).toBe(braveProvider);
  });

  it('upgrades Brave to the official API provider when a key is set (not the keyless scrape)', () => {
    const provider = getActiveSearchProvider({ searchProvider: 'brave', apiKey: 'brave-key' });
    expect(provider.id).toBe('brave');
    expect(provider).not.toBe(braveProvider); // the keyed official-API instance, not the scrape
  });

  it('exposes both providers as UI options with correct key requirements', () => {
    const byId = Object.fromEntries(SEARCH_PROVIDER_OPTIONS.map(o => [o.id, o]));
    expect(byId.brave.requiresApiKey).toBe(false);
    expect(byId.brave.optionalApiKey).toBe(true);
    expect(byId.serper.requiresApiKey).toBe(true);
    // Every option carries a hint for the settings UI.
    expect(byId.brave.hint).toBeTruthy();
    expect(byId.serper.hint).toBeTruthy();
  });
});

describe('Serper provider', () => {
  const originalFetch = (globalThis as any).fetch;
  const signal = new AbortController().signal;

  // Restore fetch precisely so a mock never leaks to another suite sharing this
  // jest worker: delete it when there was no global fetch to begin with.
  afterEach(() => {
    if (originalFetch === undefined) {
      delete (globalThis as any).fetch;
    } else {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it('throws before fetching when the key is blank', async () => {
    const fetchSpy = jest.fn();
    (globalThis as any).fetch = fetchSpy;
    const provider = createSerperProvider('   ');
    await expect(provider.search('anything', signal)).rejects.toThrow(/key is missing/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the query to google.serper.dev with the X-API-KEY header', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ organic: [] }),
    });
    (globalThis as any).fetch = fetchSpy;

    await createSerperProvider('secret-key').search('react native', signal);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://google.serper.dev/search');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-KEY']).toBe('secret-key');
    expect(JSON.parse(init.body)).toMatchObject({ q: 'react native' });
  });

  it('maps organic results to normalized results (capped at 5)', async () => {
    const organic = Array.from({ length: 8 }, (_, i) => ({
      title: `Title ${i}`,
      snippet: `Snippet ${i}`,
      link: `https://example.com/${i}`,
    }));
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ organic }),
    });

    const results = await createSerperProvider('k').search('q', signal);
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ title: 'Title 0', snippet: 'Snippet 0', url: 'https://example.com/0' });
  });

  it('surfaces the answer box first when present', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        answerBox: { answer: '42', title: 'The Answer', link: 'https://example.com/a' },
        organic: [{ title: 'Other', snippet: 'x', link: 'https://example.com/o' }],
      }),
    });

    const results = await createSerperProvider('k').search('meaning of life', signal);
    expect(results[0]).toEqual({ title: 'The Answer', snippet: '42', url: 'https://example.com/a' });
    expect(results[1].title).toBe('Other');
  });

  it('falls back to the knowledge graph when there is no answer box', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        knowledgeGraph: { title: 'Ada Lovelace', description: 'First programmer', descriptionLink: 'https://example.com/ada' },
        organic: [{ title: 'Other', snippet: 'x', link: 'https://example.com/o' }],
      }),
    });

    const results = await createSerperProvider('k').search('ada lovelace', signal);
    expect(results[0]).toEqual({ title: 'Ada Lovelace', snippet: 'First programmer', url: 'https://example.com/ada' });
  });

  it('substitutes placeholders for missing title/snippet', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        organic: [{ link: 'https://example.com/x', title: 'Has title' }],
      }),
    });
    const results = await createSerperProvider('k').search('q', signal);
    expect(results[0].snippet).toBe('(no snippet)');
  });

  it('throws a status message on a 5xx with a non-JSON body (no raw parse error)', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
    });
    await expect(createSerperProvider('k').search('q', signal)).rejects.toThrow(/failed \(503\)/);
  });

  it('includes the error message from a 429 JSON body', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({ message: 'Not enough credits.' }),
    });
    await expect(createSerperProvider('k').search('q', signal)).rejects.toThrow(/Not enough credits/);
  });

  it.each([401, 403])('throws on a %s with a helpful key message', async (status) => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      status,
      json: jest.fn().mockResolvedValue({}),
    });
    await expect(createSerperProvider('bad').search('q', signal)).rejects.toThrow(new RegExp(String(status)));
  });
});

describe('Brave provider', () => {
  const originalFetch = (globalThis as any).fetch;
  const signal = new AbortController().signal;

  afterEach(() => {
    if (originalFetch === undefined) delete (globalThis as any).fetch;
    else (globalThis as any).fetch = originalFetch;
  });

  it('throws a rate-limit error on a 429 block page instead of returning no results', async () => {
    // Brave serves a 429 CAPTCHA page to keyless scraping; the body still parses to
    // zero result blocks, so without a status guard this looked like "no results".
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('<html><body>CAPTCHA — please verify you are human</body></html>'),
    });
    await expect(braveProvider.search('portugal crypto tax', signal)).rejects.toThrow(/rate-limiting/i);
  });

  it('throws a status message on other non-2xx responses', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('<html>error</html>'),
    });
    await expect(braveProvider.search('q', signal)).rejects.toThrow(/failed \(503\)/);
  });

  it('parses results normally on a 200 response', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        'x<a href="https://example.com/a">Example Portugal crypto tax guide</a>y',
      ),
    });
    const results = await braveProvider.search('q', signal);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('Brave official API provider (createBraveProvider)', () => {
  const originalFetch = (globalThis as any).fetch;
  const signal = new AbortController().signal;

  afterEach(() => {
    if (originalFetch === undefined) delete (globalThis as any).fetch;
    else (globalThis as any).fetch = originalFetch;
  });

  it('throws before fetching when the key is blank', async () => {
    const fetchSpy = jest.fn();
    (globalThis as any).fetch = fetchSpy;
    await expect(createBraveProvider('   ').search('q', signal)).rejects.toThrow(/key is missing/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GETs the official API with the subscription token and maps web results', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        web: {
          results: [
            { title: 'PIV crypto Portugal', url: 'https://a.pt', description: 'A <strong>binding</strong> ruling.' },
            { title: 'Second', url: 'https://b.pt', description: 'More.' },
          ],
        },
      }),
    });
    (globalThis as any).fetch = fetchSpy;

    const results = await createBraveProvider('bk').search('portugal crypto', signal);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('api.search.brave.com/res/v1/web/search');
    expect(init.headers['X-Subscription-Token']).toBe('bk');
    expect(results[0]).toEqual({ title: 'PIV crypto Portugal', snippet: 'A binding ruling.', url: 'https://a.pt' });
    expect(results.length).toBe(2);
  });

  it.each([401, 403])('throws a helpful key message on %s', async (status) => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status, json: jest.fn() });
    await expect(createBraveProvider('bad').search('q', signal)).rejects.toThrow(new RegExp(String(status)));
  });

  it('throws a status message on other non-2xx responses', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: jest.fn() });
    await expect(createBraveProvider('bk').search('q', signal)).rejects.toThrow(/failed \(500\)/);
  });
});
