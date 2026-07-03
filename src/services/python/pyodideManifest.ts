/**
 * Pyodide Runtime Manifest
 *
 * Pins the exact Pyodide distribution files the on-demand Python runtime
 * downloads from jsDelivr. Core assets are the CPython-on-WASM interpreter;
 * package assets are the prebuilt wheels for numpy + pandas and their
 * dependency closure (resolved from pyodide-lock.json for this version).
 *
 * Byte sizes are the exact CDN sizes for this pinned version, used for
 * download progress and post-download verification.
 */

export const PYODIDE_VERSION = '0.27.7';

export const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`;

export interface PyodideAsset {
  fileName: string;
  bytes: number;
}

/** Interpreter core: loader, WASM binary, stdlib, and package lockfile. */
export const PYODIDE_CORE_ASSETS: PyodideAsset[] = [
  { fileName: 'pyodide.js', bytes: 6077 },
  { fileName: 'pyodide.asm.js', bytes: 244923 },
  { fileName: 'pyodide.asm.wasm', bytes: 3003612 },
  { fileName: 'python_stdlib.zip', bytes: 2324948 },
  { fileName: 'pyodide-lock.json', bytes: 24225 },
];

/** Preinstalled wheels: numpy + pandas dependency closure. */
export const PYODIDE_PACKAGE_ASSETS: PyodideAsset[] = [
  { fileName: 'numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 3038083 },
  { fileName: 'pandas-2.2.3-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 5682351 },
  { fileName: 'python_dateutil-2.9.0.post0-py2.py3-none-any.whl', bytes: 228004 },
  { fileName: 'pytz-2024.1-py2.py3-none-any.whl', bytes: 309389 },
  { fileName: 'six-1.16.0-py2.py3-none-any.whl', bytes: 10637 },
];

export const PYODIDE_ALL_ASSETS: PyodideAsset[] = [
  ...PYODIDE_CORE_ASSETS,
  ...PYODIDE_PACKAGE_ASSETS,
];

export const PYODIDE_TOTAL_BYTES = PYODIDE_ALL_ASSETS.reduce((sum, a) => sum + a.bytes, 0);

/** Directory under DocumentDirectoryPath holding the runtime files. */
export const PYTHON_RUNTIME_DIR_NAME = 'pyodide-runtime';

/** Marker file written after a complete, verified install. */
export const PYTHON_RUNTIME_MARKER_FILE = 'runtime-manifest.json';

/** The executor page served next to the pyodide assets. */
export const PYTHON_PAGE_FILE = 'index.html';

export function pyodideAssetUrl(fileName: string): string {
  return `${PYODIDE_CDN_BASE}/${fileName}`;
}
