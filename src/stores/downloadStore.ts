import { create } from 'zustand';
import { ModelKey } from '../utils/modelKey';
import logger from '../utils/logger';

export type DownloadStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'waiting_for_network'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ModelType = 'text' | 'image' | 'stt' | 'tts'

export interface DownloadEntry {
  modelKey: ModelKey
  downloadId: string
  modelId: string
  fileName: string
  quantization: string
  modelType: ModelType
  status: DownloadStatus
  bytesDownloaded: number
  totalBytes: number
  combinedTotalBytes: number
  progress: number
  downloadSpeed?: number
  lastSpeedUpdate?: number
  speedAnchorBytes?: number
  mmProjDownloadId?: string
  mmProjBytesDownloaded?: number
  mmProjStatus?: DownloadStatus
  mmProjFileName?: string
  mmProjFileSize?: number
  errorMessage?: string
  errorCode?: string
  createdAt: number
  metadataJson?: string
}

/**
 * Statuses that count as "an active download is in flight for this modelKey".
 * Use this to guard against duplicate starts (rapid double-tap) so we never
 * have two parallel native downloads racing on the same logical file.
 */
const ACTIVE_STATUSES = new Set<DownloadStatus>([
  'pending', 'running', 'retrying', 'waiting_for_network', 'processing',
]);

