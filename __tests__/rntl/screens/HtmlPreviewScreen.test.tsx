/**
 * HtmlPreviewScreen Tests
 *
 * The screen reads one HTML file from the Python workspace and renders it in an
 * isolated WebView (a running preview of an agent-written page). Tests:
 * - Reads the routed path/projectId via pythonRuntimeService and feeds it to the WebView
 * - The WebView runs JS but bridges nothing back, and blocks navigation to a remote origin
 * - A read failure shows an error with a retry
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { HtmlPreviewScreen } from '../../../src/screens/HtmlPreviewScreen';

const mockGoBack = jest.fn();
const mockRoute = { params: { path: 'game.html', projectId: 'proj1', title: 'game.html' } as any };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack }),
    useRoute: () => mockRoute,
  };
});

let mockWebViewProps: any = null;
jest.mock('react-native-webview', () => ({
  __esModule: true,
  WebView: (props: any) => {
    mockWebViewProps = props;
    const { View } = require('react-native');
    return <View testID={props.testID} />;
  },
}));

const mockReadWorkspaceFile = jest.fn();
jest.mock('../../../src/services/python/pythonRuntimeService', () => ({
  pythonRuntimeService: {
    readWorkspaceFile: (...args: any[]) => mockReadWorkspaceFile(...args),
  },
}));

const HTML = '<!doctype html><title>game</title><script>1</script>';

describe('HtmlPreviewScreen', () => {
  beforeEach(() => {
    mockWebViewProps = null;
    mockGoBack.mockClear();
    mockReadWorkspaceFile.mockReset();
    mockRoute.params = { path: 'game.html', projectId: 'proj1', title: 'game.html' };
  });

  it('reads the routed file for its project and renders it in the WebView', async () => {
    mockReadWorkspaceFile.mockResolvedValue(HTML);
    const { getByTestId } = render(<HtmlPreviewScreen />);

    await waitFor(() => expect(getByTestId('html-preview-webview')).toBeTruthy());
    expect(mockReadWorkspaceFile).toHaveBeenCalledWith('game.html', 'proj1');
    expect(mockWebViewProps.source).toEqual({ html: HTML });
  });

  it('runs JS in the preview but bridges nothing back and blocks remote navigation', async () => {
    mockReadWorkspaceFile.mockResolvedValue(HTML);
    const { getByTestId } = render(<HtmlPreviewScreen />);
    await waitFor(() => expect(getByTestId('html-preview-webview')).toBeTruthy());

    expect(mockWebViewProps.javaScriptEnabled).toBe(true);
    // No message handler: generated HTML can't post messages into the app.
    expect(mockWebViewProps.onMessage).toBeUndefined();
    // Local document loads; a remote origin is refused.
    expect(mockWebViewProps.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(true);
    expect(mockWebViewProps.onShouldStartLoadWithRequest({ url: 'https://evil.example/x' })).toBe(false);
  });

  it('shows an error with a retry when the read fails', async () => {
    mockReadWorkspaceFile.mockRejectedValueOnce(new Error('boom'));
    const { getByTestId, getByText } = render(<HtmlPreviewScreen />);

    await waitFor(() => expect(getByTestId('html-preview-retry')).toBeTruthy());
    expect(getByText(/Could not open the file/)).toBeTruthy();

    mockReadWorkspaceFile.mockResolvedValue(HTML);
    fireEvent.press(getByTestId('html-preview-retry'));
    await waitFor(() => expect(getByTestId('html-preview-webview')).toBeTruthy());
  });

  it('surfaces a runtime-not-installed read failure as a guiding message', async () => {
    mockReadWorkspaceFile.mockRejectedValueOnce(new Error('Python runtime is not installed'));
    const { getByText } = render(<HtmlPreviewScreen />);
    await waitFor(() => expect(getByText(/Settings > Tools/)).toBeTruthy());
  });

  it('goes back when the back button is pressed', async () => {
    mockReadWorkspaceFile.mockResolvedValue(HTML);
    const { getByTestId } = render(<HtmlPreviewScreen />);
    await waitFor(() => expect(getByTestId('html-preview-webview')).toBeTruthy());
    fireEvent.press(getByTestId('html-preview-back'));
    expect(mockGoBack).toHaveBeenCalled();
  });
});
