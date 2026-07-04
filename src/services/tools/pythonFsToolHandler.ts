/**
 * Python filesystem tools (read_file / write_file / edit_file / list_files / grep).
 *
 * These operate on the SAME in-memory Pyodide filesystem (MEMFS) that run_python
 * code sees, by running small Python snippets through pythonRuntimeService.execute.
 * A file written by run_python is therefore readable by read_file and vice versa,
 * and both share the interpreter's working directory (the /workspace cwd).
 *
 * The workspace is scoped per project and persisted: pythonRuntimeService snapshots
 * it to native storage and restores it on the next run, so files survive an
 * interpreter reload and are shared across a project's conversations.
 *
 * Contract: each op runs `FS_HELPER_PY` (idempotent library) plus a call that prints
 * `<<FSJSON>>` followed by a single-line JSON envelope. Args are passed as a
 * double-JSON-encoded literal so arbitrary content (quotes, newlines, unicode)
 * survives embedding in the Python source without escaping bugs or code injection.
 * Every op is wrapped so any Python error still emits an envelope (never a bare
 * traceback), and paths are confined to the workspace so an op can't walk the
 * Pyodide stdlib. All helper names are `_fs_`-prefixed so they don't collide with
 * (or rebind) the user's run_python globals.
 */

import type { ToolCall } from './types';
import { ensurePythonRuntimeReady } from './pythonToolHandler';

const FS_SENTINEL = '<<FSJSON>>';

/**
 * Python library injected before each op. Read/grep are char/match capped so a big
 * file can't build a JSON envelope past the WebView stdout ceiling (100k) and get
 * truncated mid-parse; the envelope uses ensure_ascii=False so non-ASCII content
 * stays ~1 char instead of a 6-12x \\uXXXX blowup that would defeat the cap.
 */
const FS_HELPER_PY = `
import os as _fs_os, re as _fs_re, json as _fs_json, fnmatch as _fs_fnmatch
_FS_SENTINEL = ${JSON.stringify(FS_SENTINEL)}
_FS_MAX_CHARS = 30000
_FS_MAX_MATCHES = 100

def _fs_emit(obj):
    print(_FS_SENTINEL + _fs_json.dumps(obj, ensure_ascii=False))

def _fs_confine(path):
    # Confine to the workspace (cwd). Absolute paths and parent escapes are rejected
    # so an op can't read/walk the Pyodide stdlib or hang os.walk on the whole tree.
    if _fs_os.path.isabs(path):
        raise ValueError("absolute paths are not allowed; use a path inside the workspace: " + path)
    root = _fs_os.path.realpath(".")
    full = _fs_os.path.realpath(path)
    if full != root and not full.startswith(root + "/"):
        raise ValueError("path escapes the workspace: " + path)
    return path

def _fs_read(req):
    path = _fs_confine(req["path"])
    if not _fs_os.path.exists(path):
        return {"ok": False, "error": "File not found: " + path}
    if _fs_os.path.isdir(path):
        return {"ok": False, "error": "Is a directory: " + path}
    with open(path, "r", errors="replace") as f:
        text = f.read()
    # split("\\n") on a newline-terminated file leaves a trailing "" - drop it so the
    # reported line count (and display) matches the real number of lines.
    if text == "":
        lines = []
    else:
        lines = text.split("\\n")
        if text.endswith("\\n"):
            lines = lines[:-1]
    total = len(lines)
    start = req.get("offset") or 0
    limit = req.get("limit")
    end = total if limit is None else min(total, start + limit)
    out, acc, truncated = [], 0, end < total
    for ln in lines[start:end]:
        if out and acc + len(ln) + 1 > _FS_MAX_CHARS:
            truncated = True
            break
        out.append(ln)
        acc += len(ln) + 1
    over = bool(out) and len(out[0]) + 1 > _FS_MAX_CHARS
    return {"ok": True, "start": start, "total": total, "truncated": truncated,
            "line_too_long": over, "lines": out}

def _fs_write(req):
    path = _fs_confine(req["path"])
    content = req.get("content", "")
    d = _fs_os.path.dirname(path)
    if d:
        _fs_os.makedirs(d, exist_ok=True)
    existed = _fs_os.path.exists(path)
    # surrogatepass so a lone surrogate in model-supplied content writes instead of
    # raising UnicodeEncodeError.
    with open(path, "w", errors="surrogatepass") as f:
        f.write(content)
    return {"ok": True, "bytes": len(content.encode("utf-8", "surrogatepass")),
            "created": not existed, "path": req["path"]}

def _fs_edit(req):
    path = _fs_confine(req["path"])
    old = req["old_string"]
    new = req["new_string"]
    replace_all = bool(req.get("replace_all"))
    if not _fs_os.path.exists(path):
        return {"ok": False, "error": "File not found: " + path}
    with open(path, "r", errors="replace") as f:
        data = f.read()
    count = data.count(old)
    if count == 0:
        return {"ok": False, "error": "old_string not found in " + path}
    if count > 1 and not replace_all:
        return {"ok": False, "error": "old_string is not unique (" + str(count) + " matches) - add surrounding context or pass replace_all"}
    data = data.replace(old, new) if replace_all else data.replace(old, new, 1)
    with open(path, "w", errors="surrogatepass") as f:
        f.write(data)
    return {"ok": True, "replacements": count if replace_all else 1, "path": req["path"]}

def _fs_ls(req):
    disp = req.get("path") or "."
    path = _fs_confine(disp)
    if not _fs_os.path.exists(path):
        return {"ok": False, "error": "Path not found: " + disp}
    if _fs_os.path.isfile(path):
        return {"ok": True, "path": disp, "entries": [{"name": _fs_os.path.basename(path), "is_dir": False, "size": _fs_os.path.getsize(path)}]}
    entries = []
    for name in sorted(_fs_os.listdir(path)):
        full = _fs_os.path.join(path, name)
        is_dir = _fs_os.path.isdir(full)
        entries.append({"name": name, "is_dir": is_dir, "size": 0 if is_dir else _fs_os.path.getsize(full)})
    return {"ok": True, "path": disp, "entries": entries}

def _fs_grep(req):
    pattern = req["pattern"]
    disp = req.get("path") or "."
    root = _fs_confine(disp)
    include = req.get("include")
    try:
        rx = _fs_re.compile(pattern)
    except _fs_re.error as e:
        return {"ok": False, "error": "Invalid regex: " + str(e)}
    paths = []
    if _fs_os.path.isfile(root):
        paths = [root]
    elif _fs_os.path.isdir(root):
        for dirpath, _dirs, files in _fs_os.walk(root):
            for fn in files:
                if include and not _fs_fnmatch.fnmatch(fn, include):
                    continue
                paths.append(_fs_os.path.join(dirpath, fn))
    else:
        return {"ok": False, "error": "Path not found: " + disp}
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

/** Coerce a model-supplied count (often a string) to a non-negative int, or undefined. */
function toCount(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Math.trunc(Number(val));
  return Number.isFinite(n) ? n : undefined;
}

/** True only for a real boolean true or the string "true" (models stringify booleans). */
function toBool(val: unknown): boolean {
  return val === true || val === 'true';
}

/** Run one filesystem op in the interpreter and return its parsed JSON envelope. */
async function runFsOp(op: string, args: Record<string, unknown>, projectId?: string): Promise<any> {
  const { pythonRuntimeService } = require('../python/pythonRuntimeService'); // NOSONAR
  // Double-encode: JSON.stringify(json) yields a valid Python string literal, so
  // any content round-trips through json.loads without escaping or injection risk.
  const literal = JSON.stringify(JSON.stringify(args));
  // Wrap so any Python error (e.g. a confinement rejection) still emits an envelope
  // rather than a bare traceback that runFsOp would fail to parse.
  const code = `${FS_HELPER_PY}
