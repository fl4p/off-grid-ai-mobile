/**
 * Python Executor Page
 *
 * Generates the HTML page the hidden WebView loads from the local static
 * server. The page boots Pyodide and exposes window.__runPython, which the
 * runtime service invokes via injectJavaScript. Results flow back through
 * window.ReactNativeWebView.postMessage as JSON.
 *
 * Sandbox: the CSP restricts network access to the local server itself plus
 * the PyPI hosts micropip needs. Model-written code cannot reach any other
 * origin, and Pyodide's filesystem is in-memory only.
 */

/** Message from the page to the runtime service. */
export interface PythonPageMessage {
  type: 'booting' | 'ready' | 'result' | 'boot_error' | 'fs_snapshot' | 'fs_restore';
  id?: string;
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  result?: string;
  error?: string;
  version?: string;
  /** Boot progress marker (for `type: 'booting'`): which phase the page reached. */
  phase?: string;
  /** Base64 PNGs of matplotlib figures captured after the run. */
  images?: string[];
  /** Workspace snapshot manifest (JSON string) for `type: 'fs_snapshot'`. */
  data?: string;
}

/** The persistent, snapshotted working directory both run_python and the fs tools use. */
export const PYTHON_WORKSPACE_DIR = '/workspace';

/** Request injected into the page. */
export interface PythonPageRequest {
  id: string;
  code: string;
  /** PyPI/pyodide packages to micropip-install before running the code (needs network). */
  packages?: string[];
}

/**
 * Per-stream character ceiling enforced inside the page's stdout/stderr sinks,
 * before anything is serialized across the WebView bridge. Sized well above the
 * native-side model cap (6000) so normal output is untouched, but low enough
 * that a runaway print loop can't build a multi-MB string on a low-RAM device.
 */
export const PAGE_MAX_STREAM_CHARS = 100000;

/** Max matplotlib figures captured per run (protects the bridge from image floods). */
export const MAX_FIGURES = 4;

/** Max base64 length for a single captured figure (~4 MB PNG) before it's dropped. */
export const MAX_IMAGE_CHARS = 6000000;

const CSP = [
  "default-src 'self'",
  // Pyodide needs eval for its JS/Python FFI and WASM compilation.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  // 'self' covers local wheel loading; the PyPI hosts enable micropip installs.
  "connect-src 'self' https://pypi.org https://files.pythonhosted.org https://cdn.jsdelivr.net",
].join('; ');

