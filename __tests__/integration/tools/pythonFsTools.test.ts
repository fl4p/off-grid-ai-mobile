/**
 * Integration: Python filesystem tools over a shared workspace.
 *
 * Pyodide can't run in jest, so we stand in a JS fake interpreter that keeps an
 * in-memory file map and applies each op the way the injected Python would. This
 * exercises the real handlers + dispatch end-to-end and, crucially, that files
 * written by one tool are visible to the others (the shared-MEMFS contract).
 */

import { executeToolCall } from '../../../src/services/tools/handlers';

// The mock factory is hoisted and may not reference out-of-scope vars, so the fake
// interpreter and its in-memory file map live entirely inside it; __files is exposed
// back so the test can reset the workspace between cases.
jest.mock('../../../src/services/python/pythonRuntimeService', () => {
  const files = new Map<string, string>();
  const globToRegExp = (glob: string) =>
    new RegExp(`^${glob.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);

  function fakeExecute(code: string) {
    const op = /_fs_emit\(_fs_(\w+)\(/.exec(code)![1];
    const literal = /_req = json\.loads\((".*")\)/.exec(code)![1];
    const req = JSON.parse(JSON.parse(literal));
    let env: any;

    if (op === 'write') {
      const existed = files.has(req.path);
      files.set(req.path, req.content ?? '');
      env = { ok: true, bytes: Buffer.byteLength(req.content ?? '', 'utf8'), created: !existed, path: req.path };
    } else if (op === 'read') {
      if (!files.has(req.path)) env = { ok: false, error: `File not found: ${req.path}` };
      else {
        const lines = files.get(req.path)!.split('\n');
        const start = Number(req.offset || 0);
        const end = req.limit ? Math.min(lines.length, start + Number(req.limit)) : lines.length;
        env = { ok: true, start, total: lines.length, truncated: end < lines.length, lines: lines.slice(start, end) };
      }
    } else if (op === 'edit') {
      if (!files.has(req.path)) env = { ok: false, error: `File not found: ${req.path}` };
      else {
        const data = files.get(req.path)!;
        const count = data.split(req.old_string).length - 1;
        if (count === 0) env = { ok: false, error: `old_string not found in ${req.path}` };
        else if (count > 1 && !req.replace_all) env = { ok: false, error: `old_string is not unique (${count} matches) - add surrounding context or pass replace_all` };
        else {
          const next = req.replace_all ? data.split(req.old_string).join(req.new_string) : data.replace(req.old_string, req.new_string);
          files.set(req.path, next);
          env = { ok: true, replacements: req.replace_all ? count : 1, path: req.path };
        }
      }
    } else if (op === 'ls') {
      const path = req.path || '.';
      const entries: any[] = [];
      const dirs = new Set<string>();
      for (const [key, content] of files) {
        const seg = key.split('/');
        if (seg.length === 1) entries.push({ name: seg[0], is_dir: false, size: Buffer.byteLength(content, 'utf8') });
        else if (!dirs.has(seg[0])) { dirs.add(seg[0]); entries.push({ name: seg[0], is_dir: true, size: 0 }); }
      }
      env = { ok: true, path, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
    } else if (op === 'grep') {
      const rx = new RegExp(req.pattern);
      const matches: any[] = [];
      for (const [p, content] of files) {
        if (req.include && !globToRegExp(req.include).test(p.split('/').pop()!)) continue;
        content.split('\n').forEach((line: string, i: number) => {
          if (rx.test(line)) matches.push({ path: p, line_no: i + 1, line });
        });
      }
      env = { ok: true, matches, truncated: false };
    }

    return Promise.resolve({ ok: true, stdout: `<<FSJSON>>${JSON.stringify(env)}\n`, stderr: '' });
  }

  return {
    __files: files,
    pythonRuntimeService: {
      execute: (code: string) => fakeExecute(code),
      isInstalled: () => true,
      refreshStatus: () => Promise.resolve(),
      install: () => Promise.resolve(),
    },
  };
});
jest.mock('../../../src/stores/pythonRuntimeStore', () => ({
  usePythonRuntimeStore: { getState: () => ({ status: 'installed' }) },
}));

const { __files } = require('../../../src/services/python/pythonRuntimeService') as { __files: Map<string, string> };

function call(name: string, args: Record<string, unknown>) {
  return executeToolCall({ id: `c-${name}`, name, arguments: args });
}

describe('Python filesystem tools over a shared workspace', () => {
  beforeEach(() => __files.clear());

  it('write -> list -> read -> edit -> grep all see the same files', async () => {
    // 1. Two files written by write_file.
    await call('write_file', { path: 'main.py', content: "def greet():\n    return 'hi'\n" });
    await call('write_file', { path: 'util/helper.py', content: 'X = 1\n' });

    // 2. list_files sees the file and the derived directory.
    const ls = await call('list_files', {});
    expect(ls.content).toContain('main.py');
    expect(ls.content).toContain('util/');

    // 3. read_file returns what write_file wrote, with line numbers.
    const read = await call('read_file', { path: 'main.py' });
    expect(read.content).toContain("     2\t    return 'hi'");

    // 4. edit_file mutates it; the change is visible on the next read.
    const edit = await call('edit_file', { path: 'main.py', old_string: "'hi'", new_string: "'hello'" });
    expect(edit.content).toBe('Made 1 replacement in main.py');
    const read2 = await call('read_file', { path: 'main.py' });
    expect(read2.content).toContain("'hello'");
    expect(read2.content).not.toContain("'hi'");

    // 5. grep searches across the workspace, honoring the include glob.
    const grep = await call('grep', { pattern: '^def ', include: '*.py' });
    expect(grep.content).toContain('main.py:1: def greet():');
    expect(grep.content).not.toContain('helper.py');
  });

  it('reports a missing file as an error, not a crash', async () => {
    const res = await call('read_file', { path: 'ghost.py' });
    expect(res.error).toBeUndefined();
    expect(res.content).toBe('Error: File not found: ghost.py');
  });

  it('rejects an ambiguous edit unless replace_all is set', async () => {
    await call('write_file', { path: 'd.py', content: 'a\na\na\n' });
    const ambiguous = await call('edit_file', { path: 'd.py', old_string: 'a', new_string: 'b' });
    expect(ambiguous.content).toContain('not unique');

    const all = await call('edit_file', { path: 'd.py', old_string: 'a', new_string: 'b', replace_all: true });
    expect(all.content).toBe('Made 3 replacements in d.py');
  });
});
