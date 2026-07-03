import { formatSpeed } from '../../../src/utils/formatSpeed';

describe('formatSpeed', () => {
  it('returns empty string for zero or negative', () => {
    expect(formatSpeed(0)).toBe('');
    expect(formatSpeed(-1)).toBe('');
  });

  it('formats bytes per second', () => {
    expect(formatSpeed(500)).toBe('500 B/s');
  });

  it('formats kilobytes per second', () => {
    expect(formatSpeed(2048)).toBe('2 KB/s');
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s');
  });

  it('formats megabytes per second', () => {
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s');
    expect(formatSpeed(10 * 1024 * 1024)).toBe('10.0 MB/s');
  });

  it('formats gigabytes per second', () => {
    expect(formatSpeed(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB/s');
    expect(formatSpeed(4 * 1024 * 1024 * 1024)).toBe('4.00 GB/s');
  });

  it('handles exact unit boundaries', () => {
    expect(formatSpeed(1024)).toBe('1 KB/s');
    expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s');
    expect(formatSpeed(1024 * 1024 * 1024)).toBe('1.00 GB/s');
  });
});
