import Foundation
import PDFKit
import UIKit
import Vision

@objc(PDFExtractorModule)
class PDFExtractorModule: NSObject {

  // Pages whose text layer yields fewer characters than this are treated as
  // scanned/image pages and run through OCR instead.
  private static let minTextLayerChars = 20
  // OCR is ~0.3-1s per page on-device; cap how many pages we OCR per document.
  private static let maxOcrPages = 50
  // Render scale for OCR input (1.0 = 72 dpi; 2.0 = 144 dpi).
  private static let ocrRenderScale: CGFloat = 2.0

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Run Vision text recognition on an image. Returns recognized lines joined
  /// by newlines, or an empty string when nothing is recognized or OCR fails.
  private func recognizeText(in cgImage: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
      try handler.perform([request])
    } catch {
      print("[PDFExtractor] OCR failed: \(error.localizedDescription)")
      return ""
    }
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: "\n")
  }

  private func renderPageImage(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else { return nil }
    let size = CGSize(
      width: bounds.width * Self.ocrRenderScale,
      height: bounds.height * Self.ocrRenderScale
    )
    return page.thumbnail(of: size, for: .mediaBox).cgImage
  }

  /// Extract a page's text layer; when it is near-empty (scanned page), render
  /// the page and fall back to on-device OCR.
  private func extractPageText(_ page: PDFPage, ocrPagesUsed: inout Int) -> String {
    let textLayer = page.string ?? ""
    let trimmed = textLayer.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count >= Self.minTextLayerChars {
      return textLayer
    }
    guard ocrPagesUsed < Self.maxOcrPages, let image = renderPageImage(page) else {
      return textLayer
    }
    ocrPagesUsed += 1
    let ocrText = recognizeText(in: image)
    return ocrText.count > textLayer.count ? ocrText : textLayer
  }

  @objc
  // swiftlint:disable:next cyclomatic_complexity
  func extractText(_ filePath: String, maxChars: Double, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      print("[PDFExtractor] Received filePath: \(filePath)")

      // Parse the file path as a URL
      var url: URL?
      if filePath.hasPrefix("file://") {
        url = URL(string: filePath)
      } else {
        url = URL(fileURLWithPath: filePath)
      }

      guard let url = url else {
        reject("PDF_ERROR", "Invalid file path: \(filePath)", nil as NSError?)
        return
      }

      print("[PDFExtractor] Parsed URL: \(url.path)")
      print("[PDFExtractor] URL scheme: \(url.scheme ?? "none")")

      // For security-scoped resources (files from document picker), we need to request access
      let didStartAccessing = url.startAccessingSecurityScopedResource()
      print("[PDFExtractor] Security-scoped access: \(didStartAccessing)")

      // Check if file exists
      let fileManager = FileManager.default
      var isDirectory: ObjCBool = false
      let exists = fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory)
      print("[PDFExtractor] File exists: \(exists), isDirectory: \(isDirectory.boolValue)")

      if !exists {
        // Try alternate path without file:// prefix components
        let alternatePath = url.path
        let alternateExists = fileManager.fileExists(atPath: alternatePath, isDirectory: &isDirectory)
        print("[PDFExtractor] Alternate path exists: \(alternateExists)")
      }

      defer {
        if didStartAccessing {
          url.stopAccessingSecurityScopedResource()
        }
      }

      // Check if file is readable
      let isReadable = fileManager.isReadableFile(atPath: url.path)
      print("[PDFExtractor] File is readable: \(isReadable)")

      // Attempt to open the PDF document
      guard let document = PDFDocument(url: url) else {
        // Try to get more specific error info
        let pathExtension = url.pathExtension.lowercased()
        var errorMessage = "Could not open PDF file"

        if !exists {
          errorMessage = "File does not exist at path: \(url.path)"
        } else if !isReadable {
          errorMessage = "File is not readable (permission denied): \(url.path)"
        } else if pathExtension != "pdf" {
          errorMessage = "File extension '\(pathExtension)' is not PDF"
        } else {
          // File exists and is readable but PDFKit couldn't open it
          // Try to read first few bytes to verify it's a PDF
          do {
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            let firstBytes = data.prefix(8)
            let header = firstBytes.map { String(format: "%02X", $0) }.joined(separator: " ")
            print("[PDFExtractor] File header (hex): \(header)")

            if data.count < 5 {
              errorMessage = "File is too small to be a valid PDF: \(data.count) bytes"
            } else if let asciiData = "%PDF-".data(using: .ascii), !data.prefix(5).elementsEqual(asciiData) {
              errorMessage = "File does not have valid PDF header. Got: \(header)"
            } else {
              errorMessage = "PDFKit could not parse the PDF file. File size: \(data.count) bytes"
            }
          } catch {
            errorMessage = "Could not read file data: \(error.localizedDescription)"
          }
        }

        print("[PDFExtractor] Error: \(errorMessage)")
        reject("PDF_ERROR", errorMessage, nil as NSError?)
        return
      }

      print("[PDFExtractor] Successfully opened PDF with \(document.pageCount) pages")

      let limit = Int(maxChars)
      var fullText = ""
      var ocrPagesUsed = 0
      for pageIndex in 0..<document.pageCount {
        if let page = document.page(at: pageIndex) {
          fullText += self.extractPageText(page, ocrPagesUsed: &ocrPagesUsed)
          if pageIndex < document.pageCount - 1 {
            fullText += "\n\n"
          }
        }

        if fullText.count >= limit {
          fullText = String(fullText.prefix(limit))
          fullText += "\n\n... [Extracted \(pageIndex + 1) of \(document.pageCount) pages]"
          break
        }
      }

      if ocrPagesUsed > 0 {
        print("[PDFExtractor] OCR fallback used on \(ocrPagesUsed) pages")
      }
      print("[PDFExtractor] Extracted \(fullText.count) characters")
      resolve(fullText)
    }
  }

  @objc
  func recognizeImage(_ filePath: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let path: String
      if filePath.hasPrefix("file://"), let url = URL(string: filePath) {
        path = url.path
      } else {
        path = filePath
      }

      guard let image = UIImage(contentsOfFile: path), let cgImage = image.cgImage else {
        reject("OCR_ERROR", "Could not load image at path: \(path)", nil as NSError?)
        return
      }

      resolve(self.recognizeText(in: cgImage))
    }
  }
}
