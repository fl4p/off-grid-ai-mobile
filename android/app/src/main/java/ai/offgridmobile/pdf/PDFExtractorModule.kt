package ai.offgridmobile.pdf

import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import ai.offgridmobile.SafePromise
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfiumCore
import java.io.File
import java.util.concurrent.TimeUnit

class PDFExtractorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val NAME = "PDFExtractorModule"

        // Pages whose text layer yields fewer characters than this are treated
        // as scanned/image pages and run through OCR instead.
        private const val MIN_TEXT_LAYER_CHARS = 20

        // OCR is slow per page on-device; cap how many pages we OCR per document.
        private const val MAX_OCR_PAGES = 50

        // Render scale for OCR input (1 = 72 dpi points; 2 = 144 dpi).
        private const val OCR_RENDER_SCALE = 2

        // Cap the longer bitmap side to avoid OOM on huge page sizes.
        private const val MAX_OCR_BITMAP_DIM = 2048

        private const val OCR_TIMEOUT_SECONDS = 30L
    }

    // Bundled Latin recognizer — runs fully offline, no Play Services required.
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    private fun safeReject(promise: Promise, code: String, message: String, throwable: Throwable? = null) =
        SafePromise(promise, NAME).reject(code, message, throwable)

    private fun safeResolve(promise: Promise, value: Any?) =
        SafePromise(promise, NAME).resolve(value)

    override fun getName(): String = NAME

    private fun extractPageTextLayer(doc: PdfDocument, pageIndex: Int): String {
        val page = doc.openPage(pageIndex)
        val textPage = page.openTextPage()
        val charCount = textPage.textPageCountChars()
        val text = if (charCount > 0) textPage.textPageGetText(0, charCount) ?: "" else ""
        textPage.close()
        page.close()
        return text
    }

    private fun ocrBitmap(image: InputImage): String = try {
        Tasks.await(recognizer.process(image), OCR_TIMEOUT_SECONDS, TimeUnit.SECONDS).text
    } catch (e: Exception) {
        Log.w(NAME, "OCR failed: ${e.message}")
        ""
    }

    /** Render a page to a bitmap and OCR it. Returns "" when rendering or OCR fails. */
    private fun ocrPage(doc: PdfDocument, pageIndex: Int): String {
        val page = doc.openPage(pageIndex)
        try {
            var width = page.getPageWidthPoint() * OCR_RENDER_SCALE
            var height = page.getPageHeightPoint() * OCR_RENDER_SCALE
            if (width <= 0 || height <= 0) return ""
            val maxDim = maxOf(width, height)
            if (maxDim > MAX_OCR_BITMAP_DIM) {
                width = width * MAX_OCR_BITMAP_DIM / maxDim
                height = height * MAX_OCR_BITMAP_DIM / maxDim
            }
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(Color.WHITE)
                page.renderPageBitmap(bitmap, 0, 0, width, height)
                return ocrBitmap(InputImage.fromBitmap(bitmap, 0))
            } finally {
                bitmap.recycle()
            }
        } catch (e: Exception) {
            Log.w(NAME, "Page render for OCR failed: ${e.message}")
            return ""
        } finally {
            page.close()
        }
    }

    @ReactMethod
    fun extractText(filePath: String, maxChars: Double, promise: Promise) {
        Thread {
            try {
                val file = File(filePath)
                if (!file.exists()) {
                    safeReject(promise, "PDF_ERROR", "File not found: $filePath")
                    return@Thread
                }

                val limit = maxChars.toInt()
                val core = PdfiumCore(reactApplicationContext)
                val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val doc = core.newDocument(fd)
                val pageCount = doc.getPageCount()
                val sb = StringBuilder()
                var ocrPagesUsed = 0

                for (i in 0 until pageCount) {
                    var pageText = extractPageTextLayer(doc, i)
                    if (pageText.trim().length < MIN_TEXT_LAYER_CHARS && ocrPagesUsed < MAX_OCR_PAGES) {
                        ocrPagesUsed++
                        val ocrText = ocrPage(doc, i)
                        if (ocrText.length > pageText.length) pageText = ocrText
                    }
                    if (pageText.isNotEmpty()) sb.append(pageText).append("\n\n")

                    if (sb.length >= limit) {
                        sb.setLength(limit)
                        sb.append("\n\n... [Extracted ${i + 1} of $pageCount pages]")
                        break
                    }
                }

                doc.close()
                fd.close()
                if (ocrPagesUsed > 0) {
                    Log.i(NAME, "OCR fallback used on $ocrPagesUsed pages")
                }
                safeResolve(promise, sb.toString())
            } catch (e: Exception) {
                safeReject(promise, "PDF_ERROR", "Failed to extract text: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun recognizeImage(filePath: String, promise: Promise) {
        Thread {
            try {
                val file = File(filePath.removePrefix("file://"))
                if (!file.exists()) {
                    safeReject(promise, "OCR_ERROR", "File not found: ${file.path}")
                    return@Thread
                }

                // fromFilePath handles EXIF rotation for camera photos
                val image = InputImage.fromFilePath(reactApplicationContext, Uri.fromFile(file))
                val text = Tasks.await(recognizer.process(image), OCR_TIMEOUT_SECONDS, TimeUnit.SECONDS).text
                safeResolve(promise, text)
            } catch (e: Exception) {
                safeReject(promise, "OCR_ERROR", "Failed to recognize image: ${e.message}", e)
            }
        }.start()
    }
}