export function buildPythonPageHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
</head>
<body>
<script src="pyodide.js"></script>
<script>
(function () {
  // Hard ceiling per stream so unbounded output (e.g. print('a' * 200_000_000))
  // cannot materialize a giant string, cross the bridge, and OOM the app. The
  // native side truncates again for the model; this cap protects the device.
  var MAX_STREAM_CHARS = ${PAGE_MAX_STREAM_CHARS};

  // Python strings can carry lone UTF-16 surrogates (e.g. errors='surrogateescape'
  // when decoding bytes). Those corrupt the native postMessage bridge, so replace
  // any unpaired surrogate with U+FFFD before sending.
  function sanitizeSurrogates(s) {
    return s.replace(/[\\uD800-\\uDFFF]/g, function (ch, i) {
      var code = ch.charCodeAt(0);
      if (code <= 0xDBFF) {
        var next = s.charCodeAt(i + 1);
        return (next >= 0xDC00 && next <= 0xDFFF) ? ch : '\\uFFFD';
      }
      var prev = s.charCodeAt(i - 1);
      return (prev >= 0xD800 && prev <= 0xDBFF) ? ch : '\\uFFFD';
    });
  }

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(sanitizeSurrogates(JSON.stringify(msg)));
    }
  }

  // Bounded accumulator: appends until the ceiling, then stops and flags overflow.
  function makeSink() {
    return { text: '', truncated: false };
  }
  function append(sink, s) {
    if (sink.truncated) return;
    if (sink.text.length >= MAX_STREAM_CHARS) { sink.truncated = true; return; }
    var remaining = MAX_STREAM_CHARS - sink.text.length;
    if (s.length > remaining) {
      sink.text += s.slice(0, remaining);
      sink.truncated = true;
    } else {
      sink.text += s + '\\n';
    }
  }
  function finalize(sink) {
    return sink.truncated ? sink.text + '\\n[output truncated]' : sink.text;
  }

  // Grab any open matplotlib figures as base64 PNGs, so plots can be shown in the
  // chat. Only runs if the code actually imported matplotlib (checked via
  // sys.modules) so we never force-load the ~10MB backend for non-plotting code.
  // Capped at MAX_FIGURES; figures are closed afterwards to free interpreter memory.
  var MAX_FIGURES = ${MAX_FIGURES};
  var CAPTURE_SRC =
    'import sys as _sys\\n' +
    'def _capture_figs():\\n' +
    '    if "matplotlib" not in _sys.modules: return []\\n' +
    '    import base64 as _b64, io as _io\\n' +
    '    import matplotlib.pyplot as _plt\\n' +
    '    _imgs = []\\n' +
    '    for _n in _plt.get_fignums()[:' + MAX_FIGURES + ']:\\n' +
    '        _buf = _io.BytesIO()\\n' +
    '        _plt.figure(_n).savefig(_buf, format="png", bbox_inches="tight")\\n' +
    '        _imgs.append(_b64.b64encode(_buf.getvalue()).decode())\\n' +
    '    _plt.close("all")\\n' +
    '    return _imgs\\n';

  // Drop any single figure whose base64 exceeds this, so a huge plot can't push
  // multi-MB across the bridge (kept generous — a normal plot is tens of KB).
  var MAX_IMAGE_CHARS = ${MAX_IMAGE_CHARS};

  async function captureFigures(pyodide) {
    try {
      await pyodide.runPythonAsync(CAPTURE_SRC);
      var proxy = pyodide.globals.get('_capture_figs')();
      var imgs = proxy.toJs();
      if (proxy.destroy) { proxy.destroy(); }
      if (!Array.isArray(imgs)) return [];
      return imgs.filter(function (b64) { return typeof b64 === 'string' && b64.length <= MAX_IMAGE_CHARS; });
    } catch (e) {
      return [];
    }
  }

  // The persistent workspace: run_python and the fs tools both operate here (cwd),
  // and the native side snapshots/restores it so files survive an interpreter
  // reload. Set up + entered before 'ready' so the first op already sees it.
  var WORKSPACE = ${JSON.stringify(PYTHON_WORKSPACE_DIR)};
  var WORKSPACE_INIT_SRC =
    'import os as _os\\n' +
    '_os.makedirs(' + JSON.stringify(WORKSPACE) + ', exist_ok=True)\\n' +
    '_os.chdir(' + JSON.stringify(WORKSPACE) + ')\\n';

  // Snapshot: walk the workspace into a JSON manifest of {path, base64}. Capped so a
  // runaway workspace can't build a giant blob. Restore: write the files back.
  var FS_SNAPSHOT_SRC =
    'import os as _os, json as _json, base64 as _b64\\n' +
    'def _fs_snapshot():\\n' +
    '    root = ' + JSON.stringify(WORKSPACE) + '\\n' +
    '    files = []\\n' +
    '    total = 0\\n' +
    '    limit = 16 * 1024 * 1024\\n' +
    '    if _os.path.isdir(root):\\n' +
    '        for dp, _d, fns in _os.walk(root):\\n' +
    '            for fn in fns:\\n' +
    '                full = _os.path.join(dp, fn)\\n' +
    '                rel = _os.path.relpath(full, root)\\n' +
    '                try:\\n' +
    '                    with open(full, "rb") as f:\\n' +
    '                        data = f.read()\\n' +
    '                except Exception:\\n' +
    '                    continue\\n' +
    '                if total + len(data) > limit:\\n' +
    '                    return _json.dumps({"truncated": True, "files": files})\\n' +
    '                total += len(data)\\n' +
    '                files.append({"path": rel, "b64": _b64.b64encode(data).decode()})\\n' +
    '    return _json.dumps({"truncated": False, "files": files})\\n';
  // Restore CLEARS the workspace first, so swapping to another project's snapshot
  // never leaves the previous project's files behind. rmtree removes cwd, so we
  // recreate + re-enter it.
  var FS_RESTORE_SRC =
    'import os as _os, json as _json, base64 as _b64, shutil as _sh\\n' +
    'def _fs_restore(_raw):\\n' +
    '    root = ' + JSON.stringify(WORKSPACE) + '\\n' +
    '    _d = _json.loads(_raw)\\n' +
    '    if _os.path.isdir(root):\\n' +
    '        _sh.rmtree(root, ignore_errors=True)\\n' +
    '    _os.makedirs(root, exist_ok=True)\\n' +
    '    _os.chdir(root)\\n' +
    '    for _f in _d.get("files", []):\\n' +
    '        _p = _os.path.join(root, _f["path"])\\n' +
    '        _dir = _os.path.dirname(_p)\\n' +
    '        if _dir:\\n' +
    '            _os.makedirs(_dir, exist_ok=True)\\n' +
    '        with open(_p, "wb") as _fh:\\n' +
    '            _fh.write(_b64.b64decode(_f["b64"]))\\n' +
    '    return len(_d.get("files", []))\\n';
  // Export: zip the workspace and return the archive as base64 (for a .zip the user saves).
  var FS_ZIP_SRC =
    'import os as _os, io as _io, base64 as _b64, zipfile as _zip\\n' +
    'def _fs_zip():\\n' +
    '    root = ' + JSON.stringify(WORKSPACE) + '\\n' +
    '    buf = _io.BytesIO()\\n' +
    '    with _zip.ZipFile(buf, "w", _zip.ZIP_DEFLATED) as z:\\n' +
    '        if _os.path.isdir(root):\\n' +
    '            for dp, _d, fns in _os.walk(root):\\n' +
    '                for fn in fns:\\n' +
    '                    full = _os.path.join(dp, fn)\\n' +
    '                    z.write(full, _os.path.relpath(full, root))\\n' +
    '    return _b64.b64encode(buf.getvalue()).decode()\\n';

  // Boot heartbeats: 'script' proves the page loaded and this script ran (rules
  // out a blank WebView / failed page load); 'loading-pyodide' means we entered
  // loadPyodide (the slow WASM fetch+compile). If boot times out, the last phase
  // the service saw pinpoints where it stalled.
  post({ type: 'booting', phase: 'script' });
  var bootPromise = (async function () {
    post({ type: 'booting', phase: 'loading-pyodide' });
    var pyodide = await loadPyodide({ indexURL: './' });
    window.__pyodide = pyodide;
    await pyodide.runPythonAsync(WORKSPACE_INIT_SRC);
    return pyodide;
  })();

  // Native-side control ops for workspace persistence/export. Each posts a dedicated
  // message (not stdout) so a large manifest/archive isn't clipped by the stdout cap.
  window.__fsSnapshot = async function (id) {
    try {
      var pyodide = await bootPromise;
      await pyodide.runPythonAsync(FS_SNAPSHOT_SRC);
      var data = pyodide.globals.get('_fs_snapshot')();
      post({ type: 'fs_snapshot', id: id, ok: true, data: data });
    } catch (e) { post({ type: 'fs_snapshot', id: id, ok: false, error: String((e && e.message) || e) }); }
  };
  window.__fsRestore = async function (id, raw) {
    try {
      var pyodide = await bootPromise;
      await pyodide.runPythonAsync(FS_RESTORE_SRC);
      pyodide.globals.get('_fs_restore')(raw);
      post({ type: 'fs_restore', id: id, ok: true });
    } catch (e) { post({ type: 'fs_restore', id: id, ok: false, error: String((e && e.message) || e) }); }
  };
  window.__fsZip = async function (id) {
    try {
      var pyodide = await bootPromise;
      await pyodide.runPythonAsync(FS_ZIP_SRC);
      var data = pyodide.globals.get('_fs_zip')();
      post({ type: 'fs_snapshot', id: id, ok: true, data: data });
    } catch (e) { post({ type: 'fs_snapshot', id: id, ok: false, error: String((e && e.message) || e) }); }
  };

  window.__runPython = async function (req) {
    var out = makeSink();
    var err = makeSink();
    try {
      var pyodide = await bootPromise;
      pyodide.setStdout({ batched: function (s) { append(out, s); } });
      pyodide.setStderr({ batched: function (s) { append(err, s); } });
      // Install requested PyPI packages first (needs network). Report a failure
      // distinctly so the caller can tell "couldn't install" from "code errored".
      if (req.packages && req.packages.length) {
        try {
          await pyodide.loadPackage('micropip');
          var micropip = pyodide.pyimport('micropip');
          await micropip.install(req.packages);
        } catch (installErr) {
          post({ type: 'result', id: req.id, ok: false, stdout: finalize(out), stderr: finalize(err), error: 'Package install failed: ' + String((installErr && installErr.message) || installErr) });
          return;
        }
      }
      await pyodide.loadPackagesFromImports(req.code);
      var value = await pyodide.runPythonAsync(req.code);
      var repr;
      if (value !== undefined) {
        try {
          repr = String(value);
          if (repr.length > MAX_STREAM_CHARS) { repr = repr.slice(0, MAX_STREAM_CHARS) + '\\n[result truncated]'; }
        } finally {
          if (value && typeof value.destroy === 'function') { value.destroy(); }
        }
      }
      var images = await captureFigures(pyodide);
      post({ type: 'result', id: req.id, ok: true, stdout: finalize(out), stderr: finalize(err), result: repr, images: images });
    } catch (e) {
      post({ type: 'result', id: req.id, ok: false, stdout: finalize(out), stderr: finalize(err), error: String((e && e.message) || e) });
    }
  };

  bootPromise
    .then(function (pyodide) { post({ type: 'ready', version: pyodide.version }); })
    .catch(function (e) { post({ type: 'boot_error', error: String((e && e.message) || e) }); });
})();
</script>
</body>
</html>
`;
}

/** JS statement string that hands a request to the page. */
export function buildRunInjection(request: PythonPageRequest): string {
  // JSON.stringify leaves U+2028/U+2029 unescaped; on pre-ES2019 WebView engines
  // they act as line terminators inside string literals and would break parsing
  // of the injected statement. Escape them defensively.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const payload = JSON.stringify(request)
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
  return `window.__runPython(${payload}); true;`;
}

export function parsePythonPageMessage(raw: string): PythonPageMessage | null {
  try {
    const msg = JSON.parse(raw);
    const TYPES = ['ready', 'result', 'boot_error', 'booting', 'fs_snapshot', 'fs_restore'];
    if (msg && TYPES.includes(msg.type)) {
      return msg as PythonPageMessage;
    }
  } catch {
    // Not a runtime message — ignore.
  }
  return null;
}
