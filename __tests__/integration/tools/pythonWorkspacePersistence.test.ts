/**
 * Integration: per-project workspace persistence + export.
 *
 * A control-aware fake page answers the snapshot/restore/zip injects the way the
 * real Pyodide page would, so we can assert the service's orchestration: restore a
 * saved project on first use, snapshot the old project and restore the new one when
 * a call switches projects, and export the workspace as a base64 zip.
 */

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFiles: Record<string, string> = {};
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(async (p: string) => p in mockFiles),
  readFile: jest.fn(async (p: string) => {
    if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`);
    return mockFiles[p];
  }),
  writeFile: jest.fn(async (p: string, content: string) => { mockFiles[p] = content; }),
  mkdir: jest.fn(async () => { }),
  unlink: jest.fn(async () => { }),
  stat: jest.fn(async () => ({ size: 0 })),
  downloadFile: jest.fn(),
}));

jest.mock('@dr.pogodin/react-native-static-server', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    start: jest.fn(async () => 'http://localhost:8899'),
    stop: jest.fn(async () => { }),
  })),
}));

import { executeToolCall } from '../../../src/services/tools/handlers';
import { pythonRuntimeService } from '../../../src/services/python/pythonRuntimeService';
import { usePythonRuntimeStore } from '../../../src/stores/pythonRuntimeStore';
import { PYODIDE_VERSION, PYODIDE_MANIFEST_REVISION, PYTHON_RUNTIME_MARKER_FILE } from '../../../src/services/python/pyodideManifest';

const MARKER_PATH = `/docs/pyodide-runtime/${PYTHON_RUNTIME_MARKER_FILE}`;
const TRUSTED_URL = 'http://localhost:8899/index.html';
const wsPath = (key: string) => `/docs/python-workspace/${key}.json`;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function post(msg: Record<string, unknown>) {
  pythonRuntimeService.handleWebViewMessage(JSON.stringify(msg), TRUSTED_URL);
}

interface FakeState { restores: string[]; snapshotData: string; zipData: string; runs: string[]; reads: string[]; readData: string }

/** Register a fake executor that answers run/snapshot/restore/zip/read injects, and signal ready. */
function attachControlFake(): FakeState {
  const state: FakeState = {
    restores: [],
    snapshotData: '{"files":[{"path":"a.py","b64":"eA=="}]}',
    zipData: 'UEsDBBQAAAA=',
    runs: [],
    reads: [],
    readData: '<!doctype html><title>game</title>',
  };
  pythonRuntimeService.registerExecutor({
    inject: (js: string) => {
      let m: RegExpExecArray | null;
      if ((m = /window\.__runPython\((.*)\); true;/.exec(js))) {
        const req = JSON.parse(m[1]);
        state.runs.push(req.code);
        setTimeout(() => post({ type: 'result', id: req.id, ok: true, stdout: '', stderr: '' }), 0);
      } else if ((m = /window\.__fsRestore\((".*?"), (.*)\); true;/.exec(js))) {
        const id = JSON.parse(m[1]);
        state.restores.push(JSON.parse(m[2]));
        setTimeout(() => post({ type: 'fs_restore', id, ok: true }), 0);
      } else if ((m = /window\.__fsSnapshot\((".*?")\); true;/.exec(js))) {
        const id = JSON.parse(m[1]);
        setTimeout(() => post({ type: 'fs_snapshot', id, ok: true, data: state.snapshotData }), 0);
      } else if ((m = /window\.__fsZip\((".*?")\); true;/.exec(js))) {
        const id = JSON.parse(m[1]);
        setTimeout(() => post({ type: 'fs_snapshot', id, ok: true, data: state.zipData }), 0);
      } else if ((m = /window\.__fsReadFile\((".*?"), (.*)\); true;/.exec(js))) {
        const id = JSON.parse(m[1]);
        state.reads.push(JSON.parse(m[2]));
        setTimeout(() => post({ type: 'fs_snapshot', id, ok: true, data: state.readData }), 0);
      } else {
        throw new Error(`Unexpected inject: ${js}`);
      }
    },
    reload: () => { },
  });
  post({ type: 'ready', version: PYODIDE_VERSION });
  return state;
}

/** Kick a run_python call, then (once) attach the fake after the server origin is set. */
let fake: FakeState | null = null;
async function runInProject(projectId?: string): Promise<void> {
  const p = executeToolCall({
    id: `c-${projectId ?? 'none'}`,
    name: 'run_python',
    arguments: { code: 'x = 1' },
    context: projectId ? { projectId } : undefined,
  });
  await tick();
  if (!fake) fake = attachControlFake();
  await p;
}

describe('per-project workspace persistence', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    mockFiles[MARKER_PATH] = JSON.stringify({ version: PYODIDE_VERSION, revision: PYODIDE_MANIFEST_REVISION });
    usePythonRuntimeStore.setState({
      status: 'installed', downloadProgress: 0, errorMessage: null, executorRequested: false, serverOrigin: null,
    });
    fake = null;
    jest.clearAllMocks();
  });

  // Tear down AFTER the test, while the origin + fake are still valid, so the
  // shutdown snapshot (and its inject reply) aren't dropped as untrusted - and the
  // debounced snapshot timer is cleared before the next test.
  afterEach(async () => {
    await pythonRuntimeService.shutdownExecutor();
    pythonRuntimeService.unregisterExecutor();
  });

  it('restores a saved project workspace on first use, before running code', async () => {
    const saved = '{"files":[{"path":"main.py","b64":"cHJpbnQoMSk="}]}';
    mockFiles[wsPath('proj1')] = saved;

    await runInProject('proj1');

    expect(fake!.restores).toContain(saved);
    expect(fake!.runs).toEqual(['x = 1']);
  });

  it('does not restore for a fresh project with no saved workspace', async () => {
    await runInProject('proj1');
    // Nothing saved + first load => reuse the empty /workspace the page booted.
    expect(fake!.restores).toEqual([]);
  });

  it('snapshots the old project and clears for the new one when a call switches projects', async () => {
    await runInProject('proj1');
    await runInProject('proj2');

    // Switching away from proj1 persisted it under its own key...
    expect(mockFiles[wsPath('proj1')]).toBe(fake!.snapshotData);
    // ...and proj2 (no snapshot) was cleared so proj1's files don't bleed in.
    expect(fake!.restores).toContain('{"files":[]}');
  });

  it('keeps a call with no project on the shared global workspace', async () => {
    await runInProject(undefined);
    await runInProject(undefined);
    // Same key both times => no snapshot/restore swap, and no per-project file written.
    expect(mockFiles[wsPath('proj1')]).toBeUndefined();
    expect(fake!.runs).toEqual(['x = 1', 'x = 1']);
  });

  it('exports the workspace as a base64 zip', async () => {
    await runInProject('proj1');
    const base64 = await pythonRuntimeService.exportProjectZip('proj1');
    expect(base64).toBe(fake!.zipData);
  });

  it('reads a workspace file for the HTML preview, loading the right project first', async () => {
    const saved = '{"files":[{"path":"game.html","b64":"eA=="}]}';
    mockFiles[wsPath('proj1')] = saved;

    // Read with no prior run, so the fake attaches mid-flight (like runInProject).
    const p = pythonRuntimeService.readWorkspaceFile('game.html', 'proj1');
    await tick();
    fake = attachControlFake();
    const content = await p;

    expect(content).toBe(fake.readData);
    expect(fake.reads).toEqual(['game.html']);
    // The project's saved workspace was restored before the read.
    expect(fake.restores).toContain(saved);
  });
});
