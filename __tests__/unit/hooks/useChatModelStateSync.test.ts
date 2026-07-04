/**
 * Unit tests for useChatModelStateSync — tool-calling / thinking capability sync.
 *
 * Regression coverage for issue #42 ("gemma tools bug"): on a cold start the
 * active local model is not yet loaded (load is deferred to first send), so the
 * live llmService capability is unknown. The effect must fall back to the
 * persisted per-model capability cache so tools aren't shown as unavailable, and
 * must write the live capability back to the cache once the model is loaded.
 */

import { renderHook } from '@testing-library/react-native';
import { useChatModelStateSync } from '../../../src/screens/ChatScreen/useChatModelActions';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(),
    getLoadedModelPath: jest.fn(),
    supportsToolCalling: jest.fn(),
    supportsThinking: jest.fn(),
    getMultimodalSupport: jest.fn(() => ({ vision: false })),
  },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn(() => false) },
}));

const { llmService } = require('../../../src/services/llm');
const { liteRTService } = require('../../../src/services/litert');

function makeDeps(overrides: Record<string, any> = {}) {
  return {
    activeModelInfo: { isRemote: false },
    activeModelId: 'gemma',
    activeModel: createDownloadedModel({ id: 'gemma', filePath: '/models/gemma.gguf' }),
    modelDeps: {},
    activeRemoteModel: null,
    activeRemoteTextModelId: null,
    isModelLoading: false,
    setSupportsVision: jest.fn(),
    setSupportsToolCalling: jest.fn(),
    setSupportsThinking: jest.fn(),
    ...overrides,
  };
}

describe('useChatModelStateSync tool-calling capability', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    llmService.isModelLoaded.mockReturnValue(false);
    llmService.getLoadedModelPath.mockReturnValue(null);
    llmService.supportsToolCalling.mockReturnValue(false);
    llmService.supportsThinking.mockReturnValue(false);
    liteRTService.isModelLoaded.mockReturnValue(false);
  });

  it('falls back to the cached capability when the model is not loaded (issue #42)', () => {
    useAppStore.getState().setModelCapability('gemma', { toolCalling: true, thinking: true });
    const deps = makeDeps();

    renderHook(() => useChatModelStateSync(deps));

    expect(deps.setSupportsToolCalling).toHaveBeenCalledWith(true);
    expect(deps.setSupportsThinking).toHaveBeenCalledWith(true);
  });

  it('reports no tools when unloaded and no capability cached', () => {
    const deps = makeDeps();

    renderHook(() => useChatModelStateSync(deps));

    expect(deps.setSupportsToolCalling).toHaveBeenCalledWith(false);
    expect(deps.setSupportsThinking).toHaveBeenCalledWith(false);
  });

  it('reads live capability and caches it when the active model is loaded', () => {
    llmService.isModelLoaded.mockReturnValue(true);
    llmService.getLoadedModelPath.mockReturnValue('/models/gemma.gguf');
    llmService.supportsToolCalling.mockReturnValue(true);
    llmService.supportsThinking.mockReturnValue(false);
    const deps = makeDeps();

    renderHook(() => useChatModelStateSync(deps));

    expect(deps.setSupportsToolCalling).toHaveBeenCalledWith(true);
    expect(useAppStore.getState().modelCapabilities.gemma).toEqual({ toolCalling: true, thinking: false });
  });

  it('does not trust the live capability when a different model is loaded', () => {
    llmService.isModelLoaded.mockReturnValue(true);
    llmService.getLoadedModelPath.mockReturnValue('/models/other.gguf');
    llmService.supportsToolCalling.mockReturnValue(true);
    useAppStore.getState().setModelCapability('gemma', { toolCalling: false, thinking: false });
    const deps = makeDeps();

    renderHook(() => useChatModelStateSync(deps));

    // Uses the gemma cache (false), not the loaded other-model's live value (true).
    expect(deps.setSupportsToolCalling).toHaveBeenCalledWith(false);
  });

  it('caches capability when a LiteRT model is loaded', () => {
    liteRTService.isModelLoaded.mockReturnValue(true);
    const deps = makeDeps({
      activeModelId: 'litert-model',
      activeModel: createDownloadedModel({ id: 'litert-model', engine: 'litert', liteRTVision: false }),
    });

    renderHook(() => useChatModelStateSync(deps));

    expect(deps.setSupportsToolCalling).toHaveBeenCalledWith(true);
    expect(useAppStore.getState().modelCapabilities['litert-model']).toEqual({ toolCalling: true, thinking: true });
  });

  it('falls back to the cache for an unloaded LiteRT model on cold start (issue #42)', () => {
    liteRTService.isModelLoaded.mockReturnValue(false);
    useAppStore.getState().setModelCapability('litert-model', { toolCalling: true, thinking: true });
    const deps = makeDeps({
      activeModelId: 'litert-model',
      activeModel: createDownloadedModel({ id: 'litert-model', engine: 'litert', liteRTVision: false }),
    });

    renderHook(() => useChatModelStateSync(deps));

    expect(deps.setSupportsToolCalling).toHaveBeenCalledWith(true);
    expect(deps.setSupportsThinking).toHaveBeenCalledWith(true);
  });
});
