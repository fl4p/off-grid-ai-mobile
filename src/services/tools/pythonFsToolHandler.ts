/**
 * Python filesystem tools (read_file / write_file / edit_file / list_files / grep).
 *
 * These operate on the SAME in-memory Pyodide filesystem (MEMFS) that run_python
 * code sees, by running small Python snippets through pythonRuntimeService.execute.
 * A file written by run_python is therefore readable by read_file and vice versa,
 * and both share the interpreter's working directory (Pyodide's cwd, /home/pyodide).
 *
 * The MEMFS is RAM-only and resets when the interpreter reloads (hung-script
 * recovery, disabling Python, app restart) - it is a per-session scratch workspace,
 * not durable storage.
 *
 * Contract: each op runs `FS_HELPER_PY` (idempotent library) plus a call that prints
 * `<<FSJSON>>` followed by a single-line JSON envelope. Args are passed as a
 * double-JSON-encoded literal so arbitrary content (quotes, newlines, unicode)
 * survives embedding in the Python source without escaping bugs or code injection.
 */

import type { ToolCall } from './types';
import { ensurePythonRuntimeReady } from './pythonToolHandler';

const FS_SENTINEL = '<<FSJSON>>';

/**
 * Python library injected before each op. Read/grep are char-capped so a large file
 * can't build a JSON envelope bigger than the WebView stdout ceiling (100k) and get
 * truncated mid-parse. All helpers return a plain dict; none raise past _fs_emit.
 */
const FS_HELPER_PY = `
import os, re, json, fnmatch
_FS_SENTINEL = ${JSON.stringify(FS_SENTINEL)}
_FS_MAX_CHARS = 30000
_FS_MAX_MATCHES = 100

def _fs_emit(obj):
    print(_FS_SENTINEL + json.dumps(obj))

def _fs_read(req):
    path = req["path"]
    if not os.path.exists(path):
        return {"ok": False, "error": "File not found: " + path}
    if os.path.isdir(path):
        return {"ok": False, "error": "Is a directory: " + path}
    with open(path, "r", errors="replace") as f:
        lines = f.read().split("\\n")
    total = len(lines)
    start = max(0, int(req.get("offset") or 0))
    limit = req.get("limit")
    end = total if limit in (None, 0, "") else min(total, start + int(limit))
    out, acc, truncated = [], 0, end < total
    for ln in lines[start:end]:
        if acc + len(ln) + 1 > _FS_MAX_CHARS:
            truncated = True
            break
        out.append(ln)
        acc += len(ln) + 1
    return {"ok": True, "start": start, "total": total, "truncated": truncated, "lines": out}

def _fs_write(req):
    path = req["path"]
    content = req.get("content", "")
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    existed = os.path.exists(path)
    with open(path, "w") as f:
        f.write(content)
    return {"ok": True, "bytes": len(content.encode("utf-8")), "created": not existed, "path": path}

def _fs_edit(req):
    path = req["path"]
    old = req["old_string"]
    new = req["new_string"]
    replace_all = bool(req.get("replace_all"))
    if not os.path.exists(path):
        return {"ok": False, "error": "File not found: " + path}
    with open(path, "r") as f:
        data = f.read()
    count = data.count(old)
    if count == 0:
        return {"ok": False, "error": "old_string not found in " + path}
    if count > 1 and not replace_all:
        return {"ok": False, "error": "old_string is not unique (" + str(count) + " matches) - add surrounding context or pass replace_all"}
    data = data.replace(old, new) if replace_all else data.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(data)
    return {"ok": True, "replacements": count if replace_all else 1, "path": path}

def _fs_ls(req):
    path = req.get("path") or "."
    if not os.path.exists(path):
        return {"ok": False, "error": "Path not found: " + path}
    if os.path.isfile(path):
        return {"ok": True, "path": path, "entries": [{"name": os.path.basename(path), "is_dir": False, "size": os.path.getsize(path)}]}
    entries = []
    for name in sorted(os.listdir(path)):
        full = os.path.join(path, name)
        is_dir = os.path.isdir(full)
        entries.append({"name": name, "is_dir": is_dir, "size": 0 if is_dir else os.path.getsize(full)})
    return {"ok": True, "path": path, "entries": entries}

def _fs_grep(req):
    pattern = req["pattern"]
    root = req.get("path") or "."
    include = req.get("include")
    try:
        rx = re.compile(pattern)
    except re.error as e:
        return {"ok": False, "error": "Invalid regex: " + str(e)}
    paths = []
    if os.path.isfile(root):
        paths = [root]
    elif os.path.isdir(root):
        for dirpath, _dirs, files in os.walk(root):
            for fn in files:
                if include and not fnmatch.fnmatch(fn, include):
                    continue
                paths.append(os.path.join(dirpath, fn))
    else:
        return {"ok": False, "error": "Path not found: " + root}
    matches = []
    for p in sorted(paths):
        try:
            with open(p, "r", errors="replace") as f:
                for i, line in enumerate(f, 1):
                    if rx.search(line):
                        matches.append({"path": p, "line_no": i, "line": line.rstrip("\\n")[:300]})
                        if len(matches) >= _FS_MAX_MATCHES:
                            return {"ok": True, "matches": matches, "truncated": True}
        except Exception:
            continue
    return {"ok": True, "matches": matches, "truncated": False}
`;

