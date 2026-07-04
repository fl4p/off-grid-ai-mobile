/**
 * WebSearchSettingsScreen Tests
 *
 * Focus: API-key validation timing. The stored key must NOT be validated on
 * mount (opening the screen should fire no network probe); validation only runs
 * on an explicit edit, debounced.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack, addListener: jest.fn(() => jest.fn()) }),
    useRoute: () => ({ params: {} }),
    useIsFocused: () => true,
  };
});

const mockUpdateSettings = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      settings: { searchProvider: 'serper' },
      updateSettings: mockUpdateSettings,
      themeMode: 'system',
    };
    return selector ? selector(state) : state;
  }),
}));

const mockGetSearchApiKey = jest.fn((..._args: any[]) => Promise.resolve('stored-key-123'));
const mockStoreSearchApiKey = jest.fn((..._args: any[]) => Promise.resolve());
jest.mock('../../../src/services/tools/search/searchKeychain', () => ({
  getSearchApiKey: (...args: any[]) => mockGetSearchApiKey(...args),
  storeSearchApiKey: (...args: any[]) => mockStoreSearchApiKey(...args),
}));

const mockValidate = jest.fn((..._args: any[]) => Promise.resolve({ status: 'valid' }));
jest.mock('../../../src/services/tools/search', () => {
  const actual = jest.requireActual('../../../src/services/tools/search');
  return {
    ...actual,
    validateSearchProviderKey: (...args: any[]) => mockValidate(...args),
  };
});

jest.mock('../../../src/components', () => {
  const { View, TextInput } = require('react-native');
  return {
    Card: ({ children, style }: any) => <View style={style}>{children}</View>,
    ApiKeyInput: ({ value, onChangeText, testID }: any) => (
      <TextInput testID={testID} value={value} onChangeText={onChangeText} />
    ),
  };
});

import { WebSearchSettingsScreen } from '../../../src/screens/WebSearchSettingsScreen';

describe('WebSearchSettingsScreen key validation timing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does NOT validate the stored key on mount', async () => {
    const screen = render(<WebSearchSettingsScreen />);

    // Let the keychain load resolve and populate the field.
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('search-api-key-input').props.value).toBe('stored-key-123'));

    // Even after the debounce window, the stored key is never probed.
    act(() => { jest.advanceTimersByTime(2000); });
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('validates only after an explicit edit, debounced', async () => {
    const screen = render(<WebSearchSettingsScreen />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.changeText(screen.getByTestId('search-api-key-input'), 'new-key-abc');

    // Not called synchronously — waits for the debounce.
    expect(mockValidate).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(700); });
    expect(mockValidate).toHaveBeenCalledWith('serper', 'new-key-abc', expect.anything());
  });
});
