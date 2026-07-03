import emojiRegex from 'emoji-regex';

/**
 * The app renders all text in a monospace font (Menlo) that has no emoji glyphs,
 * so emoji fall back to the OS "missing glyph" box (the tofu `?` square). To fix
 * that we render emoji in the system font, which cascades to the platform's
 * color-emoji font. Splitting a string into emoji / non-emoji runs lets us keep
 * the monospace look for text while handing emoji to the system font.
 */
export interface TextRun {
  text: string;
  /** True when this run is a single emoji sequence (grapheme incl. ZWJ/modifiers). */
  isEmoji: boolean;
}

/**
 * Split a string into consecutive emoji / non-emoji runs, preserving order and
 * content exactly: concatenating every run's `text` reproduces the input. Emoji
 * sequences (skin-tone modifiers, ZWJ families, flags) are matched as one run via
 * `emoji-regex` rather than per code point, so they are never torn apart.
 */
export function splitEmojiRuns(input: string): TextRun[] {
  const runs: TextRun[] = [];
  if (!input) return runs;

  const regex = emojiRegex();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: input.slice(lastIndex, match.index), isEmoji: false });
    }
    runs.push({ text: match[0], isEmoji: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < input.length) {
    runs.push({ text: input.slice(lastIndex), isEmoji: false });
  }
  return runs;
}

/** True when the string contains at least one emoji sequence. */
export function hasEmoji(input: string): boolean {
  return emojiRegex().test(input);
}
