/**
 * MemoryScreen Tests
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockListMemories = jest.fn();
const mockListPendingCandidates = jest.fn();
const mockForgetMemory = jest.fn();
const mockApproveCandidate = jest.fn();
const mockDiscardCandidate = jest.fn();
const mockUpdateSettings = jest.fn();
let mockRouteParams: { projectId?: string } | undefined = { projectId: 'proj1' };
let mockAutoCaptureEnabled = false;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      navigate: mockNavigate,
      setOptions: jest.fn(),
    }),
    useRoute: () => ({
      params: mockRouteParams,
    }),
    useFocusEffect: jest.fn((cb) => {
      const ReactRuntime = require('react');
      ReactRuntime.useEffect(() => cb(), [cb]);
    }),
  };
});

jest.mock('../../../src/services/memory', () => ({
  memoryService: {
    listMemories: (...args: any[]) => mockListMemories(...args),
    listPendingCandidates: (...args: any[]) => mockListPendingCandidates(...args),
    forgetMemory: (...args: any[]) => mockForgetMemory(...args),
    approveCandidate: (...args: any[]) => mockApproveCandidate(...args),
    discardCandidate: (...args: any[]) => mockDiscardCandidate(...args),
  },
}));

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      settings: { memoryAutoCaptureEnabled: mockAutoCaptureEnabled },
      updateSettings: mockUpdateSettings,
    };
    return selector ? selector(state) : state;
  }),
  useProjectStore: jest.fn((selector?: any) => {
    const state = { getProject: () => ({ id: 'proj1', name: 'Research Project' }) };
    return selector ? selector(state) : state;
  }),
}));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { Alert } from 'react-native';
import { MemoryScreen, parseMemoryDisplayDate } from '../../../src/screens/MemoryScreen';

const projectMemory = {
  id: 1,
  scope: 'project',
  project_id: 'proj1',
  kind: 'research_note',
  title: 'Solar permit office',
  body: 'User said: Permit office closes at 3 PM on Fridays.',
  tags: ['solar'],
  confidence: 0.8,
  importance: 3,
  status: 'active',
  source_type: 'chat_message',
  created_at: '2026-07-03T00:00:00.000Z',
  updated_at: '2026-07-03T00:00:00.000Z',
};

const globalMemory = {
  ...projectMemory,
  id: 2,
  scope: 'global',
  project_id: null,
  title: 'Concise answers',
  body: 'User prefers concise summaries.',
  tags: ['style'],
  source_type: 'manual',
};

const memoryCandidate = {
  id: 3,
  scope: 'project',
  project_id: 'proj1',
  kind: 'research_note',
  title: 'Solar permit deadline',
  body: 'The county solar permit office closes at 3 PM on Fridays.',
  tags: ['solar'],
  confidence: 0.72,
  importance: 3,
  status: 'pending',
  source_type: 'auto_capture',
  source_id: 'msg-auto-1',
  jurisdiction: 'United States',
  as_of_date: '2026-07-03',
  created_at: '2026-07-03T00:00:00.000Z',
  updated_at: '2026-07-03T00:00:00.000Z',
};

const toolMemory = {
  ...globalMemory,
  id: 4,
  title: 'Tool saved note',
  body: 'Assistant saved this through the memory tool.',
  tags: ['tool'],
  source_type: 'assistant_tool',
};

const flushPromises = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

describe('MemoryScreen', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouteParams = { projectId: 'proj1' };
    mockAutoCaptureEnabled = false;
    mockListMemories.mockResolvedValue([projectMemory, globalMemory]);
    mockListPendingCandidates.mockResolvedValue([]);
    mockForgetMemory.mockResolvedValue(true);
    mockApproveCandidate.mockResolvedValue(projectMemory);
    mockDiscardCandidate.mockResolvedValue(true);
  });

  it('renders project memory rows', async () => {
    const { getByText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText('Research Project Memory')).toBeTruthy();
    expect(getByText('Solar permit office')).toBeTruthy();
    expect(getByText('Concise answers')).toBeTruthy();
    expect(getByText(/Research Note - Saved chat - solar/)).toBeTruthy();
    expect(getByText(/Research Note - Manual - style/)).toBeTruthy();
    expect(mockListMemories).toHaveBeenCalledWith('proj1');
    expect(mockListPendingCandidates).toHaveBeenCalledWith('proj1');
  });

  it('shows empty state when no memories exist', async () => {
    mockListMemories.mockResolvedValueOnce([]);

    const { getByText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText('No memories yet')).toBeTruthy();
  });

  it('toggles auto-capture review setting', async () => {
    const { getByTestId, getByText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText('Auto-memory suggestions')).toBeTruthy();
    expect(getByText('Drafts local chat memories for review. Nothing is used until you save it.')).toBeTruthy();

    fireEvent(getByTestId('memory-auto-capture-toggle'), 'valueChange', true);

    expect(mockUpdateSettings).toHaveBeenCalledWith({ memoryAutoCaptureEnabled: true });
  });

  it('filters memories by search text', async () => {
    const { getByTestId, getByText, queryByText } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.changeText(getByTestId('memory-search-input'), 'concise');

    expect(getByText('Concise answers')).toBeTruthy();
    expect(queryByText('Solar permit office')).toBeNull();
  });

  it('filters project views by memory scope', async () => {
    const { getByTestId, getByText, queryByText } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-filter-project'));
    expect(getByText('Solar permit office')).toBeTruthy();
    expect(queryByText('Concise answers')).toBeNull();

    fireEvent.press(getByTestId('memory-filter-global'));
    expect(getByText('Concise answers')).toBeTruthy();
    expect(queryByText('Solar permit office')).toBeNull();
  });

  it('filters pending suggestions with the same search control', async () => {
    mockListPendingCandidates.mockResolvedValueOnce([memoryCandidate]);

    const { getByTestId, getByText, queryByText } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.changeText(getByTestId('memory-search-input'), 'deadline');

    expect(getByText('Solar permit deadline')).toBeTruthy();
    expect(queryByText('Concise answers')).toBeNull();
  });

  it('shows candidate jurisdiction and as-of metadata before quick save', async () => {
    mockListPendingCandidates.mockResolvedValueOnce([memoryCandidate]);

    const { getByText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText(/Auto-captured - Research Note - United States - as of Jul 3, 2026 - solar/)).toBeTruthy();
  });

  it('parses date-only values as local dates', () => {
    expect(parseMemoryDisplayDate('2026-07-03').getDate()).toBe(3);
  });

  it('labels and searches assistant tool saved memories', async () => {
    mockListMemories.mockResolvedValueOnce([toolMemory]);

    const { getByTestId, getByText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText(/Research Note - Tool saved - tool/)).toBeTruthy();

    fireEvent.changeText(getByTestId('memory-search-input'), 'tool saved');

    expect(getByText('Tool saved note')).toBeTruthy();
  });

  it('sets accessible labels and states on memory controls', async () => {
    mockListPendingCandidates.mockResolvedValueOnce([memoryCandidate]);

    const { getByLabelText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByLabelText('Go back')).toBeTruthy();
    expect(getByLabelText('Add memory')).toBeTruthy();
    expect(getByLabelText('Search memories')).toBeTruthy();
    expect(getByLabelText('Show all memories').props.accessibilityState).toEqual({ selected: true });
    expect(getByLabelText('Show project memories').props.accessibilityState).toEqual({ selected: false });
    expect(getByLabelText('Save memory suggestion Solar permit deadline')).toBeTruthy();
    expect(getByLabelText('Edit memory suggestion Solar permit deadline')).toBeTruthy();
    expect(getByLabelText('Dismiss memory suggestion Solar permit deadline')).toBeTruthy();
    expect(getByLabelText('Forget memory Solar permit office')).toBeTruthy();
  });

  it('renders pending suggestions and approves one into saved memory', async () => {
    mockListPendingCandidates.mockResolvedValueOnce([memoryCandidate]).mockResolvedValueOnce([]);

    const { getByText, getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText('Review Suggestions')).toBeTruthy();
    expect(getByText('Solar permit deadline')).toBeTruthy();

    fireEvent.press(getByTestId('memory-candidate-approve-3'));
    await flushPromises();

    expect(mockApproveCandidate).toHaveBeenCalledWith(3, {}, 'proj1');
    expect(mockListMemories).toHaveBeenCalledTimes(2);
  });

  it('opens a pending suggestion in the memory editor', async () => {
    mockListPendingCandidates.mockResolvedValueOnce([memoryCandidate]);

    const { getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-candidate-edit-3'));

    expect(mockNavigate).toHaveBeenCalledWith('MemoryEditor', { projectId: 'proj1', candidateId: 3 });
  });

  it('dismisses a pending suggestion without saving it', async () => {
    mockListPendingCandidates.mockResolvedValueOnce([memoryCandidate]).mockResolvedValueOnce([]);

    const { getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-candidate-discard-3'));
    await flushPromises();

    expect(mockDiscardCandidate).toHaveBeenCalledWith(3, 'proj1');
    expect(mockApproveCandidate).not.toHaveBeenCalled();
  });

  it('loads global memories without project context', async () => {
    mockRouteParams = undefined;
    mockListMemories.mockResolvedValueOnce([globalMemory]);

    const { getByText } = render(<MemoryScreen />);
    await flushPromises();

    expect(getByText('Memory')).toBeTruthy();
    expect(getByText('Concise answers')).toBeTruthy();
    expect(mockListMemories).toHaveBeenCalledWith(undefined);
  });

  it('opens project memory editor from add button', async () => {
    const { getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-add'));

    expect(mockNavigate).toHaveBeenCalledWith('MemoryEditor', { projectId: 'proj1' });
  });

  it('opens global memory editor without project params', async () => {
    mockRouteParams = undefined;
    const { getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-add'));

    expect(mockNavigate).toHaveBeenCalledWith('MemoryEditor');
  });

  it('deletes project memory with project context', async () => {
    let confirmCallback: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as any[];
      confirmCallback = buttons?.find((button: any) => button.style === 'destructive')?.onPress;
    });

    const { getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-delete-1'));
    await act(async () => {
      await confirmCallback?.();
      await flushPromises();
    });

    expect(mockForgetMemory).toHaveBeenCalledWith(1, 'proj1', { allowGlobalFromProject: false });
  });

  it('deletes shared memory without project context', async () => {
    let confirmCallback: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as any[];
      confirmCallback = buttons?.find((button: any) => button.style === 'destructive')?.onPress;
    });

    const { getByTestId } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByTestId('memory-delete-2'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Forget Shared Memory',
      expect.stringContaining('every project and chat'),
      expect.any(Array),
    );
    await act(async () => {
      await confirmCallback?.();
      await flushPromises();
    });

    expect(mockForgetMemory).toHaveBeenCalledWith(2, 'proj1', { allowGlobalFromProject: true });
  });

  it('goes back from the header button', async () => {
    const { getByText } = render(<MemoryScreen />);
    await flushPromises();

    fireEvent.press(getByText('arrow-left'));

    expect(mockGoBack).toHaveBeenCalled();
  });
});
