import React, { useCallback, useMemo } from 'react';
import { Linking, Text } from 'react-native';
import Markdown, { MarkdownIt } from '@ronradtke/react-native-markdown-display';
import { useTheme } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING, FONTS } from '../constants';
import { markdownItMath } from '../utils/markdownItMath';
import { MathText } from './MathText';

/**
 * markdown-it instance extended with the `$…$` / `$$…$$` math tokenizer. Built
 * once (identity is stable) so the Markdown component doesn't rebuild its parser
 * on every render.
 */
const markdownItInstance = MarkdownIt({ typographer: true }).use(markdownItMath);

/**
 * Matches math spans — `$$…$$` / `\[…\]` blocks and `$…$` / `\(…\)` inline — so
 * they can be left untouched by the asterisk escaping below.
 */
const MATH_SPAN_RE =
  /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?:\\\$|[^$])+?\$/g;

/**
 * Escape asterisks used as multiplication operators (digit*digit) so
 * markdown-it doesn't treat them as emphasis markers.
 * Lookahead handles chains like 5*5*5*5 in a single pass.
 */
function escapeMultiplicationAsterisks(text: string): string {
  return text.replaceAll(/(\d)\*(?=\d)/g, String.raw`$1\*`);
}

/**
 * Apply the asterisk escaping only outside math spans — inside `$…$`/`$$…$$` the
 * asterisk is a TeX operator and must reach MathJax verbatim (escaping it to
 * `\*` would corrupt the formula).
 */
export function preprocessMarkdown(text: string): string {
  let result = '';
  let last = 0;
  for (const match of text.matchAll(MATH_SPAN_RE)) {
    const index = match.index ?? 0;
    result += escapeMultiplicationAsterisks(text.slice(last, index));
    result += match[0];
    last = index + match[0].length;
  }
  result += escapeMultiplicationAsterisks(text.slice(last));
  return result;
}

/** Custom link rule — renders as inline Text so it wraps correctly inside list items */
function createLinkRule(onPress: (url: string) => void) {
  return (node: any, children: any, ...[, styles]: any[]) => (
    <Text
      key={node.key}
      accessibilityRole="link"
      style={styles.link}
      onPress={() => onPress(node.attributes?.href ?? '')}
    >
      {children}
    </Text>
  );
}

/** Drop the trailing newline markdown-it appends to code blocks. */
function trimTrailingNewline(content: string): string {
  return typeof content === 'string' && content.endsWith('\n') ? content.slice(0, -1) : content;
}

/**
 * Make rendered text selectable so users can long-press to select and copy
 * partial text (selectable propagates to nested inline Text). `textgroup` wraps
 * all paragraph/inline text; fence/code_block cover code so it can be copied too.
 */
const selectableRules = {
  // rest-param signature (node, children, parent, styles, inheritedStyles) keeps
  // within the param limit while matching the markdown lib's rule API.
  textgroup: (node: any, children: any, ...[, styles]: any[]) => (
    <Text key={node.key} style={styles.textgroup} selectable>
      {children}
    </Text>
  ),
  fence: (node: any, _children: any, ...[, styles, inheritedStyles = {}]: any[]) => (
    <Text key={node.key} style={[inheritedStyles, styles.fence]} selectable>
      {trimTrailingNewline(node.content)}
    </Text>
  ),
  code_block: (node: any, _children: any, ...[, styles, inheritedStyles = {}]: any[]) => (
    <Text key={node.key} style={[inheritedStyles, styles.code_block]} selectable>
      {trimTrailingNewline(node.content)}
    </Text>
  ),
};

const MATH_FONT_SIZE = TYPOGRAPHY.body.fontSize ?? 14;

/**
 * Render `$…$` / `$$…$$` math tokens (produced by markdownItMath) as MathJax SVG.
 * node.content holds the raw TeX; MathText handles color, sizing, and the
 * invalid-TeX fallback.
 */
function createMathRules(color: string) {
  return {
    math_inline: (node: any) => (
      <MathText key={node.key} tex={node.content} color={color} fontSize={MATH_FONT_SIZE} />
    ),
    math_block: (node: any) => (
      <MathText key={node.key} tex={node.content} color={color} fontSize={MATH_FONT_SIZE} block />
    ),
  };
}

