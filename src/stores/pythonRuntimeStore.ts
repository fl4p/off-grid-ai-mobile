/**
 * Python Runtime Store
 *
 * UI-facing state for the on-demand Pyodide runtime: install status and
 * download progress. Disk is the source of truth for installation — this
 * store is never persisted; pythonRuntimeService.refreshStatus() rebuilds it
 * on startup.
 */

import { create } from 'zustand';

export type PythonRuntimeStatus =
  | 'unknown'
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'error';

interface PythonRuntimeState {
  status: PythonRuntimeStatus;
  /** 0..1 while status === 'downloading' */
  downloadProgress: number;
  errorMessage: string | null;
  /** True once an execution has been requested; keeps the WebView warm. */
  executorRequested: boolean;
  /** Origin of the local static server serving the runtime, e.g. http://localhost:8899 */
  serverOrigin: string | null;

  setStatus: (status: PythonRuntimeStatus, errorMessage?: string | null) => void;
  setDownloadProgress: (progress: number) => void;
  setExecutorRequested: (requested: boolean) => void;
  setServerOrigin: (origin: string | null) => void;
}

export const usePythonRuntimeStore = create<PythonRuntimeState>()((set) => ({
  status: 'unknown',
  downloadProgress: 0,
  errorMessage: null,
  executorRequested: false,
  serverOrigin: null,

  setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
  setDownloadProgress: (downloadProgress) => set({ downloadProgress }),
  setExecutorRequested: (executorRequested) => set({ executorRequested }),
  setServerOrigin: (serverOrigin) => set({ serverOrigin }),
}));
