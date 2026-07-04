/**
 * shareLocalFile: prefers react-native-share (real cross-platform file attach),
 * falls back to the built-in Share when that native module errors / isn't linked.
 */

const mockOpen = jest.fn();
jest.mock(
  'react-native-share',
  () => ({ __esModule: true, default: { open: (...a: any[]) => mockOpen(...a) } }),
  { virtual: true },
);

import { Share } from 'react-native';
import { shareLocalFile } from '../../../src/utils/shareFile';

describe('shareLocalFile', () => {
  let shareSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  });
  afterEach(() => shareSpy.mockRestore());

  it('attaches the file via react-native-share and does not use the built-in fallback', async () => {
    mockOpen.mockResolvedValue({});
    await shareLocalFile('/docs/a.zip', { title: 'Workspace', mimeType: 'application/zip' });
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
      url: 'file:///docs/a.zip', title: 'Workspace', type: 'application/zip', failOnCancel: false,
    }));
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('adds the file:// scheme only when missing', async () => {
    mockOpen.mockResolvedValue({});
    await shareLocalFile('file:///docs/a.zip');
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///docs/a.zip' }));
  });

  it('falls back to the built-in Share when react-native-share errors (e.g. not linked yet)', async () => {
    mockOpen.mockRejectedValue(new Error('Native module RNShare is null'));
    await shareLocalFile('/docs/a.zip', { title: 'Workspace' });
    expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///docs/a.zip', title: 'Workspace' }));
  });

  it('treats a user cancellation as done, without opening the fallback sheet', async () => {
    mockOpen.mockRejectedValue(new Error('User did not share'));
    await shareLocalFile('/docs/a.zip');
    expect(shareSpy).not.toHaveBeenCalled();
  });
});
