/**
 * Live tool-loop harness (opt-in, hits the real network).
 *
 * This is NOT a normal test — it drives the REAL runToolLoop against a REAL
 * OpenAI-compatible endpoint (e.g. the zen snoop proxy → opencode.ai/zen) and the
 * REAL web-search provider (Serper/Brave), with only the native modules mocked
 * (via jest.setup.ts). It exists for fast iteration on the tool-loop / web_search
 * path without a device build: edit the TS, run one file, see the full turn-by-turn
 * trace in seconds.
 *
 * It is gated behind LIVE_HARNESS=1 so `npm test` / CI never runs it (no network,
 * no secrets). Run it explicitly, e.g.:
 *
 *   LIVE_HARNESS=1 DEBUG_JEST_CONSOLE=1 \
 *   LIVE_ENDPOINT=http://192.168.1.205:8788 LIVE_MODEL=big-pickle LIVE_KEY=<zen-key> \
 *   SEARCH_PROVIDER=serper SEARCH_KEY=<serper-key> \
 *   LIVE_PROMPT="Do research about binding requests (PIV) about crypto taxation in Portugal" \
 *   npx jest __tests__/harness/liveToolLoop.test.ts --testTimeout=180000 --runInBand
 *
 * Everything the loop needs at module load (llama.rn, keychain, RNFS, LiteRT, …)
 * is already neutralised by jest.setup.ts's mocks, which is what makes this cheap.
 */

import * as Keychain from 'react-native-keychain';
import { runToolLoop, type ToolLoopContext } from '../../src/services/generationToolLoop';
import { providerRegistry } from '../../src/services/providers';
import { createOpenAIProvider } from '../../src/services/providers/openAICompatibleProvider';
import { useRemoteServerStore, useAppStore } from '../../src/stores';
import type { Message } from '../../src/types';

// --- config from env -------------------------------------------------------
const RUN = process.env.LIVE_HARNESS === '1';
const ENDPOINT = process.env.LIVE_ENDPOINT || 'http://192.168.1.205:8788';
const MODEL = process.env.LIVE_MODEL || 'big-pickle';
const KEY = process.env.LIVE_KEY || '';
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || 'serper') as 'serper' | 'brave';
const SEARCH_KEY = process.env.SEARCH_KEY || '';
const PROMPT =
  process.env.LIVE_PROMPT ||
  'Do research about binding requests (PIV) about crypto taxation in Portugal';
const SERVER_ID = 'live-harness';

// jest.setup silences console.*; write the trace straight to stdout so it always shows.
const out = (s: string) => process.stdout.write(`${s}\n`);

/**
 * Minimal fetch-backed XMLHttpRequest so the provider's SSE streaming path
 * (createStreamingRequest → XHR) works under Node. Streams response chunks into
 * responseText and fires onprogress, mirroring the RN XHR contract the provider
 * relies on (readyState 4 + status, responseText, onprogress/onreadystatechange).
 */
class NodeXHR {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  readyState = 0;
  status = 0;
  responseText = '';
  onreadystatechange: null | (() => void) = null;
  onprogress: null | (() => void) = null;
  onerror: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  private ctrl = new AbortController();

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.ctrl.abort();
  }
  send(body?: string) {
    fetch(this.url, { method: this.method, headers: this.headers, body, signal: this.ctrl.signal })
      .then(async res => {
        this.status = res.status;
        if (!res.body) {
          this.responseText = await res.text();
          this.readyState = 4;
          this.onreadystatechange?.();
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            this.responseText += dec.decode(value, { stream: true });
            this.onprogress?.();
          }
        }
        this.readyState = 4;
        this.onreadystatechange?.();
      })
      .catch(() => {
        this.readyState = 4;
        // Real XHR delivers all buffered bytes on load even if the socket resets after
        // the response completed. Some upstreams (e.g. Fireworks) drop the connection
        // right after the final SSE chunk; treat "error after we already have data" (or
        // an abort) as a normal end-of-stream so the provider parses what it received,
        // rather than a fatal network error.
        if (this.ctrl.signal.aborted || this.responseText.length > 0) this.onreadystatechange?.();
        else this.onerror?.();
      });
  }
}

