import React from 'react';
import { Platform, Text, type TextProps, type TextStyle } from 'react-native';
import { splitEmojiRuns } from '../utils/emojiText';

/**
 * System font that carries the platform color-emoji font: SF on iOS and Roboto
 * on Android both cascade to Apple Color Emoji / Noto Color Emoji. Setting this
 * on emoji runs overrides the inherited monospace font (Menlo), which has no
 * emoji glyphs and otherwise renders emoji as the tofu `?` box.
 */
const EMOJI_FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const emojiRunStyle: TextStyle = { fontFamily: EMOJI_FONT_FAMILY };

/**
 * Render `text` so emoji use the system color-emoji font while the rest keeps the
 * inherited style. Returns the plain string unchanged when there is no emoji, so
 * non-emoji output is identical to a bare `<Text>{text}</Text>`. `keyPrefix` must
 * be stable and unique among sibling nodes (e.g. the markdown node key).
 */
export function renderEmojiRuns(text: string, keyPrefix: string): React.ReactNode {
  const runs = splitEmojiRuns(text);
  if (!runs.some((run) => run.isEmoji)) return text;
  return runs.map((run, index) =>
    run.isEmoji ? (
      <Text key={`${keyPrefix}:e${index}`} style={emojiRunStyle}>
        {run.text}
      </Text>
    ) : (
      run.text
    ),
  );
}

interface EmojiTextProps extends TextProps {
  children: string;
}

/**
 * Drop-in `<Text>` that renders emoji in the system font (so color emoji show)
 * while keeping the inherited monospace font for everything else. Use anywhere
 * plain user/model text is shown outside the markdown renderer.
 */
export function EmojiText({ children, ...props }: Readonly<EmojiTextProps>) {
  return <Text {...props}>{renderEmojiRuns(children, 'emoji')}</Text>;
}
