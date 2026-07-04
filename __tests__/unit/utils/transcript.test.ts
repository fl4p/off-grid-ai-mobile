/**
 * transcript Utility Unit Tests
 *
 * Tests buildTranscript / conversationHasReasoning - used by the "Copy
 * Transcript" chat-settings action to serialise a conversation to the
 * clipboard, optionally including the model's reasoning/thinking text.
 */

import { buildTranscript, conversationHasReasoning } from '../../../src/utils/transcript';
import { Message } from '../../../src/types';

const msg = (partial: Partial<Message>): Message => ({
  id: partial.id ?? 'id',
  role: partial.role ?? 'user',
  content: partial.content ?? '',
  timestamp: partial.timestamp ?? 0,
  ...partial,
});

describe('conversationHasReasoning', () => {
  it('returns false when no message carries reasoning', () => {
    expect(conversationHasReasoning([
      msg({ role: 'user', content: 'Hi' }),
      msg({ role: 'assistant', content: 'Hello' }),
    ])).toBe(false);
  });

  it('returns true when a message has non-empty reasoningContent', () => {
    expect(conversationHasReasoning([
      msg({ role: 'assistant', content: 'Hello', reasoningContent: 'let me think' }),
    ])).toBe(true);
  });

  it('ignores whitespace-only reasoning', () => {
    expect(conversationHasReasoning([
      msg({ role: 'assistant', content: 'Hello', reasoningContent: '   \n ' }),
    ])).toBe(false);
  });

  it('handles an empty conversation', () => {
    expect(conversationHasReasoning([])).toBe(false);
  });
});

describe('buildTranscript', () => {
  it('labels each turn by role', () => {
    const out = buildTranscript([
      msg({ role: 'user', content: 'What is 2+2?' }),
      msg({ role: 'assistant', content: '4' }),
    ]);
    expect(out).toBe('User:\nWhat is 2+2?\n\nAssistant:\n4');
  });

  it('excludes reasoning by default', () => {
    const out = buildTranscript([
      msg({ role: 'assistant', content: 'The answer is 4', reasoningContent: '2+2 is 4' }),
    ]);
    expect(out).toBe('Assistant:\nThe answer is 4');
    expect(out).not.toContain('2+2 is 4');
  });

  it('includes reasoning before the response when requested', () => {
    const out = buildTranscript([
      msg({ role: 'assistant', content: 'The answer is 4', reasoningContent: '2+2 is 4' }),
    ], { includeReasoning: true });
    expect(out).toBe('Assistant (thinking):\n2+2 is 4\n\nAssistant:\nThe answer is 4');
  });

  it('emits reasoning even when the response content is empty', () => {
    const out = buildTranscript([
      msg({ role: 'assistant', content: '', reasoningContent: 'thinking only' }),
    ], { includeReasoning: true });
    expect(out).toBe('Assistant (thinking):\nthinking only');
  });

  it('skips system-info messages', () => {
    const out = buildTranscript([
      msg({ role: 'system', content: 'Model loaded', isSystemInfo: true }),
      msg({ role: 'user', content: 'Hi' }),
    ]);
    expect(out).toBe('User:\nHi');
  });

  it('skips messages with no content and no reasoning', () => {
    const out = buildTranscript([
      msg({ role: 'assistant', content: '   ' }),
      msg({ role: 'user', content: 'Hi' }),
    ]);
    expect(out).toBe('User:\nHi');
  });

  it('strips control tokens / tool-call XML from content', () => {
    const out = buildTranscript([
      msg({ role: 'assistant', content: 'Hello<|im_end|>' }),
    ]);
    expect(out).toBe('Assistant:\nHello');
  });

  it('represents attachment-only turns with a named placeholder', () => {
    const out = buildTranscript([
      msg({ role: 'user', content: '', attachments: [{ id: 'a1', type: 'image', uri: 'file://x', fileName: 'cat.png' }] }),
    ]);
    expect(out).toBe('User:\n[image: cat.png]');
  });

  it('falls back to the attachment type when there is no file name', () => {
    const out = buildTranscript([
      msg({ role: 'user', content: 'look', attachments: [{ id: 'a1', type: 'document', uri: 'file://x' }] }),
    ]);
    expect(out).toBe('User:\n[document]\nlook');
  });

  it('labels tool messages', () => {
    const out = buildTranscript([
      msg({ role: 'tool', content: 'search result', toolName: 'web_search' }),
    ]);
    expect(out).toBe('Tool:\nsearch result');
  });

  it('returns an empty string for an empty conversation', () => {
    expect(buildTranscript([])).toBe('');
  });
});
