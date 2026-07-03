/**
 * PDFExtractor Unit Tests
 *
 * Tests for the TypeScript wrapper around native PDF extraction modules.
 */

import { NativeModules } from 'react-native';

// Test when native module is NOT available
describe('PDFExtractor (no native module)', () => {
  beforeEach(() => {
    jest.resetModules();
    // Ensure PDFExtractorModule is undefined
    delete NativeModules.PDFExtractorModule;
  });

  it('isAvailable returns false when native module is missing', () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    expect(pdfExtractor.isAvailable()).toBe(false);
  });

  it('extractText throws when native module is missing', async () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    await expect(
      pdfExtractor.extractText('/path/to/file.pdf')
    ).rejects.toThrow('PDF extraction is not available');
  });

  it('supportsImageOcr returns false when native module is missing', () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    expect(pdfExtractor.supportsImageOcr()).toBe(false);
  });

  it('recognizeImage throws when native module is missing', async () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    await expect(
      pdfExtractor.recognizeImage('/path/to/scan.png')
    ).rejects.toThrow('Image OCR is not available');
  });
});

// Test when native module exists but predates recognizeImage (older binary)
describe('PDFExtractor (native module without recognizeImage)', () => {
  beforeEach(() => {
    jest.resetModules();
    NativeModules.PDFExtractorModule = {
      extractText: jest.fn(),
    };
  });

  afterEach(() => {
    delete NativeModules.PDFExtractorModule;
  });

  it('supportsImageOcr returns false', () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    expect(pdfExtractor.supportsImageOcr()).toBe(false);
  });

  it('recognizeImage throws', async () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    await expect(
      pdfExtractor.recognizeImage('/path/to/scan.png')
    ).rejects.toThrow('Image OCR is not available');
  });
});

// Test when native module IS available
describe('PDFExtractor (with native module)', () => {
  const mockExtractText = jest.fn();
  const mockRecognizeImage = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    NativeModules.PDFExtractorModule = {
      extractText: mockExtractText,
      recognizeImage: mockRecognizeImage,
    };
    mockExtractText.mockReset();
    mockRecognizeImage.mockReset();
  });

  afterEach(() => {
    delete NativeModules.PDFExtractorModule;
  });

  it('isAvailable returns true when native module exists', () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    expect(pdfExtractor.isAvailable()).toBe(true);
  });

  it('extractText calls native module and returns text', async () => {
    mockExtractText.mockResolvedValue('Page 1 content\n\nPage 2 content');

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    const result = await pdfExtractor.extractText('/path/to/file.pdf');

    expect(mockExtractText).toHaveBeenCalledWith('/path/to/file.pdf', 50000);
    expect(result).toBe('Page 1 content\n\nPage 2 content');
  });

  it('extractText propagates native module errors', async () => {
    mockExtractText.mockRejectedValue(new Error('Could not open PDF file'));

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    await expect(
      pdfExtractor.extractText('/path/to/corrupt.pdf')
    ).rejects.toThrow('Could not open PDF file');
  });

  it('extractText handles empty PDF', async () => {
    mockExtractText.mockResolvedValue('');

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    const result = await pdfExtractor.extractText('/path/to/empty.pdf');

    expect(result).toBe('');
  });

  it('supportsImageOcr returns true when recognizeImage exists', () => {
    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    expect(pdfExtractor.supportsImageOcr()).toBe(true);
  });

  it('recognizeImage calls native module and returns text', async () => {
    mockRecognizeImage.mockResolvedValue('Text found in scan');

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    const result = await pdfExtractor.recognizeImage('/path/to/scan.png');

    expect(mockRecognizeImage).toHaveBeenCalledWith('/path/to/scan.png');
    expect(result).toBe('Text found in scan');
  });

  it('recognizeImage propagates native module errors', async () => {
    mockRecognizeImage.mockRejectedValue(new Error('Could not load image'));

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    await expect(
      pdfExtractor.recognizeImage('/path/to/broken.png')
    ).rejects.toThrow('Could not load image');
  });

  it('recognizeImage maps bridge teardown errors to a clear message', async () => {
    mockRecognizeImage.mockRejectedValue(new Error('NullPointerException in bridge'));

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    await expect(
      pdfExtractor.recognizeImage('/path/to/scan.png')
    ).rejects.toThrow('Image OCR failed: native bridge unavailable');
  });

  it('recognizeImage handles image with no text', async () => {
    mockRecognizeImage.mockResolvedValue('');

    const { pdfExtractor } = require('../../../src/services/pdfExtractor');
    const result = await pdfExtractor.recognizeImage('/path/to/photo.jpg');

    expect(result).toBe('');
  });
});
