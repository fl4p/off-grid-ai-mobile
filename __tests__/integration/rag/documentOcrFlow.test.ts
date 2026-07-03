/**
 * Integration Tests: Document OCR Flow
 *
 * Tests the integration between:
 * - documentService → pdfExtractor → native PDFExtractorModule (mocked bridge)
 *
 * Unlike the unit tests, the real pdfExtractor wrapper runs here, so this
 * covers the wiring from documentService through the TS service layer down to
 * the native module boundary for PDFs (with OCR fallback inside the native
 * side) and standalone image OCR.
 */

import { NativeModules } from 'react-native';

const mockExtractText = jest.fn();
const mockRecognizeImage = jest.fn();

describe('Document OCR Flow Integration', () => {
  let documentService: typeof import('../../../src/services/documentService').documentService;
  let mockedRNFS: jest.Mocked<typeof import('react-native-fs')>;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    NativeModules.PDFExtractorModule = {
      extractText: mockExtractText,
      recognizeImage: mockRecognizeImage,
    };
    // Re-require after resetModules so the real pdfExtractor singleton binds to
    // the mocked bridge and we configure the same RNFS mock instance the
    // service sees.
    mockedRNFS = require('react-native-fs');
    documentService = require('../../../src/services/documentService').documentService;

    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: 2048, isFile: () => true } as any);
    mockedRNFS.copyFile.mockResolvedValue(undefined as any);
    mockedRNFS.mkdir.mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    delete NativeModules.PDFExtractorModule;
  });

  it('extracts scanned-PDF text through the native extractor (OCR happens native-side)', async () => {
    // A scanned PDF returns OCR text from the native module transparently —
    // the JS layers cannot tell whether the text layer or OCR produced it.
    mockExtractText.mockResolvedValue('OCR recovered page text');

    const result = await documentService.processDocumentFromPath('/docs/scanned.pdf');

    expect(mockExtractText).toHaveBeenCalledWith('/docs/scanned.pdf', expect.any(Number));
    expect(result!.type).toBe('document');
    expect(result!.textContent).toBe('OCR recovered page text');
  });

  it('routes image attachments to native OCR and returns a document attachment', async () => {
    mockRecognizeImage.mockResolvedValue('Meeting notes\nAction items: ship OCR');

    const result = await documentService.processDocumentFromPath('/photos/whiteboard.jpg');

    expect(mockRecognizeImage).toHaveBeenCalledWith('/photos/whiteboard.jpg');
    expect(result!.type).toBe('document');
    expect(result!.fileName).toBe('whiteboard.jpg');
    expect(result!.textContent).toContain('Action items: ship OCR');
  });

  it('formats OCR output for LLM context like any other document', async () => {
    mockRecognizeImage.mockResolvedValue('Receipt: coffee 3.50');

    const attachment = await documentService.processDocumentFromPath('/photos/receipt.png');
    const context = documentService.formatForContext(attachment!);

    expect(context).toContain('**Attached Document: receipt.png**');
    expect(context).toContain('Receipt: coffee 3.50');
  });

  it('reports image extensions as supported only while the bridge exposes recognizeImage', async () => {
    expect(documentService.isSupported('scan.png')).toBe(true);

    // Simulate an older native binary without recognizeImage
    delete (NativeModules.PDFExtractorModule as any).recognizeImage;
    expect(documentService.isSupported('scan.png')).toBe(false);
    await expect(
      documentService.processDocumentFromPath('/photos/scan.png')
    ).rejects.toThrow('Image OCR is not available');
  });

  it('propagates native OCR failures with their original message', async () => {
    mockRecognizeImage.mockRejectedValue(new Error('Could not load image at path: /photos/corrupt.heic'));

    await expect(
      documentService.processDocumentFromPath('/photos/corrupt.heic')
    ).rejects.toThrow('Could not load image');
  });
});
