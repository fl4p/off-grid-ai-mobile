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
/** First boot compiles WASM and imports the stdlib — generous on old phones. */
const EXECUTOR_BOOT_TIMEOUT_MS = 60000;

class PythonRuntimeService {
  private executor: PythonExecutor | null = null;
  private executorReady = false;
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private pending = new Map<string, PendingExecution>();
  private server: { stop: () => Promise<unknown> } | null = null;
  private installPromise: Promise<void> | null = null;

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
        if (marker.version === PYODIDE_VERSION) {
          store.setStatus('installed');
          return;
        }
        // Different pinned version — force a re-install.
        logger.log('[PythonRuntime] Version changed, reinstall required:', marker.version, '->', PYODIDE_VERSION);
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
        const stat = await RNFS.stat(toFile);
        if (Number(stat.size) !== asset.bytes) {
          throw new Error(`Size mismatch for ${asset.fileName}: expected ${asset.bytes}, got ${stat.size}`);
        }
        completedBytes += asset.bytes;
        usePythonRuntimeStore.getState().setDownloadProgress(completedBytes / PYODIDE_TOTAL_BYTES);
      }

      await RNFS.writeFile(`${dir}/${PYTHON_PAGE_FILE}`, buildPythonPageHtml(), 'utf8');
      await RNFS.writeFile(
        `${dir}/${PYTHON_RUNTIME_MARKER_FILE}`,
        JSON.stringify({ version: PYODIDE_VERSION, installedAt: new Date().toISOString() }),
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
    const store = usePythonRuntimeStore.getState();
    store.setExecutorRequested(false);
    store.setServerOrigin(null);
    this.executorReady = false;
    this.rejectAllPending(new Error('Python runtime was shut down'));
    this.flushReadyWaiters(new Error('Python runtime was shut down'));
    if (this.server) {
      const server = this.server;
      this.server = null;
      try {
        await server.stop();
      } catch (error) {
        logger.warn('[PythonRuntime] Failed to stop static server:', error);
      }
    }
  }

  /**
   * Run Python code and return captured output. Boots the server + WebView on
   * first use and keeps them warm; interpreter globals persist across calls
   * until a timeout forces a reload.
   */
  async execute(code: string, opts: { timeoutMs?: number } = {}): Promise<PythonExecutionResult> {
    if (usePythonRuntimeStore.getState().status === 'unknown') {
      await this.refreshStatus();
    }
    if (!this.isInstalled()) {
      throw new Error('Python runtime is not installed');
    }
    await this.ensureExecutorReady();

    const id = generateId();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;

    return new Promise<PythonExecutionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // The interpreter is stuck in the hung script — reload to recover.
        this.resetExecutor();
        reject(new Error(`Python execution timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.executor!.inject(buildRunInjection({ id, code }));
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
  }

  /** Called by PythonRuntimeHost with every WebView message. */
  handleWebViewMessage(raw: string): void {
    const msg = parsePythonPageMessage(raw);
    if (!msg) return;

    if (msg.type === 'ready') {
      logger.log('[PythonRuntime] Interpreter ready, pyodide', msg.version);
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
    });
  }

  private async ensureExecutorReady(): Promise<void> {
    if (this.executorReady && this.executor) return;

    await this.ensureServer();
    usePythonRuntimeStore.getState().setExecutorRequested(true);

    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve: () => { clearTimeout(bootTimer); resolve(); }, reject: (e: Error) => { clearTimeout(bootTimer); reject(e); } };
      const bootTimer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter(w => w !== waiter);
        reject(new Error('Python interpreter did not start in time'));
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
