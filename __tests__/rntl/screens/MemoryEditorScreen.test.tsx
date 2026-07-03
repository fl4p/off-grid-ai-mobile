/**
 * MemoryEditorScreen Tests
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockSaveMemory = jest.fn();
const mockGetCandidate = jest.fn();
const mockApproveCandidate = jest.fn();
const mockNavigation = {
  goBack: mockGoBack,
  navigate: jest.fn(),
  setOptions: jest.fn(),
};
let mockRouteParams: { projectId?: string; candidateId?: number } | undefined = { projectId: 'proj-tax' };

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => mockNavigation,
    useRoute: () => ({
      params: mockRouteParams,
    }),
  };
});

jest.mock('../../../src/services/memory', () => ({
  memoryService: {
    saveMemory: (...args: any[]) => mockSaveMemory(...args),
    getCandidate: (...args: any[]) => mockGetCandidate(...args),
    approveCandidate: (...args: any[]) => mockApproveCandidate(...args),
  },
}));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { Alert } from 'react-native';
import { MemoryEditorScreen } from '../../../src/screens/MemoryEditorScreen';

const memoryCandidate = {
  id: 3,
  scope: 'project',
  project_id: 'proj-tax',
  kind: 'research_note',
  title: 'Solar permit deadline',
  body: 'The county solar permit office closes at 3 PM on Fridays.',
  tags: ['solar'],
  confidence: 0.72,
  importance: 3,
  status: 'pending',
  source_type: 'auto_capture',
  source_id: 'msg-auto-1',
  source_excerpt: 'Remember that the county solar permit office closes at 3 PM on Fridays.',
  created_at: '2026-07-03T00:00:00.000Z',
  updated_at: '2026-07-03T00:00:00.000Z',
} as const;

const flushPromises = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

describe('MemoryEditorScreen', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouteParams = { projectId: 'proj-tax' };
    mockSaveMemory.mockResolvedValue({ id: 1 });
    mockGetCandidate.mockResolvedValue(memoryCandidate);
    mockApproveCandidate.mockResolvedValue({ id: 4 });
  });

  it('saves a project-scoped memory with metadata', async () => {
    const { getByTestId, getByText } = render(<MemoryEditorScreen />);

    expect(getByTestId('memory-scope-label').props.children).toBe('Project Memory');
    expect(getByText('Only this project can recall this memory.')).toBeTruthy();

    fireEvent.changeText(getByTestId('memory-title-input'), 'Solar tax note');
    fireEvent.changeText(getByTestId('memory-body-input'), 'Verify federal rules before filing.');
    fireEvent.press(getByTestId('memory-kind-source_backed_fact'));
    fireEvent.changeText(getByTestId('memory-tags-input'), 'tax, solar');
    fireEvent.changeText(getByTestId('memory-jurisdiction-input'), 'United States');
    fireEvent.changeText(getByTestId('memory-as-of-input'), '2026-07-03');

    await act(async () => {
      fireEvent.press(getByTestId('memory-save'));
      await Promise.resolve();
    });

    expect(mockSaveMemory).toHaveBeenCalledWith({
      projectId: 'proj-tax',
      scope: 'project',
      kind: 'source_backed_fact',
      title: 'Solar tax note',
      body: 'Verify federal rules before filing.',
      tags: ['tax', 'solar'],
      jurisdiction: 'United States',
      asOfDate: '2026-07-03',
      sourceType: 'manual',
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('saves global memory when no project route param is present', async () => {
    mockRouteParams = undefined;
    const { getByTestId, getByText } = render(<MemoryEditorScreen />);

    expect(getByTestId('memory-scope-label').props.children).toBe('Shared Memory');
    expect(getByText('All local chats and projects can recall this memory.')).toBeTruthy();

    fireEvent.changeText(getByTestId('memory-title-input'), 'Trail camera batteries');
    fireEvent.changeText(getByTestId('memory-body-input'), 'Use rechargeable AA cells.');

    await act(async () => {
      fireEvent.press(getByTestId('memory-save'));
      await Promise.resolve();
    });

    expect(mockSaveMemory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: undefined,
      scope: 'global',
      title: 'Trail camera batteries',
      body: 'Use rechargeable AA cells.',
    }));
  });

  it('shows validation errors without saving', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((..._args: unknown[]) => undefined);
    const { getByTestId } = render(<MemoryEditorScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('memory-save'));
      await Promise.resolve();
    });

    expect(mockSaveMemory).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Memory Error', 'Title is required');
  });

  it('loads a pending suggestion and approves edited values', async () => {
    mockRouteParams = { projectId: 'proj-tax', candidateId: 3 };
    const { getByTestId, getByText } = render(<MemoryEditorScreen />);
    await flushPromises();

    expect(mockGetCandidate).toHaveBeenCalledWith(3, 'proj-tax');
    expect(getByText('Review Memory')).toBeTruthy();
    expect(getByTestId('memory-scope-label').props.children).toBe('Project Memory');
    expect(getByTestId('memory-candidate-source').props.children).toContain('county solar permit office');
    expect(getByTestId('memory-title-input').props.value).toBe('Solar permit deadline');

    fireEvent.changeText(getByTestId('memory-title-input'), 'Edited permit office hours');
    fireEvent.changeText(getByTestId('memory-body-input'), 'Office closes at 3 PM on Fridays; verify holiday hours.');
    fireEvent.changeText(getByTestId('memory-tags-input'), 'solar, permits');
    fireEvent.changeText(getByTestId('memory-jurisdiction-input'), 'United States');

    await act(async () => {
      fireEvent.press(getByTestId('memory-save'));
      await Promise.resolve();
    });

    expect(mockApproveCandidate).toHaveBeenCalledWith(
      3,
      {
        kind: 'research_note',
        title: 'Edited permit office hours',
        body: 'Office closes at 3 PM on Fridays; verify holiday hours.',
        tags: ['solar', 'permits'],
        jurisdiction: 'United States',
        asOfDate: undefined,
      },
      'proj-tax',
    );
    expect(mockSaveMemory).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('goes back from the header button', () => {
    const { getByText } = render(<MemoryEditorScreen />);

    fireEvent.press(getByText('arrow-left'));

    expect(mockGoBack).toHaveBeenCalled();
  });
});
