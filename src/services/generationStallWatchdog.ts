/**
 * No-progress watchdog for a running generation.
 *
 * A generation can wedge with no error and no output: a native prefill that
 * hangs, a remote socket that goes silent, a tool that never returns. Without a
 * watchdog the reply bubble spins forever (the awaited promise simply never
 * settles). We arm a no-progress timer around each generation, re-arm it on any
 * sign of life (tokens flushed, tool-call boundary), and if it ever elapses we
 * abort the engine and reject so the caller surfaces an error and clears the
 * stuck bubble.
 *
 * Operates on the GenerationService instance as `svc: any` (same pattern as
 * generationServiceHelpers) so this concern lives in its own module.
 */
import logger from '../utils/logger';

// Generous, since a long prefill on a large context can legitimately take tens
// of seconds before the first token.
export const GENERATION_STALL_TIMEOUT_MS = 60_000;
export const GENERATION_STALL_MESSAGE =
  'The model stopped producing output and was stopped after 60 seconds. It may have run out of memory or been interrupted. Tap send to try again.';

export function disarmStallWatchdog(svc: any): void {
  if (svc.stallTimer) {
    clearTimeout(svc.stallTimer);
    svc.stallTimer = null;
  }
}

/** Reset the countdown after observing progress. No-op when the watchdog isn't
 *  armed (e.g. paused during tool execution) — use rearmStallWatchdog to resume. */
export function pokeStallWatchdog(svc: any): void {
  if (svc.stallTimer === null || !svc.state.isGenerating) return;
  clearTimeout(svc.stallTimer);
  svc.stallTimer = setTimeout(() => handleStall(svc), GENERATION_STALL_TIMEOUT_MS);
}

/** Start a fresh countdown for the active generation even if the watchdog was
 *  paused (stallTimer cleared). Used after a tool call completes or the tool-
 *  routing pass finishes, so the model's NEXT step gets a full budget. */
export function rearmStallWatchdog(svc: any): void {
  if (!svc.state.isGenerating || svc.stallReject === null) return;
  disarmStallWatchdog(svc);
  svc.stallTimer = setTimeout(() => handleStall(svc), GENERATION_STALL_TIMEOUT_MS);
}

function handleStall(svc: any): void {
  svc.stallTimer = null;
  if (!svc.state.isGenerating) return;
  logger.error(`[GenerationService] No output for ${GENERATION_STALL_TIMEOUT_MS}ms — aborting stalled generation.`);
  const reject = svc.stallReject;
  // Abort the engine/remote and clear the stuck streaming bubble. stopGeneration
  // sets abortRequested, so the (possibly still-pending) generation's callbacks
  // won't clobber state if they ever fire.
  svc.stopGeneration().catch(() => { });
  reject?.(new Error(GENERATION_STALL_MESSAGE));
}

/** Run a generation guarded by the no-progress watchdog. */
export async function armStallWatchdog<T>(svc: any, op: () => Promise<T>): Promise<T> {
  // A reentrant call while a generation is already active (e.g. retry on an older
  // message, or a double-tap send) will no-op inside prepareGeneration. It must
  // NOT touch the live generation's timer/reject — otherwise it would silently
  // disarm the real watchdog and reintroduce the "spins forever" bug.
  if (svc.state.isGenerating) return op();
  disarmStallWatchdog(svc);
  const stalled = new Promise<never>((_, reject) => {
    svc.stallReject = reject;
    svc.stallTimer = setTimeout(() => handleStall(svc), GENERATION_STALL_TIMEOUT_MS);
  });
  // Attach a no-op catch so that if `op` wins the race, the never-settled or
  // late-rejecting stall promise doesn't raise an unhandled rejection.
  stalled.catch(() => { });
  try {
    return await Promise.race([op(), stalled]);
  } finally {
    disarmStallWatchdog(svc);
    svc.stallReject = null;
  }
}
