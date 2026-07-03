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
  type: 'ready' | 'result' | 'boot_error';
  id?: string;
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  result?: string;
  error?: string;
  version?: string;
}

/** Request injected into the page. */
export interface PythonPageRequest {
  id: string;
  code: string;
}

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
  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  var bootPromise = (async function () {
    var pyodide = await loadPyodide({ indexURL: './' });
    window.__pyodide = pyodide;
    return pyodide;
  })();

  window.__runPython = async function (req) {
    var out = [];
    var err = [];
    try {
      var pyodide = await bootPromise;
      pyodide.setStdout({ batched: function (s) { out.push(s); } });
      pyodide.setStderr({ batched: function (s) { err.push(s); } });
      await pyodide.loadPackagesFromImports(req.code);
      var value = await pyodide.runPythonAsync(req.code);
      var repr;
      if (value !== undefined) {
        try {
          repr = String(value);
        } finally {
          if (value && typeof value.destroy === 'function') { value.destroy(); }
        }
      }
      post({ type: 'result', id: req.id, ok: true, stdout: out.join('\\n'), stderr: err.join('\\n'), result: repr });
    } catch (e) {
      post({ type: 'result', id: req.id, ok: false, stdout: out.join('\\n'), stderr: err.join('\\n'), error: String((e && e.message) || e) });
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
  return `window.__runPython(${JSON.stringify(request)}); true;`;
}

export function parsePythonPageMessage(raw: string): PythonPageMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && (msg.type === 'ready' || msg.type === 'result' || msg.type === 'boot_error')) {
      return msg as PythonPageMessage;
    }
  } catch {
    // Not a runtime message — ignore.
  }
  return null;
}
