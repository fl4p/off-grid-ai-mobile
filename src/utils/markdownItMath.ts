/**
 * markdown-it plugin that tokenizes TeX math delimited by `$…$` (inline) and
 * `$$…$$` (block) into `math_inline` / `math_block` tokens. It does NOT render
 * the math — react-native-markdown-display turns the tokens into React nodes via
 * custom rules, and those rules hand the raw TeX (token.content) to MathJax.
 *
 * Vendored from the canonical markdown-it-katex tokenizer (runarberg, MIT) with
 * the katex renderer stripped out, so no katex/DOM dependency reaches the bundle.
 * The delimiter checks below are what keep prose like "$5 and $3" or "a $ b"
 * from being mistaken for math.
 */

type State = any;

/**
 * Decide whether the `$` at `pos` can open and/or close a math span. A delimiter
 * cannot open if it is followed by whitespace, and cannot close if it is preceded
 * by whitespace or immediately followed by a digit (so currency like `$5` is safe).
 */
function isValidDelim(state: State, pos: number) {
  const max = state.posMax;
  let canOpen = true;
  let canClose = true;

  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

  // 0x20 space, 0x09 tab, 0x30-0x39 digits
  if (prevChar === 0x20 || prevChar === 0x09 || (nextChar >= 0x30 && nextChar <= 0x39)) {
    canClose = false;
  }
  if (nextChar === 0x20 || nextChar === 0x09) {
    canOpen = false;
  }

  return { canOpen, canClose };
}

function mathInline(state: State, silent: boolean): boolean {
  if (state.src[state.pos] !== '$') return false;

  let res = isValidDelim(state, state.pos);
  if (!res.canOpen) {
    if (!silent) state.pending += '$';
    state.pos += 1;
    return true;
  }

  // First check for and bypass all properly escaped delimiters. This loop will
  // end with `match` pointing to the first character past the closing `$`.
  const start = state.pos + 1;
  let match = start;
  let pos: number;
  while ((match = state.src.indexOf('$', match)) !== -1) {
    // Walk back over escaping backslashes.
    pos = match - 1;
    while (state.src[pos] === '\\') pos -= 1;
    // Even number of escapes -> this `$` is a real (unescaped) delimiter.
    if ((match - pos) % 2 === 1) break;
    match += 1;
  }

  // No closing delimiter found — emit a literal `$`.
  if (match === -1) {
    if (!silent) state.pending += '$';
    state.pos = start;
    return true;
  }

  // Empty content ($$) — don't treat as inline math.
  if (match - start === 0) {
    if (!silent) state.pending += '$$';
    state.pos = start + 1;
    return true;
  }

  res = isValidDelim(state, match);
  if (!res.canClose) {
    if (!silent) state.pending += '$';
    state.pos = start;
    return true;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '$';
    token.content = state.src.slice(start, match);
  }

  state.pos = match + 1;
  return true;
}

// markdown-it block rules receive (state, startLine, endLine, silent). Rest-param
// signature keeps within the project's max-params limit while matching that API.
/**
 * Inline `\(…\)` math. Simpler than the `$…$` case: the delimiters are
 * unambiguous, so there is no currency/emphasis confusion to guard against.
 * Registered before markdown-it's `escape` rule, which would otherwise consume
 * `\(` as an escaped parenthesis.
 */
function mathInlineBracket(state: State, silent: boolean): boolean {
  // 0x5C = backslash
  if (state.src.charCodeAt(state.pos) !== 0x5c || state.src[state.pos + 1] !== '(') {
    return false;
  }

  const start = state.pos + 2;
  const end = state.src.indexOf('\\)', start);
  if (end === -1) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '\\(';
    token.content = state.src.slice(start, end);
  }

  state.pos = end + 2;
  return true;
}

/**
 * Parse a fenced math block delimited by `open`/`close` (e.g. `$$`…`$$` or
 * `\[`…`\]`). The block may open and close on the same line or span several.
 */
function parseMathBlock(
  state: State,
  start: number,
  opts: { end: number; open: string; close: string },
): boolean {
  const { end, open, close } = opts;
  let firstLine: string;
  let lastLine = '';
  let next: number;
  let lastPos: number;
  let found = false;
  let pos = state.bMarks[start] + state.tShift[start];
  let max = state.eMarks[start];
  const len = open.length;

  if (pos + len > max) return false;
  if (state.src.slice(pos, pos + len) !== open) return false;

  pos += len;
  firstLine = state.src.slice(pos, max);

  if (firstLine.trim().slice(-close.length) === close) {
    firstLine = firstLine.trim().slice(0, -close.length);
    found = true;
  }

  for (next = start; !found; ) {
    next += 1;
    if (next >= end) break;

    pos = state.bMarks[next] + state.tShift[next];
    max = state.eMarks[next];

    if (pos < max && state.tShift[next] < state.blkIndent) break;

    if (state.src.slice(pos, max).trim().slice(-close.length) === close) {
      lastPos = state.src.slice(0, max).lastIndexOf(close);
      lastLine = state.src.slice(pos, lastPos);
      found = true;
    }
  }

  state.line = next + 1;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content =
    (firstLine && firstLine.trim() ? `${firstLine}\n` : '') +
    state.getLines(start + 1, next, state.tShift[start], true) +
    (lastLine && lastLine.trim() ? lastLine : '');
  token.map = [start, state.line];
  token.markup = open;
  return true;
}

function mathBlockDollar(state: State, start: number, ...[end]: [number, boolean]): boolean {
  return parseMathBlock(state, start, { end, open: '$$', close: '$$' });
}

function mathBlockBracket(state: State, start: number, ...[end]: [number, boolean]): boolean {
  return parseMathBlock(state, start, { end, open: '\\[', close: '\\]' });
}

/** markdown-it plugin entry point. */
export function markdownItMath(md: any): void {
  // `\(…\)` must precede `escape`; `$…$` runs after it (mirrors markdown-it-katex).
  md.inline.ruler.before('escape', 'math_inline_bracket', mathInlineBracket);
  md.inline.ruler.after('escape', 'math_inline', mathInline);
  const blockOpts = { alt: ['paragraph', 'reference', 'blockquote', 'list'] };
  md.block.ruler.after('blockquote', 'math_block', mathBlockDollar, blockOpts);
  md.block.ruler.after('blockquote', 'math_block_bracket', mathBlockBracket, blockOpts);
}

export default markdownItMath;
