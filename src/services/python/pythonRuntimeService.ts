/**
 * Python Runtime Service
 *
 * Manages the on-demand Pyodide runtime: downloads the pinned distribution
 * from jsDelivr into app storage, serves it over a loopback static server,
 * and executes Python code inside the hidden PythonRuntimeHost WebView.
 *
 * Execution protocol: execute() injects window.__runPython({id, code}) into
 * the page; the page posts back {type: 'result', id, ...} which the host
 * routes to handleWebViewMessage(). A hung script is recovered by reloading
 * the WebView, which resets the interpreter (and clears Python globals).
 */

import RNFS from 'react-native-fs';
import logger from '../../utils/logger';
import { generateId } from '../../utils/generateId';
import { usePythonRuntimeStore } from '../../stores/pythonRuntimeStore';
import {
  PYODIDE_ALL_ASSETS,
  PYODIDE_TOTAL_BYTES,
  PYODIDE_VERSION,
  PYODIDE_MANIFEST_REVISION,
  PYTHON_PAGE_FILE,
  PYTHON_RUNTIME_DIR_NAME,
  PYTHON_RUNTIME_MARKER_FILE,
  pyodideAssetUrl,
} from './pyodideManifest';
import { buildPythonPageHtml, buildRunInjection, parsePythonPageMessage } from './pythonPage';

export interface PythonExecutionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: string;
  error?: string;
  /** Base64 PNGs of matplotlib figures produced by the run. */
  images?: string[];
}

export interface ExecuteOptions {
  timeoutMs?: number;
  /** PyPI/pyodide packages to install (micropip) before running the code. */
  packages?: string[];
}

/** Bridge the PythonRuntimeHost WebView registers while mounted. */
export interface PythonExecutor {
  inject: (js: string) => void;
  reload: () => void;
}

