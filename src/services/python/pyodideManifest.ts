/**
 * Pyodide Runtime Manifest
 *
 * Pins the exact Pyodide distribution files the on-demand Python runtime
 * downloads from jsDelivr. Core assets are the CPython-on-WASM interpreter;
 * package assets are the prebuilt wheels for numpy + pandas and their
 * dependency closure (resolved from pyodide-lock.json for this version).
 *
 * Byte sizes are the exact UNCOMPRESSED on-disk sizes for this pinned
 * version (verified by downloading each file), used for download progress
 * and post-download verification. The CDN serves compressed transfers, so
 * the network download is smaller than the ~33 MB disk footprint.
 */

export const PYODIDE_VERSION = '0.27.7';

/**
 * Bumped whenever the bundled asset SET changes without the pyodide version
 * changing (e.g. adding matplotlib). An install with a stale revision is
 * re-downloaded so new wheels actually land on already-installed devices.
 * rev 2: added matplotlib + its dependency closure.
 */
export const PYODIDE_MANIFEST_REVISION = 2;

export const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`;

export interface PyodideAsset {
  fileName: string;
  bytes: number;
  /**
   * Lowercase hex SHA-256 of the file. Byte-count alone is not integrity — a
   * same-size tampered asset (poisoned CDN edge, MITM) would pass a size check
   * and, since the runtime evals it with unsafe-eval, become the execution
   * engine. The wheel digests match pyodide-lock.json for this pinned version.
   */
  sha256: string;
}

/** Interpreter core: loader, WASM binary, stdlib, and package lockfile. */
export const PYODIDE_CORE_ASSETS: PyodideAsset[] = [
  { fileName: 'pyodide.js', bytes: 14913, sha256: 'b4cb23a53aba19c221659b9fb40a2f18281d685691dc06647fb0afd0681baf98' },
  { fileName: 'pyodide.asm.js', bytes: 1255688, sha256: '6b4c90de5b7172873f04f21884d0e9d2274e305fe32116558fe3e4fbe3618d51' },
  { fileName: 'pyodide.asm.wasm', bytes: 10105545, sha256: 'a50dd1843f805a0b7c45b61037ee0d7b26dfe85efe0e18ef95a34ad24e401f5f' },
  { fileName: 'python_stdlib.zip', bytes: 2360737, sha256: '16611534726e5d8ac2bd8f926410b2dcb8d6f49aa24913463533b457a2115c16' },
  { fileName: 'pyodide-lock.json', bytes: 112205, sha256: '9c45b916001a750f4102fc287494f3eab215909c7535c626a20db80fd6333e2c' },
];

/**
 * Preinstalled wheels: numpy + pandas + matplotlib dependency closures, plus
 * micropip (with its packaging dependency) so pure-Python PyPI packages can be
 * installed at runtime when online. matplotlib is bundled so `import matplotlib`
 * (and plot capture) works fully offline — models tend to import it directly
 * rather than declaring it in the packages arg. Digests match pyodide-lock.json.
 */
export const PYODIDE_PACKAGE_ASSETS: PyodideAsset[] = [
  { fileName: 'numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 3061133, sha256: 'ebb61241d962b98b21597d7ce43b67668a6d5bab3acec4fbe958657320d7cd08' },
  { fileName: 'pandas-2.2.3-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 5707178, sha256: '5502f0f94f93a482b851d0b8ca43be692c1b8d20215a168313656847ff74d63a' },
  { fileName: 'python_dateutil-2.9.0.post0-py2.py3-none-any.whl', bytes: 229892, sha256: '02811ea3714f6697d639c07dc5ec63f5774dc7a688e4e1cbbe9beb2f33c3e6c9' },
  { fileName: 'pytz-2024.1-py2.py3-none-any.whl', bytes: 505474, sha256: 'fcfc168155da8d19057b17bee735fef71dc3a39f1dccd83514e16ecc6abaddc4' },
  { fileName: 'six-1.16.0-py2.py3-none-any.whl', bytes: 11053, sha256: 'f61235bc3a15086f0369585e5071ae9ba0bd244a111d12b37f683862e6850c0a' },
  { fileName: 'micropip-0.9.0-py3-none-any.whl', bytes: 114896, sha256: '034f22763607744f982d2911170c50b496a38b8ba0535e5a09618475b1d7b051' },
  { fileName: 'packaging-24.2-py3-none-any.whl', bytes: 71930, sha256: 'fbf6a5ace596eb8e28fe0089ecfc0bca2eb3930563e9ca06acb98ea5302b99f7' },
  // matplotlib + its remaining dependency closure (numpy/dateutil/pytz already above)
  { fileName: 'matplotlib-3.8.4-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 6714844, sha256: '50d4641b32e84ecb0a2c271728d4be73b1e0a0f5f29aa7dd6ea280f888b91340' },
  { fileName: 'matplotlib_pyodide-0.2.3-py3-none-any.whl', bytes: 26183, sha256: '070d6244e7ae44f8753d3a78cf5c30f93c8d781e620991af848dcfd44112839f' },
  { fileName: 'contourpy-1.3.0-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 112207, sha256: 'f6ca0437a039c40691be53ff5bd3c9774868add8d5c2d032167495c6ff1f1c4b' },
  { fileName: 'fonttools-4.51.0-py3-none-any.whl', bytes: 1073094, sha256: '0c9a46b9246333de02d0fe02c0580840d7136744121f256a870218ed7482b607' },
  { fileName: 'kiwisolver-1.4.5-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 35233, sha256: 'd7652d88b3390d9d1d0175d6c79da675b42bac2cd748cc9b5766a3235da4b762' },
  { fileName: 'pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl', bytes: 987254, sha256: '43eab147a9355385a99eeac18fb577d4af2fe4bd0bbd23d3ba3ddb92e72c2815' },
  { fileName: 'cycler-0.12.1-py3-none-any.whl', bytes: 8321, sha256: 'e33687b4269fe3eda13c2d38006f9a5daa602c95f5c4f8d0576aff0717d001a6' },
  { fileName: 'pyparsing-3.1.2-py3-none-any.whl', bytes: 103246, sha256: '9070866557845375d8180e9236021fdecb2b93be75a7c8de48841f1465133a60' },
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
