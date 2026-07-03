/**
 * Python filesystem tool handler unit tests.
 *
 * The handlers build a Python snippet, run it through pythonRuntimeService.execute,
 * and format the JSON envelope the snippet prints. We mock execute to return canned
 * envelopes and assert (a) the model-facing formatting and (b) the request contract
 * (op + double-encoded args) the snippet is built from.
 */

import { executeToolCall } from '../../../../src/services/tools/handlers';

const SENTINEL = '<<FSJSON>>';
const mockExecute = jest.fn();
const mockIsInstalled = jest.fn();
const mockRefreshStatus = jest.fn();
const mockInstall = jest.fn();
jest.mock('../../../../src/services/python/pythonRuntimeService', () => ({
  pythonRuntimeService: {
    execute: (...args: any[]) => mockExecute(...args),
    isInstalled: () => mockIsInstalled(),
    refreshStatus: () => mockRefreshStatus(),
    install: () => mockInstall(),
  },
}));

let mockStatus = 'installed';
jest.mock('../../../../src/stores/pythonRuntimeStore', () => ({
  usePythonRuntimeStore: { getState: () => ({ status: mockStatus }) },
}));

/** Make execute resolve with a sentinel-wrapped envelope, as the Python snippet would. */
function emit(envelope: unknown) {
  mockExecute.mockResolvedValue({ ok: true, stdout: `${SENTINEL}${JSON.stringify(envelope)}\n`, stderr: '' });
}

function run(name: string, args: Record<string, unknown>) {
  return executeToolCall({ id: 'c1', name, arguments: args });
}

