/**
 * ToolsScreen Tests
 *
 * The tools picker is a full page (it replaced the old bottom-sheet drawer). Tests:
 * - Renders the page header and all free tool rows
 * - Pro Tools row is pinned to the top of the listing and is shown to everyone
 * - Pro Tools routing: free -> ProDetail upsell, pro -> the Pro Tools screen
 * - Tool toggles flow through the core settings store
 * - Back button navigates back
 */

import React from 'react';
import { render, fireEvent, within, waitFor } from '@testing-library/react-native';
import { ToolsScreen } from '../../../src/screens/ToolsScreen';
import { AVAILABLE_TOOLS } from '../../../src/services/tools/registry';
import { usePythonRuntimeStore } from '../../../src/stores/pythonRuntimeStore';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { PRO_TOOLS_SCREEN } from '../../../src/hooks/useIsProActive';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRoute = { params: undefined as { memoryEnabled?: boolean } | undefined };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useRoute: () => mockRoute,
  };
});

const mockUpdateSettings = jest.fn();
let mockEnabledTools: string[] = [];
const mockSetHintDismissed = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: Object.assign(
    (selector?: any) => {
      const state = {
        settings: { enabledTools: mockEnabledTools },
        updateSettings: mockUpdateSettings,
        toolCountHintDismissed: false,
        setToolCountHintDismissed: mockSetHintDismissed,
      };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ settings: { enabledTools: mockEnabledTools }, updateSettings: mockUpdateSettings }) },
  ),
}));

// CustomAlert renders through AppSheet, which needs real theme elevation
// tokens — replace it with a flat stub exposing title + pressable buttons.
jest.mock('../../../src/components/CustomAlert', () => {
  const actual = jest.requireActual('../../../src/components/CustomAlert');
  const { View, Text } = require('react-native');
  const StubAlert = ({ visible, title, buttons }: any) => {
    if (!visible) return null;
    return (
      <View testID="custom-alert">
        <Text>{title}</Text>
        {(buttons || []).map((b: any) => (
          <Text key={b.text} onPress={b.onPress}>{b.text}</Text>
        ))}
      </View>
    );
  };
  return { ...actual, CustomAlert: StubAlert };
});

const mockPythonInstall = jest.fn(async (..._args: any[]) => { });
const mockPythonRefreshStatus = jest.fn(async (..._args: any[]) => { });
const mockExportZip = jest.fn(async (..._args: any[]) => 'UEsDBBQ=');
jest.mock('../../../src/services/python/pythonRuntimeService', () => ({
  pythonRuntimeService: {
    install: (...args: any[]) => mockPythonInstall(...args),
    refreshStatus: (...args: any[]) => mockPythonRefreshStatus(...args),
    exportProjectZip: (...args: any[]) => mockExportZip(...args),
  },
}));
jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/docs', writeFile: jest.fn(async () => { }) }));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

jest.mock('../../../src/theme', () => {
  const mockColors = {
    text: '#000', textMuted: '#999', textSecondary: '#666',
    primary: '#007AFF', background: '#FFF', surface: '#F5F5F5', border: '#E0E0E0',
  };
  return {
    useTheme: () => ({ colors: mockColors, shadows: {} }),
    useThemedStyles: (createStyles: Function) => createStyles(mockColors, {}),
  };
});