try:
    _fs_req = _fs_json.loads(${literal})
    _fs_emit(_fs_${op}(_fs_req))
except Exception as _fs_e:
    _fs_emit({"ok": False, "error": "Filesystem error: " + str(_fs_e)})
`;
  // Scope the op to the caller's project workspace (shared across its conversations).
  const res = await pythonRuntimeService.execute(code, { projectId });
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
  let offset = toCount(call.arguments.offset) ?? 0;
  if (offset < 0) offset = 0;
  let limit = toCount(call.arguments.limit);
  if (limit !== undefined && limit <= 0) limit = undefined; // 0/negative -> read all
  const r = await runFsOp('read', { path, offset, limit }, call.context?.projectId);
  if (!r.ok) return `Error: ${r.error}`;
  const header = `${path} (${r.total} line${r.total === 1 ? '' : 's'})`;
  if (!r.lines.length) {
    return r.line_too_long
      ? `${header}\n(line ${offset + 1} exceeds the per-read size limit - it is not shown; try a later offset)`
      : `${header}\n(empty)`;
  }
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
  if (typeof call.arguments.content !== 'string') {
    return 'Error: write_file requires string "content" (pass an empty string to clear a file).';
  }
  const r = await runFsOp('write', { path, content: call.arguments.content }, call.context?.projectId);
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
  if (oldString === '') return 'Error: edit_file "old_string" must not be empty.';
  const r = await runFsOp('edit', {
    path, old_string: oldString, new_string: newString, replace_all: toBool(call.arguments.replace_all),
  }, call.context?.projectId);
  if (!r.ok) return `Error: ${r.error}`;
  return `Made ${r.replacements} replacement${r.replacements === 1 ? '' : 's'} in ${r.path}`;
}

export async function handleListFiles(call: ToolCall): Promise<string> {
  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;
  const path = str(call.arguments.path) || '.';
  const r = await runFsOp('ls', { path }, call.context?.projectId);
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
  }, call.context?.projectId);
  if (!r.ok) return `Error: ${r.error}`;
  if (!r.matches.length) return `No matches for /${pattern}/`;
  const lines = r.matches.map((m: { path: string; line_no: number; line: string }) =>
    `${m.path}:${m.line_no}: ${m.line}`);
  const note = r.truncated ? '\n... (more matches - refine the pattern or narrow the path)' : '';
  return `${lines.join('\n')}${note}`;
}

/** Exposed for tests. */
export const __test = { FS_SENTINEL, FS_HELPER_PY };