export function isActiveStatus(status: DownloadStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * Minimum real-time window (ms) to measure download speed over. Progress events
 * do NOT arrive at a steady cadence: Android delivers them through a WorkManager
 * WorkInfo observer that coalesces `setProgress` writes and flushes several at
 * once, and the RN bridge batches native->JS calls. So the gap between two
 * *adjacent* events can collapse to ~1ms while the byte delta is a full chunk —
 * dividing one by the other yields a wildly inflated speed (observed: ~150 MB/s
 * reported for a real ~5 MB/s download). Measuring over a real window instead
 * makes the elapsed-time term reflect true wall-clock time regardless of how
 * the intermediate events were delivered.
 */
const SPEED_WINDOW_MS = 500;

/**
 * Compute a smoothed download speed (bytes/sec) anchored to a (bytes, time)
 * sample, recomputed only once at least SPEED_WINDOW_MS of real time has
 * elapsed since the anchor. Returns the (possibly held) speed plus the anchor
 * to persist for the next event. Speed is EMA-smoothed across windows.
 */
function computeDownloadSpeed(opts: {
  anchorBytes: number | undefined;
  anchorTime: number | undefined;
  newCombined: number;
  now: number;
  prevSpeed: number | undefined;
}): { speed: number; anchorBytes: number; anchorTime: number } {
  const { anchorBytes, anchorTime, newCombined, now, prevSpeed } = opts;
  const held = prevSpeed ?? 0;
  // First sample (or after a reset): seed the anchor, no speed yet.
  if (anchorTime == null || anchorBytes == null) {
    return { speed: held, anchorBytes: newCombined, anchorTime: now };
  }
  const deltaBytes = newCombined - anchorBytes;
  const deltaMs = now - anchorTime;
  // Re-anchor and hold when the sample is unusable rather than divide by a bad
  // delta: bytes went backwards (resume / out-of-order event), or the wall clock
  // jumped backwards (NTP correction, manual change) making deltaMs negative —
  // Date.now() is not monotonic, and without this a backward jump would trap us
  // in the sub-window branch forever, freezing a stale rate.
  if (deltaBytes < 0 || deltaMs < 0) {
    return { speed: held, anchorBytes: newCombined, anchorTime: now };
  }
  // Too little real time has passed to measure reliably (a coalesced burst of
  // events): hold the last speed AND keep the anchor put, so the next event
  // that crosses the window measures byte-delta over true elapsed time. A
  // zero-byte delta that DOES cross the window is a real stall (iOS re-polls the
  // same byte count every 1.5s while a connection hangs) and correctly falls
  // through to compute instantSpeed = 0, decaying the EMA toward 0. The
  // completion echo — where onAnyComplete re-reports a finished GGUF's final
  // bytes while its mmproj sidecar is still going — is kept off this path
  // entirely by its caller (updateProgressBytesOnly), so it never injects a
  // spurious 0.
  if (deltaMs < SPEED_WINDOW_MS) {
    return { speed: held, anchorBytes, anchorTime };
  }
  const instantSpeed = (deltaBytes / deltaMs) * 1000;
  const alpha = 0.3;
  const speed = prevSpeed && prevSpeed > 0
    ? prevSpeed * (1 - alpha) + instantSpeed * alpha
    : instantSpeed;
  return { speed, anchorBytes: newCombined, anchorTime: now };
}

/**
 * Build the mutable fields for a progress update. Shared by updateProgress
 * (touchSpeed=true, feeds the speed EMA) and updateProgressBytesOnly
 * (touchSpeed=false, bytes/progress only — used for completion echoes).
 */
function progressPatch(entry: DownloadEntry, opts: { bytes: number; total: number; touchSpeed: boolean }): Partial<DownloadEntry> {
  const { bytes, total, touchSpeed } = opts;
  const combinedTotal = entry.combinedTotalBytes || total;
  const mmProjBytes = entry.mmProjBytesDownloaded ?? 0;
  const progress = combinedTotal > 0 ? (bytes + mmProjBytes) / combinedTotal : 0;
  const base: Partial<DownloadEntry> = { bytesDownloaded: bytes, totalBytes: total, progress, status: 'running' };
  if (!touchSpeed) return base;
  const now = Date.now();
  const { speed, anchorBytes, anchorTime } = computeDownloadSpeed({
    anchorBytes: entry.speedAnchorBytes, anchorTime: entry.lastSpeedUpdate,
    newCombined: bytes + mmProjBytes, now, prevSpeed: entry.downloadSpeed,
  });
  return { ...base, downloadSpeed: speed, lastSpeedUpdate: anchorTime, speedAnchorBytes: anchorBytes };
}

interface DownloadStoreState {
  downloads: Record<ModelKey, DownloadEntry>
  downloadIdIndex: Record<string, ModelKey>
  repairingVisionIds: Record<string, true>

  setRepairingVision: (modelId: string, repairing: boolean) => void
  setAll: (entries: DownloadEntry[]) => void
  hydrate: (entries: DownloadEntry[]) => void
  add: (entry: DownloadEntry) => void
  setMmProjDownloadId: (modelKey: ModelKey, mmProjDownloadId: string) => void
  updateProgress: (downloadId: string, bytes: number, total: number) => void
  updateProgressBytesOnly: (downloadId: string, bytes: number, total: number) => void
  updateMmProjProgress: (mmProjDownloadId: string, bytes: number) => void
  setStatus: (downloadId: string, status: DownloadStatus, error?: { message: string; code?: string }) => void
  setProcessing: (downloadId: string) => void
  setCompleted: (downloadId: string) => void
  setMmProjCompleted: (mmProjDownloadId: string, bytes: number) => void
  retryEntry: (modelKey: ModelKey, newDownloadId: string) => void
  remove: (modelKey: ModelKey) => void
}

export const useDownloadStore = create<DownloadStoreState>((set) => ({
  downloads: {},
  downloadIdIndex: {},
  repairingVisionIds: {},

  setRepairingVision: (modelId, repairing) => set(state => {
    if (repairing) {
      return { repairingVisionIds: { ...state.repairingVisionIds, [modelId]: true } };
    }
    const next = { ...state.repairingVisionIds };
    delete next[modelId];
    return { repairingVisionIds: next };
  }),

  setAll: (entries) => {
    const downloads: Record<ModelKey, DownloadEntry> = {};
    const downloadIdIndex: Record<string, ModelKey> = {};
    for (const entry of entries) {
      downloads[entry.modelKey] = entry;
      downloadIdIndex[entry.downloadId] = entry.modelKey;
      if (entry.mmProjDownloadId) {
        downloadIdIndex[entry.mmProjDownloadId] = entry.modelKey;
      }
    }
    set({ downloads, downloadIdIndex });
  },

  // Like setAll, but preserves any existing entry whose JS-tracked progress
  // is ahead of the native row. Avoids foreground-resume hydration blowing
  // away in-flight progress that listeners have already advanced past the
  // native snapshot.
  hydrate: (entries) => set(state => {
    const downloads: Record<ModelKey, DownloadEntry> = {};
    const downloadIdIndex: Record<string, ModelKey> = {};
    for (const next of entries) {
      const existing = state.downloads[next.modelKey];
      let merged: DownloadEntry;
      if (existing && existing.bytesDownloaded >= next.bytesDownloaded) {
        // Local listeners are ahead — keep them, just refresh metadataJson + total
        merged = {
          ...existing,
          totalBytes: next.totalBytes || existing.totalBytes,
          combinedTotalBytes: next.combinedTotalBytes || existing.combinedTotalBytes,
          metadataJson: next.metadataJson ?? existing.metadataJson,
        };
      } else {
        merged = next;
      }
      downloads[merged.modelKey] = merged;
      downloadIdIndex[merged.downloadId] = merged.modelKey;
      if (merged.mmProjDownloadId) {
        downloadIdIndex[merged.mmProjDownloadId] = merged.modelKey;
      }
    }
    return { downloads, downloadIdIndex };
  }),

  // Adds a new entry. Refuses if any entry already exists for this modelKey,
  // active or otherwise. Failed/stuck/retrying entries must be restarted via
  // retryEntry (which preserves the same logical record), or the user must
  // remove() them first. This enforces "one logical entry per model/file"
  // and prevents a fresh start path from silently replacing a visible failed
  // entry that the product rules say must persist until explicit user action.
  add: (entry) => set(state => {
    if (state.downloads[entry.modelKey]) return state;
    return {
      downloads: { ...state.downloads, [entry.modelKey]: entry },
      downloadIdIndex: {
        ...state.downloadIdIndex,
        [entry.downloadId]: entry.modelKey,
        ...(entry.mmProjDownloadId ? { [entry.mmProjDownloadId]: entry.modelKey } : {}),
      },
    };
  }),

  setMmProjDownloadId: (modelKey, mmProjDownloadId) => set(state => {
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    logger.log('[DownloadDebug] Register mmproj download', {
      modelKey,
      mmProjDownloadId,
      mainDownloadId: entry.downloadId,
    });
    return {
      downloads: { ...state.downloads, [modelKey]: { ...entry, mmProjDownloadId, mmProjStatus: 'pending' } },
      downloadIdIndex: { ...state.downloadIdIndex, [mmProjDownloadId]: modelKey },
    };
  }),

  updateProgress: (downloadId, bytes, total) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry || entry.downloadId !== downloadId) return state;
    return { downloads: { ...state.downloads, [modelKey]: { ...entry, ...progressPatch(entry, { bytes, total, touchSpeed: true }) } } };
  }),

  // Updates bytes/progress WITHOUT feeding the speed EMA. The completion path
  // (onAnyComplete) re-reports a finished file's final byte count; routing that
  // through the speed calc would inject a spurious 0 B/s sample (zero byte-delta
  // over real elapsed time) and sag the displayed rate while a vision model's
  // mmproj sidecar is still transferring.
  updateProgressBytesOnly: (downloadId, bytes, total) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry || entry.downloadId !== downloadId) return state;
    return { downloads: { ...state.downloads, [modelKey]: { ...entry, ...progressPatch(entry, { bytes, total, touchSpeed: false }) } } };
  }),

  updateMmProjProgress: (mmProjDownloadId, bytes) => set(state => {
    const modelKey = state.downloadIdIndex[mmProjDownloadId];
    if (!modelKey) {
      logger.warn('[DownloadDebug] mmproj progress dropped: missing modelKey', { mmProjDownloadId });
      return state;
    }
    const entry = state.downloads[modelKey];
    if (!entry || entry.mmProjDownloadId !== mmProjDownloadId) {
      logger.warn('[DownloadDebug] mmproj progress dropped: entry mismatch', {
        modelKey,
        mmProjDownloadId,
        entryMmProjId: entry?.mmProjDownloadId,
      });
      return state;
    }
    const combinedTotal = entry.combinedTotalBytes || entry.totalBytes;
    const progress = combinedTotal > 0 ? (entry.bytesDownloaded + bytes) / combinedTotal : 0;
    const now = Date.now();
    const newCombined = entry.bytesDownloaded + bytes;
    const { speed, anchorBytes, anchorTime } = computeDownloadSpeed({ anchorBytes: entry.speedAnchorBytes, anchorTime: entry.lastSpeedUpdate, newCombined, now, prevSpeed: entry.downloadSpeed });
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          mmProjBytesDownloaded: bytes,
          mmProjStatus: 'running',
          progress,
          downloadSpeed: speed,
          lastSpeedUpdate: anchorTime,
          speedAnchorBytes: anchorBytes,
        },
      },
    };
  }),

  setStatus: (downloadId, status, error) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    const isMmProj = entry.mmProjDownloadId === downloadId;
    if (isMmProj) {
      // Sidecar status is independent of the parent. mmproj failure must not
      // fail the whole download — the main GGUF can still complete and the
      // model becomes usable text-only with a "repair vision" affordance.
      let mmProjErrorMessage = entry.errorMessage;
      if (entry.status !== 'failed') {
        mmProjErrorMessage = status === 'failed' ? error?.message : entry.errorMessage;
      }
      return {
        downloads: {
          ...state.downloads,
          [modelKey]: {
            ...entry,
            mmProjStatus: status as DownloadStatus,
            errorMessage: mmProjErrorMessage,
            // The download speed/anchor is a single combined (bytes, time)
            // value shared by the GGUF and mmproj streams. When the GGUF has
            // already finished and only the sidecar is still transferring, a
            // sidecar pause/stop is the sole stall signal — clear the rate here
            // too so the card never shows a frozen stale speed. A real resume
            // re-seeds a fresh anchor on the next byte event.
            ...(status !== 'running' ? { downloadSpeed: 0, lastSpeedUpdate: undefined, speedAnchorBytes: undefined } : {}),
          },
        },
      };
    }
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry, status, errorMessage: error?.message, errorCode: error?.code,
          // Any transition that isn't actively flowing bytes must drop the
          // speed and anchor, so the UI never shows a frozen stale rate while
          // paused (waiting_for_network / retrying) or stopped (failed /
          // cancelled). A real resume re-seeds a fresh anchor on the next byte
          // event — measuring across the outage gap would otherwise depress the
          // first post-resume reading.
          ...(status !== 'running' ? { downloadSpeed: 0, lastSpeedUpdate: undefined, speedAnchorBytes: undefined } : {}),
        },
      },
    };
  }),

  setProcessing: (downloadId) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    return {
      downloads: { ...state.downloads, [modelKey]: { ...entry, status: 'processing', downloadSpeed: 0, lastSpeedUpdate: undefined, speedAnchorBytes: undefined } },
    };
  }),

  setCompleted: (downloadId) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: { ...entry, status: 'completed', progress: 1, downloadSpeed: 0, lastSpeedUpdate: undefined, speedAnchorBytes: undefined },
      },
    };
  }),

  setMmProjCompleted: (mmProjDownloadId, bytes) => set(state => {
    const modelKey = state.downloadIdIndex[mmProjDownloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry || entry.mmProjDownloadId !== mmProjDownloadId) return state;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          mmProjBytesDownloaded: bytes,
          mmProjStatus: 'completed' as DownloadStatus,
        },
      },
    };
  }),

  retryEntry: (modelKey, newDownloadId) => set(state => {
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    const newIndex = { ...state.downloadIdIndex };
    delete newIndex[entry.downloadId];
    // Keep mmProjDownloadId in the index — it is still valid until
    // setMmProjDownloadId swaps it for the new sidecar ID after the retry
    // starts. Removing it here creates a window where mmproj progress events
    // arrive with no index match (updateMmProjProgress would log a mismatch
    // warning and drop the update).
    newIndex[newDownloadId] = modelKey;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          downloadId: newDownloadId,
          status: 'pending',
          bytesDownloaded: 0,
          progress: 0,
          downloadSpeed: 0,
          lastSpeedUpdate: undefined,
          speedAnchorBytes: undefined,
          errorMessage: undefined,
          errorCode: undefined,
          // Preserve mmproj identity fields so the UI still knows this is a
          // vision model and so updateMmProjProgress can still route events.
          // Only reset the mutable progress/status to give a clean slate.
          mmProjStatus: entry.mmProjDownloadId ? 'pending' : undefined,
          mmProjBytesDownloaded: 0,
          // mmProjDownloadId, mmProjFileName, mmProjFileSize — preserved via ...entry
        },
      },
      downloadIdIndex: newIndex,
    };
  }),

  remove: (modelKey) => set(state => {
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    const newIndex = { ...state.downloadIdIndex };
    delete newIndex[entry.downloadId];
    if (entry.mmProjDownloadId) delete newIndex[entry.mmProjDownloadId];
    const newDownloads = { ...state.downloads };
    delete newDownloads[modelKey];
    return { downloads: newDownloads, downloadIdIndex: newIndex };
  }),
}));
