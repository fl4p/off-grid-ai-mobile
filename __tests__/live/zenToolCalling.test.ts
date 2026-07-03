/**
 * E2E: real tool-calling against opencode.ai/zen's `big-pickle` (a GLM model).
 *
 * No API key required. Gated behind ZEN_E2E=1 so normal/offline/CI runs skip it.
 * Run:  ZEN_E2E=1 npx jest __tests__/e2e/zenToolCalling.e2e.test.ts
 *
 * What it proves end-to-end (the model-dependent seam that broke before with the
 * DSML format): our tool schema is accepted by a real GLM endpoint, and whatever
 * tool-call format it returns - structured `tool_calls` OR tool-call markup in the
 * content - is recovered into the right tool name + object args by the same code
 * the app uses (getToolsAsOpenAISchema + the structured/text extraction path).
 */

import { getToolsAsOpenAISchema } from '../../src/services/tools/registry';
import { parseToolCallsFromText } from '../../src/services/generationToolLoop';

const BASE = process.env.ZEN_BASE_URL || 'https://opencode.ai/zen/v1';
const MODEL = process.env.ZEN_MODEL || 'big-pickle';
const RUN = process.env.ZEN_E2E === '1';
const d = RUN ? describe : describe.skip;

type ToolCallLite = { name: string; arguments: Record<string, any> };

// run_python + its unlocked filesystem companions - the exact schema the app sends.
const TOOLS = getToolsAsOpenAISchema(['run_python']);
const KNOWN = new Set(TOOLS.map(t => t.function.name));

async function chat(userContent: string): Promise<any> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: userContent }],
      tools: TOOLS,
      stream: false,
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`zen HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).choices[0].message;
}

/** Mirror the app: prefer structured tool_calls, else parse tool-call markup from content. */
function extractToolCalls(msg: any): ToolCallLite[] {
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    return msg.tool_calls.map((tc: any) => {
      let args: Record<string, any> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* leave empty */ }
      return { name: tc.function.name, arguments: args };
    });
  }
  return parseToolCallsFromText(msg.content || '').toolCalls
    .map(tc => ({ name: tc.name, arguments: tc.arguments as Record<string, any> }));
}

d('zen big-pickle tool-calling e2e', () => {
  it('reaches the endpoint (no key) and lists the model', async () => {
    const res = await fetch(`${BASE}/models`);
    expect(res.ok).toBe(true);
    const ids = (await res.json()).data.map((m: any) => m.id);
    expect(ids).toContain(MODEL);
  }, 30000);

  it('our schema exposes run_python plus every filesystem companion', () => {
    expect([...KNOWN]).toEqual(
      expect.arrayContaining(['run_python', 'read_file', 'write_file', 'edit_file', 'list_files', 'grep']),
    );
  });

  it('calls run_python for a compute task; the extractor recovers a code string', async () => {
    const msg = await chat('Compute the sum of the integers from 1 to 100 by calling the run_python tool. Do not answer in prose - call the tool.');
    const calls = extractToolCalls(msg);
    expect(calls.length).toBeGreaterThan(0);
    const py = calls.find(c => c.name === 'run_python');
    expect(py).toBeTruthy();
    expect(typeof py!.arguments.code).toBe('string');
    expect(py!.arguments.code.length).toBeGreaterThan(0);
  }, 60000);

  it('drives the filesystem tools to create a file (write_file, or run_python that writes)', async () => {
    const msg = await chat('Create a file named notes.txt containing exactly the text "hello world", using the available file tools. Call a tool; do not answer in prose.');
    const calls = extractToolCalls(msg);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(KNOWN.has(c.name)).toBe(true); // no hallucinated tools
    const wf = calls.find(c => c.name === 'write_file');
    if (wf) {
      expect(typeof wf.arguments.path).toBe('string');
      expect(typeof wf.arguments.content).toBe('string');
    }
  }, 60000);

  it('every emitted tool call parses into a known tool with object args', async () => {
    const msg = await chat('List the files in the workspace and then search them for the word TODO, by calling the file tools. Do not answer in prose.');
    const calls = extractToolCalls(msg);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(KNOWN.has(c.name)).toBe(true);
      expect(typeof c.arguments).toBe('object');
    }
  }, 60000);
});
