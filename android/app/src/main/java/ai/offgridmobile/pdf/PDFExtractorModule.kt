package ai.offgridmobile.pdf

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.ExifInterface
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

        // Cap the longer bitmap side to avoid OOM on huge pages and photos.
        private const val MAX_OCR_BITMAP_DIM = 2048

        private const val OCR_TIMEOUT_SECONDS = 30L
    }

    // Bundled Latin recognizer — runs fully offline, no Play Services required.
    private val recognizerDelegate = lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private val recognizer by recognizerDelegate

    override fun invalidate() {
        // Release the ML Kit native detector on bridge teardown (dev reloads
        // instantiate a fresh module each time).
        if (recognizerDelegate.isInitialized()) {
            runCatching { recognizer.close() }
        }
        super.invalidate()
    }

    private fun safeReject(promise: Promise, code: String, message: String, throwable: Throwable? = null) =
        SafePromise(promise, NAME).reject(code, message, throwable)

    private fun safeResolve(promise: Promise, value: Any?) =
        SafePromise(promise, NAME).resolve(value)

    override fun getName(): String = NAME

    private fun normalizePath(filePath: String): String = filePath.removePrefix("file://")

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

    /**
     * Render a page to a bitmap and OCR it. Returns "" when rendering or OCR
     * fails. Catches Throwable (not just Exception): a decode OOM is an Error
     * and must not escape the module's worker thread, which would kill the
     * whole process.
     *
     * Note: renderPageBitmap exercises pdfium's full rasterizer (font/image
     * decoders) on user-supplied files — a much larger native surface than
     * text extraction. A crash there is native and uncatchable here; keep the
     * pinned pdfium version current with upstream security fixes.
     */
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
            if (width <= 0 || height <= 0) return ""
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(Color.WHITE)
                page.renderPageBitmap(bitmap, 0, 0, width, height)
                return ocrBitmap(InputImage.fromBitmap(bitmap, 0))
            } finally {
                bitmap.recycle()
            }
        } catch (t: Throwable) {
            Log.w(NAME, "Page render for OCR failed: ${t.message}")
            return ""
        } finally {
            page.close()
        }
    }

    /** Decode an image file with the long side capped at MAX_OCR_BITMAP_DIM to avoid OOM. */
    private fun decodeCappedBitmap(path: String): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sampleSize = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_OCR_BITMAP_DIM) {
            sampleSize *= 2
        }
        return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
    }

    /** EXIF rotation for camera photos, since we decode manually instead of using fromFilePath. */
    private fun exifRotationDegrees(path: String): Int = try {
        when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }
    } catch (e: Exception) {
        0
    }

    @ReactMethod
    fun extractText(filePath: String, maxChars: Double, promise: Promise) {
        Thread {
            try {
                val file = File(normalizePath(filePath))
                if (!file.exists()) {
                    safeReject(promise, "PDF_ERROR", "File not found: ${file.path}")
                    return@Thread
                }

                val limit = maxChars.toInt()
                val core = PdfiumCore(reactApplicationContext)
                val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                try {
                    val doc = core.newDocument(fd)
                    try {
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

                        if (ocrPagesUsed > 0) {
                            Log.i(NAME, "OCR fallback used on $ocrPagesUsed pages")
                        }
                        safeResolve(promise, sb.toString())
                    } finally {
                        doc.close()
                    }
                } finally {
                    runCatching { fd.close() }
                }
            } catch (t: Throwable) {
                safeReject(promise, "PDF_ERROR", "Failed to extract text: ${t.message}", t)
            }
        }.start()
    }

    @ReactMethod
    fun recognizeImage(filePath: String, promise: Promise) {
        Thread {
            try {
                val file = File(normalizePath(filePath))
                if (!file.exists()) {
                    safeReject(promise, "OCR_ERROR", "File not found: ${file.path}")
                    return@Thread
                }

                val bitmap = decodeCappedBitmap(file.path)
                if (bitmap == null) {
                    safeReject(promise, "OCR_ERROR", "Could not decode image: ${file.path}")
                    return@Thread
                }
                try {
                    val image = InputImage.fromBitmap(bitmap, exifRotationDegrees(file.path))
                    val text = Tasks.await(recognizer.process(image), OCR_TIMEOUT_SECONDS, TimeUnit.SECONDS).text
                    safeResolve(promise, text)
                } finally {
                    bitmap.recycle()
                }
            } catch (t: Throwable) {
                safeReject(promise, "OCR_ERROR", "Failed to recognize image: ${t.message}", t)
            }
        }.start()
    }
}
