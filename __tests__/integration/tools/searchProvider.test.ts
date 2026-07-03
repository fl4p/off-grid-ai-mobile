/**
 * Web search provider selection - integration test.
 *
 * Exercises executeToolCall('web_search') end-to-end through the real app store,
 * the keychain-backed key storage, and the provider selector, asserting that the
 * persisted searchProvider + stored key actually route the search to the right
 * backend.
 */

import * as Keychain from 'react-native-keychain';
import { executeToolCall } from '../../../src/services/tools/handlers';
import type { ToolCall } from '../../../src/services/tools/types';
import { useAppStore } from '../../../src/stores/appStore';

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn(),
}));

const mockedKeychain = Keychain as jest.Mocked<typeof Keychain>;

function webSearch(query: string): Promise<any> {
  const call: ToolCall = { id: 'c1', name: 'web_search', arguments: { query } };
  return executeToolCall(call);
}

describe('web_search provider selection (integration)', () => {
  const originalFetch = (globalThis as any).fetch;

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    (mockedKeychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    useAppStore.getState().updateSettings({ searchProvider: 'brave' });
  });

  it('routes through Serper when configured, formatting the JSON results', async () => {
    useAppStore.getState().updateSettings({ searchProvider: 'serper' });
    (mockedKeychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'live-key' });

    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        organic: [
          { title: 'Serper Result', snippet: 'From serper', link: 'https://serper.example/1' },
        ],
      }),
    });
    (globalThis as any).fetch = fetchSpy;

    const result = await webSearch('react native');

    expect(fetchSpy.mock.calls[0][0]).toBe('https://google.serper.dev/search');
    expect(fetchSpy.mock.calls[0][1].headers['X-API-KEY']).toBe('live-key');
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Serper Result');
    expect(result.content).toContain('serper.example/1');
    expect(result.content).toContain('From serper');
  });

  it('routes through Brave (HTML scrape) when provider is brave', async () => {
    useAppStore.getState().updateSettings({ searchProvider: 'brave' });

    const html = `<html><body>
      <div class="result-wrapper">
        <a class="result-header" href="https://brave.example/1">
          <span class="snippet-title">Brave Result</span>
        </a>
        <p class="snippet-description">From brave</p>
      </div>
    </body></html>`;
    const fetchSpy = jest.fn().mockResolvedValue({ text: jest.fn().mockResolvedValue(html) });
    (globalThis as any).fetch = fetchSpy;

    const result = await webSearch('react native');

    expect(fetchSpy.mock.calls[0][0]).toContain('search.brave.com');
    expect(result.content).toContain('Brave Result');
  });

  it('falls back to Brave when serper is selected without a stored key', async () => {
    useAppStore.getState().updateSettings({ searchProvider: 'serper' });
    (mockedKeychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

    const fetchSpy = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue('<html><body>No matching documents</body></html>'),
    });
    (globalThis as any).fetch = fetchSpy;

    await webSearch('anything');

    expect(fetchSpy.mock.calls[0][0]).toContain('search.brave.com');
  });
});
