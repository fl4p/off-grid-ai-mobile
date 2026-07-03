/**
 * run_python Tool Handler Unit Tests
 *
 * The handler is the model-facing surface: it must explain a missing runtime
 * instead of erroring, and format stdout / result / stderr / errors legibly.
 */

import { executeToolCall } from '../../../src/services/tools/handlers';

const mockExecute = jest.fn();
const mockIsInstalled = jest.fn();
const mockRefreshStatus = jest.fn();
const mockInstall = jest.fn();
jest.mock('../../../src/services/python/pythonRuntimeService', () => ({
  pythonRuntimeService: {
    execute: (...args: any[]) => mockExecute(...args),
    isInstalled: () => mockIsInstalled(),
    refreshStatus: () => mockRefreshStatus(),
    install: () => mockInstall(),
  },
}));

let mockStatus = 'installed';
jest.mock('../../../src/stores/pythonRuntimeStore', () => ({
  usePythonRuntimeStore: { getState: () => ({ status: mockStatus }) },
}));

function runPython(code: unknown, extra: Record<string, unknown> = {}) {
  return executeToolCall({ id: 'call_1', name: 'run_python', arguments: { code, ...extra } });
}

describe('run_python handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = 'installed';
    mockIsInstalled.mockReturnValue(true);
    mockInstall.mockResolvedValue(undefined);
  });

  it('errors when code is missing', async () => {
    const result = await runPython(undefined);
    expect(result.error).toContain('Missing required parameter: code');
  });

  it('self-heals a missing runtime: kicks off the re-download and tells the user it is updating', async () => {
    mockIsInstalled.mockReturnValue(false);
    const result = await runPython('print(1)');
    expect(result.error).toBeUndefined();
    // The enabled-but-not-installed case re-downloads instead of dead-ending.
    expect(result.content).toContain('downloading');
    expect(result.content).toContain('Settings > Tools');
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('refreshes status first when it is unknown', async () => {
    mockStatus = 'unknown';
    mockIsInstalled.mockReturnValue(false);
    await runPython('print(1)');
    expect(mockRefreshStatus).toHaveBeenCalledTimes(1);
  });

  it('returns stdout and the last expression value', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: 'hello', stderr: '', result: '42' });
    const result = await runPython('print("hello")\n42');
    expect(result.content).toBe('hello\n[result] 42');
  });

  it('includes stderr and python errors', async () => {
    mockExecute.mockResolvedValue({ ok: false, stdout: '', stderr: 'Traceback...', error: "NameError: name 'x' is not defined" });
    const result = await runPython('x');
    expect(result.content).toContain('[stderr]\nTraceback...');
    expect(result.content).toContain("[error]\nNameError: name 'x' is not defined");
  });

  it('adds a recovery hint when code tries to spawn a process (git/subprocess) in the sandbox', async () => {
    mockExecute.mockResolvedValue({
      ok: false, stdout: '', stderr: 'File "subprocess.py", line 818, in __init__',
      error: 'OSError: [Errno 138] emscripten does not support processes.',
    });
    const result = await runPython('import subprocess; subprocess.run(["git", "clone", "..."])');
    expect(result.content).toContain('[hint]');
    expect(result.content).toContain('read_url');
    expect(result.content).toContain('write_file');
  });

  it('adds the recovery hint when code tries a network socket (requests/urllib)', async () => {
    mockExecute.mockResolvedValue({
      ok: false, stdout: '', stderr: '', error: 'URLError: <urlopen error [Errno 138] emscripten does not support socket>',
    });
    const result = await runPython('import urllib.request; urllib.request.urlopen("https://x")');
    expect(result.content).toContain('[hint]');
    expect(result.content).toContain('read_url');
  });

  it('does not add the recovery hint for an ordinary python error', async () => {
    mockExecute.mockResolvedValue({ ok: false, stdout: '', stderr: '', error: "NameError: name 'x' is not defined" });
    const result = await runPython('x');
    expect(result.content).not.toContain('[hint]');
  });

  it('hints at print() when the script produced no output', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: '', stderr: '', result: undefined });
    const result = await runPython('x = 1');
    expect(result.content).toContain('use print()');
  });

  it('truncates very long output, keeping the tail (the end is what matters)', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: `HEAD_MARKER${'a'.repeat(10000)}TAIL_MARKER`, stderr: '' });
    const result = await runPython('print("a" * 10000)');
    expect(result.content.length).toBeLessThan(6200);
    expect(result.content).toContain('[earlier output truncated]');
    // The tail survives, the head is dropped.
    expect(result.content).toContain('TAIL_MARKER');
    expect(result.content).not.toContain('HEAD_MARKER');
  });

  it('surfaces execution timeouts as tool errors', async () => {
    mockExecute.mockRejectedValue(new Error('Python execution timed out after 30s'));
    const result = await runPython('while True: pass');
    expect(result.error).toContain('timed out');
  });

  it('passes a comma-separated packages arg through to execute', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: 'done', stderr: '' });
    await runPython('import requests', { packages: 'requests, beautifulsoup4' });
    expect(mockExecute).toHaveBeenCalledWith('import requests', { packages: ['requests', 'beautifulsoup4'] });
  });

  it('omits the packages option when none are requested', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: 'x', stderr: '' });
    await runPython('print(1)');
    expect(mockExecute).toHaveBeenCalledWith('print(1)', {});
  });

  it('saves returned plot images as attachments and notes them for the model', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: '', stderr: '', images: ['iVBORw0KGgo=', 'AAAA'] });
    const result = await runPython('plt.plot(...)', { packages: 'matplotlib' });

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments![0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(result.attachments![0].uri).toMatch(/^file:\/\/.*\/python-plots\/plot-.*\.png$/);
    // The model can't see the image, so the text tells it a plot was shown.
    expect(result.content).toContain('2 plots shown to the user');
  });

  it('returns no attachments when the run produced no images', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: 'hi', stderr: '' });
    const result = await runPython('print("hi")');
    expect(result.attachments).toBeUndefined();
  });

  it('truncates without splitting a surrogate pair', async () => {
    // 'x' + emoji repeated: the leading 'x' pushes every 2-unit emoji onto an odd
    // boundary, so a naive slice at 6000 would land mid-pair and leave a lone surrogate.
    mockExecute.mockResolvedValue({ ok: true, stdout: `x${'🎉'.repeat(4000)}`, stderr: '' });
    const result = await runPython('print(...)');
    // No unpaired surrogate survives the cut.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result.content)).toBe(false);
    expect(result.content).toContain('[earlier output truncated]');
  });
});
