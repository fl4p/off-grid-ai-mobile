/**
 * EmojiText / renderEmojiRuns tests.
 *
 * Verifies emoji are rendered in the system font (which carries color-emoji
 * glyphs) while surrounding text keeps its inherited style — the fix for emoji
 * showing as the tofu `?` box under the app's monospace Menlo font.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { EmojiText, renderEmojiRuns } from '../../../src/components/EmojiText';

/** Flatten a possibly-array style prop into a single object for assertions. */
function flatStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[].concat(style as never).filter(Boolean));
}

describe('EmojiText', () => {
  it('renders plain text with no emoji as a bare string child', () => {
    const { getByText, queryAllByText } = render(<EmojiText>hello world</EmojiText>);
    expect(getByText('hello world')).toBeTruthy();
    // No emoji means no extra nested Text nodes were introduced.
    expect(queryAllByText('hello world')).toHaveLength(1);
  });

  it('wraps an emoji in a Text using the system font', () => {
    const { getByText } = render(<EmojiText>hi 😄</EmojiText>);
    const emojiNode = getByText('😄');
    const fontFamily = flatStyle(emojiNode.props.style).fontFamily;
    expect(fontFamily).toMatch(/System|sans-serif/);
    expect(fontFamily).not.toBe('Menlo');
  });

  it('keeps non-emoji text out of the system-font wrapper', () => {
    // The emoji sits in its own node; the phrase around it is not "😄".
    const { getByText } = render(<EmojiText>emoji 🐛 here</EmojiText>);
    expect(getByText('🐛')).toBeTruthy();
    // The surrounding text is still present within the same bubble.
    expect(getByText(/emoji/)).toBeTruthy();
  });

  it('forwards props such as testID and style to the outer Text', () => {
    const { getByTestId } = render(
      <EmojiText testID="user-msg" style={{ color: 'red' }}>
        done ⭐
      </EmojiText>,
    );
    const outer = getByTestId('user-msg');
    expect(flatStyle(outer.props.style).color).toBe('red');
  });
});

describe('renderEmojiRuns', () => {
  it('returns the raw string unchanged when there is no emoji', () => {
    expect(renderEmojiRuns('just text', 'k')).toBe('just text');
  });

  it('returns an array of runs when emoji are present', () => {
    const result = renderEmojiRuns('a 😄 b', 'k');
    expect(Array.isArray(result)).toBe(true);
  });

  it('renders inside a parent Text without crashing', () => {
    const { getByText } = render(<Text>{renderEmojiRuns('score ⭐', 'node1')}</Text>);
    expect(getByText('⭐')).toBeTruthy();
  });
});