interface MarkdownTextProps {
  children: string;
  dimmed?: boolean;
}

export function MarkdownText({ children, dimmed }: MarkdownTextProps) {
  const { colors } = useTheme();
  const markdownStyles = useMemo(
    () => createMarkdownStyles(colors, dimmed),
    [colors, dimmed],
  );

  const handleLinkPress = useCallback((url: string) => {
    Linking.openURL(url);
    return false;
  }, []);

  const processed = useMemo(() => preprocessMarkdown(children), [children]);
  const textColor = dimmed ? colors.textSecondary : colors.text;
  const rules = useMemo(
    () => ({
      link: createLinkRule(handleLinkPress),
      ...selectableRules,
      ...createMathRules(textColor),
    }),
    [handleLinkPress, textColor],
  );

  return (
    <Markdown
      style={markdownStyles}
      onLinkPress={handleLinkPress}
      rules={rules}
      markdownit={markdownItInstance}
    >
      {processed}
    </Markdown>
  );
}

function createMarkdownStyles(colors: ThemeColors, dimmed?: boolean) {
  const textColor = dimmed ? colors.textSecondary : colors.text;

  return {
    body: {
      ...TYPOGRAPHY.body,
      color: textColor,
      lineHeight: 20,
      flexShrink: 1,
    },
    heading1: {
      ...TYPOGRAPHY.h2,
      fontWeight: '600' as const,
      color: textColor,
      marginTop: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    heading2: {
      ...TYPOGRAPHY.h2,
      color: textColor,
      marginTop: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    heading3: {
      ...TYPOGRAPHY.h3,
      fontWeight: '600' as const,
      color: textColor,
      marginTop: SPACING.xs,
      marginBottom: 2,
    },
    heading4: {
      ...TYPOGRAPHY.h3,
      color: textColor,
      marginTop: SPACING.xs,
      marginBottom: 2,
    },
    strong: {
      fontWeight: '700' as const,
    },
    em: {
      fontStyle: 'italic' as const,
    },
    s: {
      textDecorationLine: 'line-through' as const,
    },
    code_inline: {
      fontFamily: FONTS.mono,
      fontSize: 13,
      backgroundColor: colors.surfaceLight,
      color: colors.primary,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 3,
      // Override default border
      borderWidth: 0,
    },
    fence: {
      fontFamily: FONTS.mono,
      fontSize: 12,
      backgroundColor: colors.surfaceLight,
      color: textColor,
      borderRadius: 6,
      padding: SPACING.md,
      marginVertical: SPACING.sm,
      borderWidth: 0,
    },
    code_block: {
      fontFamily: FONTS.mono,
      fontSize: 12,
      backgroundColor: colors.surfaceLight,
      color: textColor,
      borderRadius: 6,
      padding: SPACING.md,
      marginVertical: SPACING.sm,
      borderWidth: 0,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: SPACING.md,
      marginLeft: 0,
      marginVertical: SPACING.sm,
      backgroundColor: colors.surfaceLight,
      borderRadius: 0,
      paddingVertical: SPACING.xs,
    },
    bullet_list: {
      marginVertical: SPACING.xs,
    },
    ordered_list: {
      marginVertical: SPACING.xs,
    },
    list_item: {
      marginVertical: 4,
    },
    // Tables
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      marginVertical: SPACING.sm,
    },
    thead: {
      backgroundColor: colors.surfaceLight,
    },
    th: {
      padding: SPACING.sm,
      borderWidth: 0.5,
      borderColor: colors.border,
      fontWeight: '600' as const,
    },
    td: {
      padding: SPACING.sm,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    tr: {
      borderBottomWidth: 0.5,
      borderColor: colors.border,
    },
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: SPACING.md,
    },
    link: {
      color: colors.primary,
      textDecorationLine: 'underline' as const,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: SPACING.sm,
    },
    // Image (unlikely in LLM text but handle gracefully)
    image: {
      borderRadius: 6,
    },
  };
}
