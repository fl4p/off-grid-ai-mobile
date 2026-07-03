const mockCaptureCandidateFromMessage = jest.fn();
const mockCaptureMemoryFromMessage = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../../../../src/services/memory', () => ({
  memoryService: {
    captureCandidateFromMessage: (...args: any[]) => mockCaptureCandidateFromMessage(...args),
    captureMemoryFromMessage: (...args: any[]) => mockCaptureMemoryFromMessage(...args),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    error: (...args: any[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  isRemoteGeneration,
  maybeCaptureMemoryCandidate,
} from '../../../../src/screens/ChatScreen/generationMemoryCapture';
import { useRemoteServerStore } from '../../../../src/stores';

describe('generationMemoryCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRemoteServerStore.setState({
      activeServerId: null,
      activeRemoteTextModelId: null,
    });
  });

  it('detects remote generation from active model info', () => {
    expect(isRemoteGeneration({
      activeModelInfo: {
        isRemote: true,
        model: null,
        modelId: 'remote-model',
        modelName: 'Remote Model',
      },
    })).toBe(true);
  });

  it('requires both active server and active remote text model from store', () => {
    useRemoteServerStore.setState({ activeServerId: 'server-1', activeRemoteTextModelId: null });
    expect(isRemoteGeneration({ activeModelInfo: undefined })).toBe(false);

    useRemoteServerStore.setState({ activeServerId: 'server-1', activeRemoteTextModelId: 'model-1' });
    expect(isRemoteGeneration({ activeModelInfo: undefined })).toBe(true);
  });

  it('captures local user messages when auto-capture is enabled', async () => {
    const message = { id: 'msg-1', role: 'user' as const, content: 'Remember that permit office hours changed.' };

    await maybeCaptureMemoryCandidate({
      memoryAutoCaptureEnabled: true,
      activeModelInfo: {
        isRemote: false,
        model: null,
        modelId: 'local-model',
        modelName: 'Local Model',
      },
      projectId: 'proj-1',
      userMessage: message,
    });

    expect(mockCaptureCandidateFromMessage).toHaveBeenCalledWith({
      message,
      projectId: 'proj-1',
    });
    expect(mockCaptureMemoryFromMessage).not.toHaveBeenCalled();
  });

  it('saves local user messages directly when full-auto memory is enabled', async () => {
    const message = { id: 'msg-1', role: 'user' as const, content: 'Remember: when I ask you to plot, use line width 2.' };

    await maybeCaptureMemoryCandidate({
      memoryAutoCaptureEnabled: true,
      memoryAutoSaveEnabled: true,
      activeModelInfo: {
        isRemote: false,
        model: null,
        modelId: 'local-model',
        modelName: 'Local Model',
      },
      projectId: 'proj-1',
      userMessage: message,
    });

    expect(mockCaptureMemoryFromMessage).toHaveBeenCalledWith({
      message,
      projectId: 'proj-1',
    });
    expect(mockCaptureCandidateFromMessage).not.toHaveBeenCalled();
  });

  it('skips capture when generation is remote', async () => {
    await maybeCaptureMemoryCandidate({
      memoryAutoCaptureEnabled: true,
      activeModelInfo: {
        isRemote: true,
        model: null,
        modelId: 'remote-model',
        modelName: 'Remote Model',
      },
      userMessage: { id: 'msg-1', role: 'user', content: 'Remember this local tax note.' },
    });

    expect(mockCaptureCandidateFromMessage).not.toHaveBeenCalled();
    expect(mockCaptureMemoryFromMessage).not.toHaveBeenCalled();
  });

  it('logs and does not throw when candidate capture fails', async () => {
    mockCaptureCandidateFromMessage.mockRejectedValueOnce(new Error('db failed'));

    await expect(maybeCaptureMemoryCandidate({
      memoryAutoCaptureEnabled: true,
      userMessage: { id: 'msg-1', role: 'user', content: 'Remember this local tax note.' },
    })).resolves.toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledWith('[Memory] Auto-capture failed', expect.any(Error));
  });
});
