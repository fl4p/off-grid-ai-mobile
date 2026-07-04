/**
 * Copy Transcript Integration Tests
 *
 * Exercises handleCopyTranscriptFn end-to-end across layers: the ChatScreen
 * handler → buildTranscript util → clipboard/haptics, plus the reasoning-aware
 * alert branch driven by the real showAlert helper. Native modules (Clipboard,
 * haptics) are mocked; all app logic is real.
 */

import React from 'react';
import { Clipboard } from 'react-native';
import { handleCopyTranscriptFn } from '../../../src/screens/ChatScreen/useChatMessageHandlers';
import { AlertState } from '../../../src/components';
import { triggerHaptic } from '../../../src/utils/haptics';
import { createConversation, createUserMessage, createAssistantMessage, createSystemMessage } from '../../utils/factories';

jest.mock('../../../src/utils/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

const mockSetString = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
const mockTriggerHaptic = triggerHaptic as jest.Mock;

describe('handleCopyTranscriptFn', () => {
  let alertState: AlertState;
  const setAlertState = jest.fn((next: React.SetStateAction<AlertState>) => {
    alertState = typeof next === 'function' ? next(alertState) : next;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    alertState = { visible: false, title: '' };
  });

  it('copies immediately and confirms when there is no reasoning', () => {
    const conversation = createConversation({
      messages: [
        createUserMessage('What is 2+2?'),
        createAssistantMessage('4'),
      ],
    });

    handleCopyTranscriptFn({ activeConversation: conversation, setAlertState });

    expect(mockSetString).toHaveBeenCalledWith('User:\nWhat is 2+2?\n\nAssistant:\n4');
    expect(mockTriggerHaptic).toHaveBeenCalledWith('notificationSuccess');
    expect(alertState.title).toBe('Copied');
  });

  it('warns and copies nothing when the conversation is empty', () => {
    const conversation = createConversation({ messages: [] });

    handleCopyTranscriptFn({ activeConversation: conversation, setAlertState });

    expect(mockSetString).not.toHaveBeenCalled();
    expect(alertState.title).toBe('Nothing to Copy');
  });

  it('warns instead of copying an empty string when only system-info messages exist', () => {
    const conversation = createConversation({
      messages: [createSystemMessage('Model loaded', { isSystemInfo: true })],
    });

    handleCopyTranscriptFn({ activeConversation: conversation, setAlertState });

    expect(mockSetString).not.toHaveBeenCalled();
    expect(alertState.title).toBe('Nothing to Copy');
  });

  describe('when the conversation contains reasoning', () => {
    const conversationWithReasoning = () => createConversation({
      messages: [
        createUserMessage('What is 2+2?'),
        { ...createAssistantMessage('The answer is 4'), reasoningContent: '2 plus 2 equals 4' },
      ],
    });

    it('copies the text-only transcript up front and confirms with an upgrade option', () => {
      handleCopyTranscriptFn({ activeConversation: conversationWithReasoning(), setAlertState });

      // Copied immediately (text only), with visual + haptic confirmation.
      expect(mockSetString).toHaveBeenCalledWith('User:\nWhat is 2+2?\n\nAssistant:\nThe answer is 4');
      expect(mockTriggerHaptic).toHaveBeenCalledWith('notificationSuccess');
      expect(alertState.title).toBe('Copied');
      const labels = (alertState.buttons || []).map((b) => b.text);
      expect(labels).toEqual(['Text only', 'Include reasoning']);
    });

    it('re-copies with reasoning when "Include reasoning" is chosen', () => {
      handleCopyTranscriptFn({ activeConversation: conversationWithReasoning(), setAlertState });
      mockSetString.mockClear();
      const withReasoning = alertState.buttons!.find((b) => b.text === 'Include reasoning')!;

      withReasoning.onPress!();

      expect(mockSetString).toHaveBeenCalledWith(
        'User:\nWhat is 2+2?\n\nAssistant (thinking):\n2 plus 2 equals 4\n\nAssistant:\nThe answer is 4',
      );
      expect(mockTriggerHaptic).toHaveBeenCalledWith('notificationSuccess');
    });

    it('leaves the text-only copy in place when "Text only" is chosen', () => {
      handleCopyTranscriptFn({ activeConversation: conversationWithReasoning(), setAlertState });
      const textOnly = alertState.buttons!.find((b) => b.text === 'Text only')!;

      // "Text only" is a plain dismiss - no onPress, transcript already copied.
      expect(textOnly.onPress).toBeUndefined();
    });
  });

  it('includes attachment-only turns via a placeholder', () => {
    const conversation = createConversation({
      messages: [
        { ...createUserMessage(''), attachments: [{ id: 'a1', type: 'image', uri: 'file://x', fileName: 'cat.png' }] },
        createAssistantMessage('I see a cat.'),
      ],
    });

    handleCopyTranscriptFn({ activeConversation: conversation, setAlertState });

    expect(mockSetString).toHaveBeenCalledWith('User:\n[image: cat.png]\n\nAssistant:\nI see a cat.');
  });
});