(RUN ? describe : describe.skip)('live tool loop (opt-in, real network)', () => {
  beforeAll(() => {
    (globalThis as any).XMLHttpRequest = NodeXHR as any;

    // Register the real remote provider and make it the active server, so the loop
    // routes through callRemoteLLMWithTools → OpenAICompatibleProvider.generate().
    providerRegistry.registerProvider(
      SERVER_ID,
      createOpenAIProvider(SERVER_ID, ENDPOINT, { apiKey: KEY, modelId: MODEL }),
    );
    useRemoteServerStore.getState().setActiveServerId(SERVER_ID);

    // Point web_search at the chosen provider and feed it the real key (keychain is
    // mocked by jest.setup; override the read to return our env key).
    useAppStore.getState().updateSettings({ searchProvider: SEARCH_PROVIDER });
    // Some endpoints reject sampling params (Anthropic's OpenAI-compat layer rejects
    // temperature on its newest models, and temperature+top_p together on others).
    // Let a run drop them so the tool loop can still be exercised against those models.
    if (process.env.LIVE_OMIT_TEMP === '1') useAppStore.getState().updateSettings({ temperature: undefined as any });
    if (process.env.LIVE_OMIT_TOPP === '1') useAppStore.getState().updateSettings({ topP: undefined as any });
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(
      SEARCH_KEY ? { password: SEARCH_KEY } : false,
    );
  });

  it('runs the PIV crypto-tax research prompt end-to-end', async () => {
    const messages: Message[] = [
      {
        id: 'sys',
        role: 'system',
        content:
          'You are Off Grid, a helpful assistant. Use the available tools (web_search, read_url) to research current information before answering. Cite what you find.',
        timestamp: Date.now(),
      },
      { id: 'u1', role: 'user', content: PROMPT, timestamp: Date.now() },
    ];

    let finalResponse = '';
    let streamed = '';
    const toolCalls: Array<{ name: string; args: any }> = [];

    const ctx: ToolLoopContext = {
      conversationId: 'live-harness-conv',
      messages,
      enabledToolIds: ['web_search', 'read_url'],
      isAborted: () => false,
      forceRemote: true,
      onThinkingDone: () => out('[thinking done]'),
      onStream: data => {
        const chunk = typeof data === 'string' ? data : data.content ?? '';
        if (chunk) {
          streamed += chunk;
          process.stdout.write(chunk);
        }
      },
      onStreamReset: () => {
        streamed = '';
        out('\n[stream reset — tool calls follow]');
      },
      onFinalResponse: content => {
        finalResponse = content;
      },
      onToolsRouted: names => out(`[tools routed] ${names.join(', ')}`),
      callbacks: {
        onToolCallStart: (name, args) => {
          toolCalls.push({ name, args });
          out(`\n[tool→] ${name}(${JSON.stringify(args)})`);
        },
        onToolCallComplete: (name, result) => {
          const body = result.error ? `ERROR: ${result.error}` : result.content;
          out(`[tool←] ${name}: ${String(body).slice(0, 500)}${String(body).length > 500 ? '…' : ''}`);
        },
        onFirstToken: () => out('[first token]'),
      },
    };

    out(`\n${'='.repeat(78)}`);
    out(`PROMPT: ${PROMPT}`);
    out(`ENDPOINT: ${ENDPOINT}  MODEL: ${MODEL}  SEARCH: ${SEARCH_PROVIDER}`);
    out('='.repeat(78));

    await runToolLoop(ctx);

    out(`\n${'='.repeat(78)}`);
    out(`TOOL CALLS: ${toolCalls.length} — ${toolCalls.map(t => t.name).join(', ')}`);
    out(`FINAL RESPONSE (${finalResponse.length} chars):`);
    out(finalResponse || streamed || '(empty)');
    out('='.repeat(78));

    // The whole point of the fix: raw DeepSeek DSML markup must never reach the user.
    const shown = finalResponse || streamed;
    expect(shown).not.toContain('DSML');
    expect(shown).not.toContain('invoke name');
    expect(shown).not.toContain('｜');
    expect(shown.length).toBeGreaterThan(0);
  }, 180000);
});