describe('ToolsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearScreensForTesting();
    mockRoute.params = undefined;
    mockEnabledTools = ['web_search', 'calculator'];
    usePythonRuntimeStore.setState({
      status: 'not_installed',
      downloadProgress: 0,
      errorMessage: null,
      executorRequested: false,
      serverOrigin: null,
    });
  });
  afterEach(() => {
    _clearScreensForTesting();
  });

  it('renders the page header and every free tool row', () => {
    const { getByText, getByTestId, queryByTestId } = render(<ToolsScreen />);
    expect(getByText('Tools')).toBeTruthy();
    for (const tool of AVAILABLE_TOOLS) {
      if (tool.hidden) {
        // Hidden companions (Python filesystem tools) are not their own rows.
        expect(queryByTestId(`tool-picker-row-${tool.id}`)).toBeNull();
      } else {
        expect(getByTestId(`tool-picker-row-${tool.id}`)).toBeTruthy();
      }
    }
  });

  it('shows the Pro Tools row to everyone (even free users)', () => {
    const { getByTestId, getByText } = render(<ToolsScreen />);
    expect(getByTestId('tools-pro-tools')).toBeTruthy();
    expect(getByText('Pro Tools')).toBeTruthy();
  });

  it('routes a free user to the Pro upsell when Pro Tools is pressed', () => {
    const { getByTestId } = render(<ToolsScreen />);
    fireEvent.press(getByTestId('tools-pro-tools'));
    expect(mockNavigate).toHaveBeenCalledWith('ProDetail');
  });

  it('routes a pro user straight to the Pro Tools screen', () => {
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });
    const { getByTestId } = render(<ToolsScreen />);
    fireEvent.press(getByTestId('tools-pro-tools'));
    expect(mockNavigate).toHaveBeenCalledWith(PRO_TOOLS_SCREEN);
  });

  it('toggles a tool through the core settings store', () => {
    const { getAllByRole } = render(<ToolsScreen />);
    const switches = getAllByRole('switch');
    // web_search + calculator are enabled, get_current_datetime is not.
    fireEvent(switches[2], 'valueChange', true);
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      enabledTools: ['web_search', 'calculator', 'get_current_datetime'],
    });
  });

  it('hides memory tool rows when chat memory is disabled', () => {
    mockRoute.params = { memoryEnabled: false };
    mockEnabledTools = ['web_search', 'search_memory', 'save_memory', 'forget_memory'];

    const { getByTestId, queryByTestId } = render(<ToolsScreen />);

    expect(getByTestId('tool-picker-row-web_search')).toBeTruthy();
    expect(queryByTestId('tool-picker-row-search_memory')).toBeNull();
    expect(queryByTestId('tool-picker-row-save_memory')).toBeNull();
    expect(queryByTestId('tool-picker-row-forget_memory')).toBeNull();
  });

  it('navigates back when the back button is pressed', () => {
    const { getByText } = render(<ToolsScreen />);
    fireEvent.press(getByText('arrow-left'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  describe('python runtime install flow', () => {
    function pythonSwitch(utils: ReturnType<typeof render>) {
      return within(utils.getByTestId('tool-picker-row-run_python')).getByRole('switch');
    }

    it('prompts for the runtime download instead of enabling when not installed', () => {
      const utils = render(<ToolsScreen />);
      fireEvent(pythonSwitch(utils), 'valueChange', true);

      expect(utils.getByTestId('custom-alert')).toBeTruthy();
      expect(utils.getByText('Download Python Runtime')).toBeTruthy();
      expect(mockUpdateSettings).not.toHaveBeenCalled();
      expect(mockPythonInstall).not.toHaveBeenCalled();
    });

    it('installs the runtime and enables the tool after confirming the download', async () => {
      const utils = render(<ToolsScreen />);
      fireEvent(pythonSwitch(utils), 'valueChange', true);
      fireEvent.press(utils.getByText('Download'));

      await waitFor(() => expect(mockPythonInstall).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({
        enabledTools: ['web_search', 'calculator', 'run_python'],
      }));
    });

    it('shows an error alert when the download fails', async () => {
      mockPythonInstall.mockRejectedValueOnce(new Error('No internet connection'));
      const utils = render(<ToolsScreen />);
      fireEvent(pythonSwitch(utils), 'valueChange', true);
      fireEvent.press(utils.getByText('Download'));

      await waitFor(() => expect(utils.getByText('Download Failed')).toBeTruthy());
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('toggles normally once the runtime is installed', () => {
      usePythonRuntimeStore.setState({ status: 'installed' });
      const utils = render(<ToolsScreen />);
      fireEvent(pythonSwitch(utils), 'valueChange', true);

      expect(utils.queryByTestId('custom-alert')).toBeNull();
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        enabledTools: ['web_search', 'calculator', 'run_python'],
      });
    });

    it('shows download progress in the row while downloading', () => {
      usePythonRuntimeStore.setState({ status: 'downloading', downloadProgress: 0.42 });
      const utils = render(<ToolsScreen />);
      expect(utils.getByText('Downloading Python runtime... 42%')).toBeTruthy();
    });

    it('shows the export-workspace button only once Python is installed', () => {
      const notInstalled = render(<ToolsScreen />);
      expect(notInstalled.queryByTestId('tools-export-workspace')).toBeNull();
      notInstalled.unmount();

      usePythonRuntimeStore.setState({ status: 'installed' });
      const installed = render(<ToolsScreen />);
      expect(installed.getByTestId('tools-export-workspace')).toBeTruthy();
    });

    it('exports the workspace as a zip and opens the share sheet when tapped', async () => {
      const { Share } = require('react-native');
      const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
      usePythonRuntimeStore.setState({ status: 'installed' });
      const utils = render(<ToolsScreen />);
      fireEvent.press(utils.getByTestId('tools-export-workspace'));
      await waitFor(() => expect(mockExportZip).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(shareSpy).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'file:///docs/python-workspace.zip' }),
      ));
      shareSpy.mockRestore();
    });

    it('shows the short one-line description in the row, not the full model instructions', () => {
      const utils = render(<ToolsScreen />);
      expect(utils.getByText(/Run Python 3\.12 on-device with numpy, pandas, and matplotlib/)).toBeTruthy();
      // The long model-facing description must not wall off the settings list.
      expect(utils.queryByText(/sandboxed on-device interpreter/)).toBeNull();
    });

    it('re-downloads automatically when Python is enabled but not installed', async () => {
      // A bundled-asset update invalidates a prior install: the tool is still
      // enabled but the runtime is gone. The screen should heal it without the
      // user having to toggle off and on.
      mockEnabledTools = ['web_search', 'run_python'];
      usePythonRuntimeStore.setState({ status: 'not_installed' });
      render(<ToolsScreen />);
      await waitFor(() => expect(mockPythonInstall).toHaveBeenCalledTimes(1));
    });

    it('does not auto-download when Python is not enabled', () => {
      mockEnabledTools = ['web_search', 'calculator'];
      usePythonRuntimeStore.setState({ status: 'not_installed' });
      render(<ToolsScreen />);
      expect(mockPythonInstall).not.toHaveBeenCalled();
    });
  });
});
