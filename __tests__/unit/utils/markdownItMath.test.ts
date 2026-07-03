/**
 * Unit tests for the markdown-it math tokenizer.
 *
 * Verifies that `$…$` / `$$…$$` become math tokens carrying the raw TeX, and
 * that prose that merely contains dollar signs (currency, spaced operators) is
 * left as plain text.
 */

import { MarkdownIt } from '@ronradtke/react-native-markdown-display';
import { markdownItMath } from '../../../src/utils/markdownItMath';

const md = MarkdownIt({ typographer: true }).use(markdownItMath);

/** Collect every token of a given type, walking into inline children. */
function tokensOfType(src: string, type: string): { content: string }[] {
  const out: { content: string }[] = [];
  const walk = (tokens: any[]) => {
    for (const t of tokens) {
      if (t.type === type) out.push({ content: t.content });
      if (t.children) walk(t.children);
    }
  };
  walk(md.parse(src, {}));
  return out;
}

describe('markdownItMath', () => {
  it('tokenizes inline math and strips the delimiters', () => {
    const tokens = tokensOfType('the shape of $\\sin(x)$.', 'math_inline');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toBe('\\sin(x)');
  });

  it('tokenizes block math', () => {
    const tokens = tokensOfType('$$\n\\int_0^1 x\\,dx\n$$', 'math_block');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toContain('\\int_0^1');
  });

  it('keeps a multiplication asterisk verbatim inside inline math', () => {
    const tokens = tokensOfType('$5*3$', 'math_inline');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toBe('5*3');
  });

  it('does not treat currency as math', () => {
    // "$5 and $3" — closing delimiter is preceded by a space, so not math.
    expect(tokensOfType('I paid $5 and $3 more', 'math_inline')).toHaveLength(0);
  });

  it('does not treat an empty $$ as inline math', () => {
    expect(tokensOfType('a $$ b', 'math_inline')).toHaveLength(0);
  });

  it('respects escaped dollar signs', () => {
    expect(tokensOfType('cost is \\$5 today', 'math_inline')).toHaveLength(0);
  });

  it('handles multiple inline formulas in one line', () => {
    const tokens = tokensOfType('$a$ plus $b$ equals $c$', 'math_inline');
    expect(tokens.map((t) => t.content)).toEqual(['a', 'b', 'c']);
  });

  it('tokenizes \\(…\\) inline math', () => {
    const tokens = tokensOfType('the shape of \\(\\sin(x)\\).', 'math_inline');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toBe('\\sin(x)');
  });

  it('tokenizes \\[…\\] block math', () => {
    const tokens = tokensOfType('\\[\n\\int_0^1 x\\,dx\n\\]', 'math_block');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toContain('\\int_0^1');
  });

  it('tokenizes single-line \\[…\\] block math', () => {
    const tokens = tokensOfType('\\[a^2 + b^2 = c^2\\]', 'math_block');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toContain('a^2 + b^2 = c^2');
  });

  it('does not treat an escaped paren as math', () => {
    // "\(" with no closing "\)" is left for markdown-it's escape rule.
    expect(tokensOfType('a literal \\( paren', 'math_inline')).toHaveLength(0);
  });
});
