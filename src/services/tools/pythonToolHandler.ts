/**
 * run_python Tool Handler
 *
 * Bridges the run_python tool call to pythonRuntimeService: installs any
 * requested PyPI packages, runs the code, formats stdout/stderr/result text for
 * the model, and turns captured matplotlib figures into image attachments the
 * chat shows to the user. Split out of handlers.ts to keep that file under the
 * line limit.
 */

import type { ToolCall } from './types';
import type { MediaAttachment } from '../../types';
import logger from '../../utils/logger';

/** run_python returns text for the model, optionally with plot images for the user. */
export type PythonDispatchResult = string | { content: string; attachments?: MediaAttachment[] };

const MAX_OUTPUT_CHARS = 6000;

/**
 * Packages install from PyPI via micropip with NO integrity check (unlike the
 * bundled runtime assets, which are SHA-256 pinned). This is an intentional
 * capability: the user opts into it by enabling the tool, and a malicious or
 * typosquatted wheel is confined to the WASM sandbox — it can reach only the
 * CSP-allowed hosts (pypi.org, files.pythonhosted.org, jsdelivr) and the
 * in-memory interpreter FS, never the device filesystem or other origins.
 */
function parsePackages(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim());
  if (typeof raw === 'string') return raw.split(',').map(p => p.trim()).filter(Boolean);
  return [];
}

/**
 * Ensure the Python runtime is installed before a Python-backed tool runs.
 * Returns null when ready, or a model-facing message to return as the tool result
 * when it is not (which also kicks off the download so it self-heals).
 *
 * Reaching the not-installed branch means a Python-backed tool is enabled (only
 * enabled tools are offered to the model) but the runtime is not installed at the
 * current revision - usually a bundled-asset update (e.g. matplotlib) invalidated a
 * prior install. install() dedupes with any download already running from the Tools
 * screen.
 */
export async function ensurePythonRuntimeReady(): Promise<string | null> {
  const { pythonRuntimeService } = require('../python/pythonRuntimeService'); // NOSONAR
  const { usePythonRuntimeStore } = require('../../stores/pythonRuntimeStore'); // NOSONAR

  if (usePythonRuntimeStore.getState().status === 'unknown') {
    await pythonRuntimeService.refreshStatus();
  }
  if (!pythonRuntimeService.isInstalled()) {
    pythonRuntimeService.install().catch(() => { /* status surfaced via the store */ });
    return 'The Python runtime is downloading a required update (about 33 MB) and runs fully offline once ready. Tell the user it is updating - they can watch progress in Settings > Tools - and to try again in a moment.';
  }
  return null;
}

export async function handleRunPython(call: ToolCall, code: string): Promise<PythonDispatchResult> {
  const { pythonRuntimeService } = require('../python/pythonRuntimeService'); // NOSONAR

  const notReady = await ensurePythonRuntimeReady();
  if (notReady) return notReady;

  const packages = parsePackages(call.arguments.packages);
  const res = await pythonRuntimeService.execute(code, packages.length ? { packages } : {});

  const attachments = await savePlotImages(res.images);

  const sections: string[] = [];
  if (res.stdout) sections.push(res.stdout);
  if (res.ok && res.result !== undefined && res.result !== '') sections.push(`[result] ${res.result}`);
  if (res.stderr) sections.push(`[stderr]\n${res.stderr}`);
  if (!res.ok) sections.push(`[error]\n${res.error || 'Execution failed'}`);
  // Tell the model a plot was produced (it can't see the image) so it can refer to it.
  if (attachments.length) sections.push(`[${attachments.length} plot${attachments.length > 1 ? 's' : ''} shown to the user]`);
  if (sections.length === 0) sections.push('(no output — use print() to see values)');

  const output = sections.join('\n');
  // Keep the TAIL, not the head: for a script the end (result, [stderr], plot
  // note, final prints) is what matters, and the UI shows the last few lines by
  // default. Head-truncating would drop exactly what the user wants to see.
  const content = output.length > MAX_OUTPUT_CHARS
    ? `[earlier output truncated]\n\n${sliceTailCodePointSafe(output, MAX_OUTPUT_CHARS)}`
    : output;
  return attachments.length ? { content, attachments } : content;
}

/** Write base64 PNG figures to disk and return them as image attachments. */
async function savePlotImages(images: string[] | undefined): Promise<MediaAttachment[]> {
  if (!images?.length) return [];
  const RNFS = require('react-native-fs'); // NOSONAR
  const { generateId } = require('../../utils/generateId'); // NOSONAR
  const dir = `${RNFS.DocumentDirectoryPath}/python-plots`;
  try {
    await RNFS.mkdir(dir);
  } catch { /* already exists */ }

  const attachments: MediaAttachment[] = [];
  for (const b64 of images) {
    try {
      const id = generateId();
      const path = `${dir}/plot-${id}.png`;
      await RNFS.writeFile(path, b64, 'base64');
      attachments.push({ id, type: 'image', uri: `file://${path}`, mimeType: 'image/png', fileName: `plot-${id}.png` });
    } catch (error) {
      logger.warn('[Tools] Failed to save plot image:', error);
    }
  }
  return attachments;
}

/**
 * Keep the last `max` UTF-16 code units without starting on a lone low surrogate.
 * Python output (emoji, some numpy/pandas symbols) uses astral-plane chars; a
 * naive slice can leave a lone surrogate that corrupts JSON transport downstream.
 */
function sliceTailCodePointSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  const start = text.length - max;
  const code = text.charCodeAt(start);
  // If the cut starts on a low surrogate, step forward one to avoid orphaning it.
  const begin = code >= 0xdc00 && code <= 0xdfff ? start + 1 : start;
  return text.slice(begin);
}
