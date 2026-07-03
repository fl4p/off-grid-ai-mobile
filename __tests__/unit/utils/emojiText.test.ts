/**
 * Unit tests for the emoji run splitter used to render emoji in the system font
 * (so color emoji show instead of the tofu `?` box under the monospace Menlo font).
 */

import { splitEmojiRuns, hasEmoji } from '../../../src/utils/emojiText';

describe('splitEmojiRuns', () => {
  it('returns no runs for an empty string', () => {
    expect(splitEmojiRuns('')).toEqual([]);
  });

  it('returns a single non-emoji run for plain text', () => {
    expect(splitEmojiRuns('hello world')).toEqual([
      { text: 'hello world', isEmoji: false },
    ]);
  });

  it('returns a single emoji run for a lone emoji', () => {
    expect(splitEmojiRuns('😄')).toEqual([{ text: '😄', isEmoji: true }]);
  });

  it('splits leading emoji from following text', () => {
    expect(splitEmojiRuns('😄 hi')).toEqual([
      { text: '😄', isEmoji: true },
      { text: ' hi', isEmoji: false },
    ]);
  });

  it('splits trailing emoji from preceding text', () => {
    expect(splitEmojiRuns('done ⭐')).toEqual([
      { text: 'done ', isEmoji: false },
      { text: '⭐', isEmoji: true },
    ]);
  });

  it('splits an emoji embedded between text (the chat bullet case)', () => {
    expect(splitEmojiRuns('🐛 Bugs and edge cases')).toEqual([
      { text: '🐛', isEmoji: true },
      { text: ' Bugs and edge cases', isEmoji: false },
    ]);
  });

  it('keeps adjacent emoji as separate emoji runs', () => {
    expect(splitEmojiRuns('🔒⭐')).toEqual([
      { text: '🔒', isEmoji: true },
      { text: '⭐', isEmoji: true },
    ]);
  });

  it('keeps a skin-tone modified emoji as one run', () => {
    expect(splitEmojiRuns('👍🏽')).toEqual([{ text: '👍🏽', isEmoji: true }]);
  });

  it('keeps a ZWJ family sequence as one run', () => {
    const family = '👨‍👩‍👧';
    expect(splitEmojiRuns(family)).toEqual([{ text: family, isEmoji: true }]);
  });

  it('keeps a flag (regional indicator pair) as one run', () => {
    expect(splitEmojiRuns('🇺🇸')).toEqual([{ text: '🇺🇸', isEmoji: true }]);
  });

  it.each([
    'plain text only',
    '😄 leading',
    'trailing ⭐',
    'a 🐛 b 🔒 c',
    '👨‍👩‍👧 family 👍🏽 skin 🇺🇸 flag',
    '',
  ])('round-trips content exactly for %p', (input) => {
    const joined = splitEmojiRuns(input)
      .map((run) => run.text)
      .join('');
    expect(joined).toBe(input);
  });

  it('does not create empty runs between adjacent emoji and text boundaries', () => {
    const runs = splitEmojiRuns('a😄b');
    expect(runs.every((run) => run.text.length > 0)).toBe(true);
    expect(runs).toEqual([
      { text: 'a', isEmoji: false },
      { text: '😄', isEmoji: true },
      { text: 'b', isEmoji: false },
    ]);
  });
});

describe('hasEmoji', () => {
  it('is true when an emoji is present', () => {
    expect(hasEmoji('review this 🐛')).toBe(true);
  });

  it('is false for plain text', () => {
    expect(hasEmoji('no emoji here, just code()')).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(hasEmoji('')).toBe(false);
  });
});