function str(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

/** Run one filesystem op in the interpreter and return its parsed JSON envelope. */
async function runFsOp(op: string, args: Record<string, unknown>): Promise<any> {
  const { pythonRuntimeService } = require('../python/pythonRuntimeService'); // NOSONAR
  // Double-encode: JSON.stringify(json) yields a valid Python string literal, so
  // any content round-trips through json.loads without escaping or injection risk.
  const literal = JSON.stringify(JSON.stringify(args));
  const code = `${FS_HELPER_PY}\n_req = json.loads(${literal})\n_fs_emit(_fs_${op}(_req))\n`;
  const res = await pythonRuntimeService.execute(code, {});
  const out = String(res?.stdout ?? '');
  const idx = out.indexOf(FS_SENTINEL);
  if (idx === -1) {
    const detail = String(res?.error || res?.stderr || 'no output').trim();
    return { ok: false, error: `Filesystem operation failed: ${detail}` };
  }
  try {
    return JSON.parse(out.slice(idx + FS_SENTINEL.length).trim());
  } catch {
    return { ok: false, error: 'Could not parse filesystem result' };
  }
}

export async function handleReadFile(call: ToolCall): Promise<string> {
  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;
  const path = str(call.arguments.path);
  if (!path) return 'Error: read_file requires a "path".';
  const r = await runFsOp('read', { path, offset: call.arguments.offset, limit: call.arguments.limit });
  if (!r.ok) return `Error: ${r.error}`;
  const header = `${path} (${r.total} line${r.total === 1 ? '' : 's'})`;
  if (!r.lines.length) return `${header}\n(empty)`;
  const body = r.lines
    .map((ln: string, i: number) => `${String(r.start + i + 1).padStart(6)}\t${ln}`)
    .join('\n');
  const note = r.truncated ? '\n... (truncated - pass offset/limit to read more)' : '';
  return `${header}\n${body}${note}`;
}

export async function handleWriteFile(call: ToolCall): Promise<string> {
  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;
  const path = str(call.arguments.path);
  if (!path) return 'Error: write_file requires a "path".';
  const content = typeof call.arguments.content === 'string' ? call.arguments.content : '';
  const r = await runFsOp('write', { path, content });
  if (!r.ok) return `Error: ${r.error}`;
  return `Wrote ${r.bytes} byte${r.bytes === 1 ? '' : 's'} to ${r.path} ${r.created ? '(new file)' : '(overwrote existing)'}`;
}

export async function handleEditFile(call: ToolCall): Promise<string> {
  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;
  const path = str(call.arguments.path);
  if (!path) return 'Error: edit_file requires a "path".';
  const oldString = call.arguments.old_string;
  const newString = call.arguments.new_string;
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return 'Error: edit_file requires "old_string" and "new_string".';
  }
  const r = await runFsOp('edit', {
    path, old_string: oldString, new_string: newString, replace_all: !!call.arguments.replace_all,
  });
  if (!r.ok) return `Error: ${r.error}`;
  return `Made ${r.replacements} replacement${r.replacements === 1 ? '' : 's'} in ${r.path}`;
}

export async function handleListFiles(call: ToolCall): Promise<string> {
  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;
  const path = str(call.arguments.path) || '.';
  const r = await runFsOp('ls', { path });
  if (!r.ok) return `Error: ${r.error}`;
  if (!r.entries.length) return `${r.path}: (empty)`;
  const lines = r.entries.map((e: { name: string; is_dir: boolean; size: number }) =>
    e.is_dir ? `${e.name}/` : `${e.name}  (${e.size} B)`);
  return `${r.path}:\n${lines.join('\n')}`;
}

export async function handleGrep(call: ToolCall): Promise<string> {
  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;
  const pattern = str(call.arguments.pattern);
  if (!pattern) return 'Error: grep requires a "pattern".';
  const r = await runFsOp('grep', {
    pattern, path: str(call.arguments.path) || '.', include: str(call.arguments.include),
  });
  if (!r.ok) return `Error: ${r.error}`;
  if (!r.matches.length) return `No matches for /${pattern}/`;
  const lines = r.matches.map((m: { path: string; line_no: number; line: string }) =>
    `${m.path}:${m.line_no}: ${m.line}`);
  const note = r.truncated ? '\n... (more matches - refine the pattern or narrow the path)' : '';
  return `${lines.join('\n')}${note}`;
}

/** Exposed for tests. */
export const __test = { FS_SENTINEL, FS_HELPER_PY };
