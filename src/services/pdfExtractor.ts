/**
 * PDFExtractor - TypeScript wrapper for native PDF text extraction modules.
 * Uses PDFKit on iOS (built-in) and PDFium on Android (native C++ via JNI).
 *
 * Scanned pages with no text layer fall back to on-device OCR inside the
 * native module (Vision on iOS, ML Kit on Android). The same OCR engines are
 * exposed for standalone images via recognizeImage().
 */

import { NativeModules } from 'react-native';

const { PDFExtractorModule } = NativeModules;

class PDFExtractor {
  /**
   * Check if the native PDF extraction module is available
   */
  isAvailable(): boolean {
    return PDFExtractorModule != null;
  }

  /**
   * Extract text from a PDF file at the given path.
   * Returns up to maxChars characters of text content.
   */
  async extractText(filePath: string, maxChars: number = 50000): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('PDF extraction is not available on this platform');
    }

    try {
      return await PDFExtractorModule.extractText(filePath, maxChars);
    } catch (error: any) {
      // Guard against NullPointerException when bridge promise is rejected after teardown
      if (error?.message?.includes('NullPointerException') || error?.code === 'BRIDGE_DESTROYED') {
        throw new Error('PDF extraction failed: native bridge unavailable');
      }
      throw error;
    }
  }

  /**
   * Check if standalone image OCR is available (native module built with
   * recognizeImage — older binaries may lack it).
   */
  supportsImageOcr(): boolean {
    return PDFExtractorModule != null && typeof PDFExtractorModule.recognizeImage === 'function';
  }

  /**
   * Run on-device OCR (Vision on iOS, ML Kit on Android) on an image file
   * and return the recognized text.
   */
  async recognizeImage(filePath: string): Promise<string> {
    if (!this.supportsImageOcr()) {
      throw new Error('Image OCR is not available on this platform');
    }

    try {
      return await PDFExtractorModule.recognizeImage(filePath);
    } catch (error: any) {
      if (error?.message?.includes('NullPointerException') || error?.code === 'BRIDGE_DESTROYED') {
        throw new Error('Image OCR failed: native bridge unavailable');
      }
      throw error;
    }
  }
}

export const pdfExtractor = new PDFExtractor();