/** Recover the op name and decoded args from the generated Python (double-encoded). */
function decodeRequest(): { op: string; args: any } {
  const code: string = mockExecute.mock.calls[0][0];
  const op = /_fs_emit\(_fs_(\w+)\(/.exec(code)![1];
  const literal = /_req = json\.loads\((".*")\)/.exec(code)![1];
  const args = JSON.parse(JSON.parse(literal)); // undo the double-encode
  return { op, args };
}

describe('python filesystem tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = 'installed';
    mockIsInstalled.mockReturnValue(true);
    mockInstall.mockResolvedValue(undefined);
  });

  describe('read_file', () => {
    it('formats contents with 1-based line numbers and a header', async () => {
      emit({ ok: true, start: 0, total: 2, truncated: false, lines: ['import os', 'print(os.getcwd())'] });
      const res = await run('read_file', { path: 'a.py' });
      expect(res.content).toContain('a.py (2 lines)');
      expect(res.content).toContain('     1\timport os');
      expect(res.content).toContain('     2\tprint(os.getcwd())');
    });

    it('offsets line numbers by start and notes truncation', async () => {
      emit({ ok: true, start: 10, total: 500, truncated: true, lines: ['line eleven'] });
      const res = await run('read_file', { path: 'big.txt', offset: 10, limit: 1 });
      expect(res.content).toContain('    11\tline eleven');
      expect(res.content).toContain('truncated');
      expect(decodeRequest().args).toEqual({ path: 'big.txt', offset: 10, limit: 1 });
    });

    it('surfaces a not-found envelope as an error', async () => {
      emit({ ok: false, error: 'File not found: nope.py' });
      const res = await run('read_file', { path: 'nope.py' });
      expect(res.content).toBe('Error: File not found: nope.py');
    });

    it('requires a path', async () => {
      const res = await run('read_file', {});
      expect(res.content).toContain('requires a "path"');
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('write_file', () => {
    it('reports bytes and new-file status, passing content through unescaped', async () => {
      emit({ ok: true, bytes: 12, created: true, path: 'x.py' });
      const tricky = 'x = "he said \\"hi\\"\'"\nprint(x)\n'; // quotes + newlines
      const res = await run('write_file', { path: 'x.py', content: tricky });
      expect(res.content).toBe('Wrote 12 bytes to x.py (new file)');
      // The double-encoding round-trips arbitrary content intact.
      expect(decodeRequest().args).toEqual({ path: 'x.py', content: tricky });
    });

    it('says overwrote for an existing file', async () => {
      emit({ ok: true, bytes: 1, created: false, path: 'x.py' });
      const res = await run('write_file', { path: 'x.py', content: 'y' });
      expect(res.content).toBe('Wrote 1 byte to x.py (overwrote existing)');
    });
  });

  describe('edit_file', () => {
    it('reports the replacement count', async () => {
      emit({ ok: true, replacements: 1, path: 'x.py' });
      const res = await run('edit_file', { path: 'x.py', old_string: 'a', new_string: 'b' });
      expect(res.content).toBe('Made 1 replacement in x.py');
      expect(decodeRequest().args).toEqual({ path: 'x.py', old_string: 'a', new_string: 'b', replace_all: false });
    });

    it('surfaces the not-unique error from the interpreter', async () => {
      emit({ ok: false, error: 'old_string is not unique (3 matches) - add surrounding context or pass replace_all' });
      const res = await run('edit_file', { path: 'x.py', old_string: 'x', new_string: 'y' });
      expect(res.content).toContain('not unique');
    });

    it('validates that both strings are provided', async () => {
      const res = await run('edit_file', { path: 'x.py', old_string: 'a' });
      expect(res.content).toContain('requires "old_string" and "new_string"');
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('list_files', () => {
    it('marks directories with a trailing slash and shows file sizes', async () => {
      emit({ ok: true, path: '.', entries: [
        { name: 'src', is_dir: true, size: 0 },
        { name: 'main.py', is_dir: false, size: 42 },
      ] });
      const res = await run('list_files', {});
      expect(res.content).toContain('.:');
      expect(res.content).toContain('src/');
      expect(res.content).toContain('main.py  (42 B)');
      expect(decodeRequest().args).toEqual({ path: '.' });
    });

    it('reports an empty directory', async () => {
      emit({ ok: true, path: 'empty', entries: [] });
      const res = await run('list_files', { path: 'empty' });
      expect(res.content).toBe('empty: (empty)');
    });
  });

  describe('grep', () => {
    it('formats path:line matches', async () => {
      emit({ ok: true, truncated: false, matches: [
        { path: './a.py', line_no: 3, line: 'def foo():' },
        { path: './b.py', line_no: 9, line: '    foo()' },
      ] });
      const res = await run('grep', { pattern: 'foo', include: '*.py' });
      expect(res.content).toContain('./a.py:3: def foo():');
      expect(res.content).toContain('./b.py:9:     foo()');
      expect(decodeRequest().args).toEqual({ pattern: 'foo', path: '.', include: '*.py' });
    });

    it('reports no matches', async () => {
      emit({ ok: true, truncated: false, matches: [] });
      const res = await run('grep', { pattern: 'zzz' });
      expect(res.content).toBe('No matches for /zzz/');
    });

    it('notes when matches are capped', async () => {
      emit({ ok: true, truncated: true, matches: [{ path: './a', line_no: 1, line: 'x' }] });
      const res = await run('grep', { pattern: 'x' });
      expect(res.content).toContain('more matches');
    });
  });

  describe('runtime not installed', () => {
    it('self-heals: kicks off the download and returns an updating message without touching the fs', async () => {
      mockIsInstalled.mockReturnValue(false);
      const res = await run('read_file', { path: 'a.py' });
      expect(res.content).toContain('downloading');
      expect(res.content).toContain('Settings > Tools');
      expect(mockInstall).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  it('errors clearly when the interpreter returns no sentinel', async () => {
    mockExecute.mockResolvedValue({ ok: false, stdout: '', stderr: 'Traceback: boom' });
    const res = await run('read_file', { path: 'a.py' });
    expect(res.content).toContain('Filesystem operation failed');
    expect(res.content).toContain('boom');
  });
});
