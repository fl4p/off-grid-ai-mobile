/**
 * Unit: htmlPathFromToolResult — decides whether a write_file/edit_file tool result
 * names an .html file the chat should offer to open in the preview.
 */
import { htmlPathFromToolResult } from '../../../src/components/ChatMessage';

describe('htmlPathFromToolResult', () => {
  it('extracts the path from a new write_file result', () => {
    expect(htmlPathFromToolResult('write_file', 'Wrote 1234 bytes to snake.html (new file)')).toBe('snake.html');
  });

  it('extracts the path from an overwrite write_file result', () => {
    expect(htmlPathFromToolResult('write_file', 'Wrote 42 bytes to games/pong.html (overwrote existing)')).toBe('games/pong.html');
  });

  it('handles a path with spaces', () => {
    expect(htmlPathFromToolResult('write_file', 'Wrote 5 bytes to my game.html (new file)')).toBe('my game.html');
  });

  it('accepts the .htm extension', () => {
    expect(htmlPathFromToolResult('write_file', 'Wrote 5 bytes to page.htm (new file)')).toBe('page.htm');
  });

  it('extracts the path from an edit_file result', () => {
    expect(htmlPathFromToolResult('edit_file', 'Made 2 replacements in index.html')).toBe('index.html');
  });

  it('returns null for a non-html file', () => {
    expect(htmlPathFromToolResult('write_file', 'Wrote 10 bytes to script.py (new file)')).toBeNull();
  });

  it('returns null for other tools', () => {
    expect(htmlPathFromToolResult('read_file', 'index.html (3 lines)')).toBeNull();
    expect(htmlPathFromToolResult('run_python', 'done')).toBeNull();
  });

  it('is case-insensitive on the extension', () => {
    expect(htmlPathFromToolResult('write_file', 'Wrote 5 bytes to Game.HTML (new file)')).toBe('Game.HTML');
  });

  it('returns null for empty or missing content', () => {
    expect(htmlPathFromToolResult('write_file', '')).toBeNull();
    expect(htmlPathFromToolResult('write_file', undefined)).toBeNull();
  });
});