interface PendingExecution {
  resolve: (result: PythonExecutionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_EXECUTION_TIMEOUT_MS = 30000;
/** Installing packages downloads wheels over the network — allow more headroom. */
export const PACKAGE_INSTALL_TIMEOUT_MS = 120000;
/**
 * First boot fetches ~13 MB of WASM+stdlib over the loopback server and compiles
 * it inside the WebView — on a real device this can run well past a minute cold.
 * 60s was too aggressive (observed boot timeouts on device), so allow 3 minutes.
 */
const EXECUTOR_BOOT_TIMEOUT_MS = 180000;

class PythonRuntimeService {
  private executor: PythonExecutor | null = null;
  private executorReady = false;
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private pending = new Map<string, PendingExecution>();
  private server: { stop: () => Promise<unknown> } | null = null;
  private serverPromise: Promise<void> | null = null;
  private installPromise: Promise<void> | null = null;
  // Serializes execute() calls: stdout/stderr are set globally on the one shared
  // interpreter each call, and the namespace is shared, so overlapping runs would
  // cross-contaminate. Tool calls are sequential today, but this makes it safe.
  private runQueue: Promise<unknown> = Promise.resolve();
  // Last boot phase the page reported ('script' = page loaded, 'loading-pyodide'
  // = inside the WASM fetch/compile). Surfaced in the boot-timeout error so a
  // stall points at where it got stuck instead of a bare "did not start".
  private lastBootPhase = 'not-started';

  getRuntimeDir(): string {
    return `${RNFS.DocumentDirectoryPath}/${PYTHON_RUNTIME_DIR_NAME}`;
  }

  /** Re-derive install status from disk. Call once on startup or before use. */
  async refreshStatus(): Promise<void> {
    const store = usePythonRuntimeStore.getState();
    if (store.status === 'downloading') return;
    try {
      const markerPath = `${this.getRuntimeDir()}/${PYTHON_RUNTIME_MARKER_FILE}`;
      if (await RNFS.exists(markerPath)) {
        const marker = JSON.parse(await RNFS.readFile(markerPath, 'utf8'));
        // Both must match: a new pyodide version OR a new bundled asset set
        // (e.g. matplotlib added) requires re-downloading. `?? 1` treats a
        // pre-revision marker as the original asset set.
        if (marker.version === PYODIDE_VERSION && (marker.revision ?? 1) === PYODIDE_MANIFEST_REVISION) {
          store.setStatus('installed');
          return;
        }
        logger.log('[PythonRuntime] Manifest changed, reinstall required:',
          `${marker.version}/rev${marker.revision ?? 1}`, '->', `${PYODIDE_VERSION}/rev${PYODIDE_MANIFEST_REVISION}`);
      }
      store.setStatus('not_installed');
    } catch (error) {
      logger.warn('[PythonRuntime] Failed to read install marker:', error);
      store.setStatus('not_installed');
    }
  }

  isInstalled(): boolean {
    return usePythonRuntimeStore.getState().status === 'installed';
  }

  /** Download the pinned Pyodide distribution. Safe to call while running — reuses the in-flight install. */
  install(): Promise<void> {
    if (!this.installPromise) {
      this.installPromise = this.doInstall().finally(() => {
        this.installPromise = null;
      });
    }
    return this.installPromise;
  }

  private async doInstall(): Promise<void> {
    const store = usePythonRuntimeStore.getState();
    if (store.status === 'installed') return;
    store.setStatus('downloading');
    store.setDownloadProgress(0);

    const dir = this.getRuntimeDir();
    try {
      // Clear any prior install first: asset filenames are version-tagged, so a
      // version bump would otherwise leave the old ~33 MB of wheels/WASM orphaned
      // on disk, and a half-written retry could leave stale files behind.
      if (await RNFS.exists(dir)) {
        await RNFS.unlink(dir);
      }
      await RNFS.mkdir(dir);
      let completedBytes = 0;

      for (const asset of PYODIDE_ALL_ASSETS) {
        const toFile = `${dir}/${asset.fileName}`;
        const result = await RNFS.downloadFile({
          fromUrl: pyodideAssetUrl(asset.fileName),
          toFile,
          progress: (p: { bytesWritten: number }) => {
            usePythonRuntimeStore
              .getState()
              .setDownloadProgress(Math.min(1, (completedBytes + p.bytesWritten) / PYODIDE_TOTAL_BYTES));
          },
          progressDivider: 5,
        }).promise;

        if (result.statusCode !== 200) {
          throw new Error(`Download failed for ${asset.fileName} (HTTP ${result.statusCode})`);
        }
        // SHA-256 is the real integrity gate: this asset is about to be eval'd as
        // the interpreter/engine, so a same-size tampered file (poisoned edge,
        // MITM) must not pass. The size check stays as a cheap early-out.
        const stat = await RNFS.stat(toFile);
        if (Number(stat.size) !== asset.bytes) {
          throw new Error(`Size mismatch for ${asset.fileName}: expected ${asset.bytes}, got ${stat.size}`);
        }
        const digest = (await RNFS.hash(toFile, 'sha256')).toLowerCase();
        if (digest !== asset.sha256) {
          throw new Error(`Integrity check failed for ${asset.fileName}: SHA-256 mismatch`);
        }
        completedBytes += asset.bytes;
        usePythonRuntimeStore.getState().setDownloadProgress(completedBytes / PYODIDE_TOTAL_BYTES);
      }

      await RNFS.writeFile(`${dir}/${PYTHON_PAGE_FILE}`, buildPythonPageHtml(), 'utf8');
      await RNFS.writeFile(
        `${dir}/${PYTHON_RUNTIME_MARKER_FILE}`,
        JSON.stringify({ version: PYODIDE_VERSION, revision: PYODIDE_MANIFEST_REVISION, installedAt: new Date().toISOString() }),
        'utf8',
      );

      usePythonRuntimeStore.getState().setStatus('installed');
      logger.log('[PythonRuntime] Installed pyodide', PYODIDE_VERSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      logger.error('[PythonRuntime] Install failed:', error);
      usePythonRuntimeStore.getState().setStatus('error', message);
      // Leave partial files in place — a retry re-downloads them.
      throw error instanceof Error ? error : new Error(message);
    }
  }

  /** Delete the runtime from disk and shut down the executor. */
  async remove(): Promise<void> {
    await this.shutdownExecutor();
    try {
      if (await RNFS.exists(this.getRuntimeDir())) {
        await RNFS.unlink(this.getRuntimeDir());
      }
    } catch (error) {
      logger.warn('[PythonRuntime] Failed to delete runtime dir:', error);
    }
    usePythonRuntimeStore.getState().setStatus('not_installed');
  }

  /** Stop the server and unmount the WebView; frees the interpreter's memory. */
  async shutdownExecutor(): Promise<void> {
    usePythonRuntimeStore.getState().setExecutorRequested(false);
    this.executorReady = false;
    this.rejectAllPending(new Error('Python runtime was shut down'));
    this.flushReadyWaiters(new Error('Python runtime was shut down'));
    await this.stopServer();
  }

  /** Stop the loopback server and clear its origin so the next run rebuilds it. */
  private async stopServer(): Promise<void> {
    this.serverPromise = null;
    usePythonRuntimeStore.getState().setServerOrigin(null);
    const server = this.server;
    this.server = null;
    if (server) {
      try {
        await server.stop();
      } catch (error) {
        logger.warn('[PythonRuntime] Failed to stop static server:', error);
      }
    }
  }

  /**
   * Recover from an interpreter that never came up: a boot timeout, or a WebView
   * or loopback-server process the OS killed while backgrounded. Tears the server
   * down so the next execute() rebuilds it from scratch — otherwise a stale
   * `this.server` reference makes every future call time out forever (Python
   * "broken until app restart"). Callers reject their own waiter separately.
   */
  notifyExecutorCrashed(reason: string): void {
    logger.warn('[PythonRuntime] Executor crashed, resetting:', reason);
    this.executorReady = false;
    this.flushReadyWaiters(new Error(`Python interpreter unavailable: ${reason}`));
    this.rejectAllPending(new Error(`Python interpreter unavailable: ${reason}`));
    this.stopServer().catch(() => { /* teardown best-effort */ });
  }

  /**
   * Called by PythonRuntimeHost when the WebView reports a load failure
   * (onError / onHttpError). Turns a silent page-load failure — which would
   * otherwise show only as a boot timeout minutes later — into an immediate,
   * specific error so the cause (bad origin, 404, ATS block) is visible.
   */
  notifyLoadError(detail: string): void {
    logger.error('[PythonRuntime] WebView failed to load the page:', detail);
    this.executorReady = false;
    const err = new Error(`Python page failed to load: ${detail}`);
    this.flushReadyWaiters(err);
    this.rejectAllPending(err);
  }

  /**
   * Run Python code and return captured output. Boots the server + WebView on
   * first use and keeps them warm; interpreter globals persist across calls
   * until a timeout forces a reload.
   */
  async execute(code: string, opts: ExecuteOptions = {}): Promise<PythonExecutionResult> {
    // Chain onto the previous run so calls never overlap on the shared interpreter.
    // A prior failure must not break the chain, so swallow it before running ours.
    const run = this.runQueue
      .catch(() => { })
      .then(() => this.runExecution(code, opts));
    this.runQueue = run.catch(() => { });
    return run;
  }

  private async runExecution(code: string, opts: ExecuteOptions): Promise<PythonExecutionResult> {
    if (usePythonRuntimeStore.getState().status === 'unknown') {
      await this.refreshStatus();
    }
    if (!this.isInstalled()) {
      throw new Error('Python runtime is not installed');
    }
    await this.ensureExecutorReady();

    const id = generateId();
    const packages = opts.packages?.length ? opts.packages : undefined;
    // Package installs pull wheels over the network — give them a longer budget.
    const timeoutMs = opts.timeoutMs ?? (packages ? PACKAGE_INSTALL_TIMEOUT_MS : DEFAULT_EXECUTION_TIMEOUT_MS);

    return new Promise<PythonExecutionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // The interpreter is stuck in the hung script — reload to recover.
        this.resetExecutor();
        reject(new Error(`Python execution timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.executor!.inject(buildRunInjection({ id, code, packages }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('Failed to dispatch Python code'));
      }
    });
  }

  /** Called by PythonRuntimeHost when its WebView mounts. */
  registerExecutor(executor: PythonExecutor): void {
    this.executor = executor;
  }

  /** Called by PythonRuntimeHost when its WebView unmounts. */
  unregisterExecutor(): void {
    this.executor = null;
    this.executorReady = false;
    this.rejectAllPending(new Error('Python runtime was shut down'));
    // Also fail anyone blocked in ensureExecutorReady, so they don't hang until
    // their own 60s boot timer — symmetric with shutdownExecutor().
    this.flushReadyWaiters(new Error('Python runtime was shut down'));
  }

  /**
   * Called by PythonRuntimeHost with every WebView message. `sourceUrl` is the
   * native-provided page URL that posted it (WebViewNativeEvent.url, always set):
   * if the page was ever navigated off the loopback origin (defence in depth
   * behind onShouldStartLoadWithRequest), a forged result/ready message is
   * dropped rather than settling a pending execution or the boot handshake.
   * A missing URL is treated as untrusted — the page can't forge the native URL,
   * so the only way it's absent is an unexpected build, and failing closed is safe.
   */
  handleWebViewMessage(raw: string, sourceUrl?: string): void {
    if (!sourceUrl || !this.isTrustedOrigin(sourceUrl)) {
      logger.warn('[PythonRuntime] Dropped message from untrusted origin:', sourceUrl);
      return;
    }
    const msg = parsePythonPageMessage(raw);
    if (!msg) return;

    if (msg.type === 'booting') {
      this.lastBootPhase = msg.phase ?? 'unknown';
      logger.log('[PythonRuntime] Boot phase:', this.lastBootPhase);
      return;
    }

    if (msg.type === 'ready') {
      logger.log('[PythonRuntime] Interpreter ready, pyodide', msg.version);
      this.lastBootPhase = 'ready';
      this.executorReady = true;
      this.flushReadyWaiters(null);
      return;
    }

    if (msg.type === 'boot_error') {
      logger.error('[PythonRuntime] Interpreter boot failed:', msg.error);
      this.flushReadyWaiters(new Error(`Python interpreter failed to start: ${msg.error}`));
      return;
    }

    const pending = msg.id ? this.pending.get(msg.id) : undefined;
    if (!pending) return;
    this.pending.delete(msg.id!);
    clearTimeout(pending.timer);
    pending.resolve({
      ok: msg.ok === true,
      stdout: msg.stdout ?? '',
      stderr: msg.stderr ?? '',
      result: msg.result,
      error: msg.error,
      images: Array.isArray(msg.images) && msg.images.length ? msg.images : undefined,
    });
  }

  /** True when the URL's origin matches the loopback server we started. */
  private isTrustedOrigin(sourceUrl: string): boolean {
    const origin = usePythonRuntimeStore.getState().serverOrigin;
    if (!origin) return false;
    return sourceUrl === origin || sourceUrl.startsWith(`${origin}/`);
  }

  private async ensureExecutorReady(): Promise<void> {
    if (this.executorReady && this.executor) return;

    this.lastBootPhase = 'not-started';
    await this.ensureServer();
    usePythonRuntimeStore.getState().setExecutorRequested(true);

    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve: () => { clearTimeout(bootTimer); resolve(); }, reject: (e: Error) => { clearTimeout(bootTimer); reject(e); } };
      const bootTimer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter(w => w !== waiter);
        // Self-heal: the interpreter never signalled ready (dead WebView/server
        // after backgrounding). Rebuild on the next call instead of failing forever.
        // Include the last boot phase so the stall point is visible in logs/errors.
        this.notifyExecutorCrashed(`interpreter did not start in time (last phase: ${this.lastBootPhase})`);
        reject(new Error(`Python interpreter did not start in time (stalled at: ${this.lastBootPhase})`));
      }, EXECUTOR_BOOT_TIMEOUT_MS);
      this.readyWaiters.push(waiter);
      if (this.executorReady) {
        this.readyWaiters = this.readyWaiters.filter(w => w !== waiter);
        waiter.resolve();
      }
    });
  }

  private async ensureServer(): Promise<void> {
    if (this.server) return;
    // Memoize the in-flight start so two concurrent callers can't each spawn a
    // StaticServer and orphan one (leaked native process/port). Mirrors installPromise.
    if (!this.serverPromise) {
      this.serverPromise = this.startServer().catch((error) => {
        this.serverPromise = null;
        throw error;
      });
    }
    return this.serverPromise;
  }

  private async startServer(): Promise<void> {
    // Lazy require so the native module only loads when Python is actually used.
    const serverModule = require('@dr.pogodin/react-native-static-server'); // NOSONAR
    const StaticServer = serverModule.default ?? serverModule;
    const server = new StaticServer({
      fileDir: this.getRuntimeDir(),
      stopInBackground: false,
    });
    const origin = await server.start();
    this.server = server;
    usePythonRuntimeStore.getState().setServerOrigin(origin);
    logger.log('[PythonRuntime] Static server started at', origin);
  }

  /** Reload the WebView page: kills a hung script, resets Python globals. */
  private resetExecutor(): void {
    this.executorReady = false;
    this.rejectAllPending(new Error('Python interpreter was reset'));
    this.executor?.reload();
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private flushReadyWaiters(error: Error | null): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }
}

export const pythonRuntimeService = new PythonRuntimeService();
