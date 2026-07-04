package ai.offgridmobile.pdf

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
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
import com.google.mlkit.vision.text.TextRecognizer
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
    // Lifecycle is guarded by recognizerLock: OCR workers register in-flight
    // use so invalidate() (bridge teardown, dev reloads) never closes the
    // native detector under an active Tasks.await — that would race close()
    // against process() across the JNI boundary.
    private val recognizerLock = Any()
    private var recognizerInstance: TextRecognizer? = null
    private var ocrInFlight = 0
    private var recognizerShutDown = false

    /** Returns null once the module has been invalidated. Pair with releaseRecognizer(). */
    private fun acquireRecognizer(): TextRecognizer? = synchronized(recognizerLock) {
        if (recognizerShutDown) return null
        val instance = recognizerInstance
            ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { recognizerInstance = it }
        ocrInFlight++
        instance
    }

    private fun releaseRecognizer() {
        synchronized(recognizerLock) {
            ocrInFlight--
            if (recognizerShutDown && ocrInFlight == 0) closeRecognizerLocked()
        }
    }

    private fun closeRecognizerLocked() {
        recognizerInstance?.let { instance ->
            runCatching { instance.close() }
                .onFailure { Log.w(NAME, "recognizer.close failed: ${it.message}") }
        }
        recognizerInstance = null
    }

    override fun invalidate() {
        synchronized(recognizerLock) {
            recognizerShutDown = true
            // With workers in flight, the last releaseRecognizer() closes it.
            if (ocrInFlight == 0) closeRecognizerLocked()
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

    private fun ocrBitmap(image: InputImage): String {
        val recognizer = acquireRecognizer() ?: return ""
        return try {
            Tasks.await(recognizer.process(image), OCR_TIMEOUT_SECONDS, TimeUnit.SECONDS).text
        } catch (e: Exception) {
            Log.w(NAME, "OCR failed: ${e.message}")
            ""
        } finally {
            releaseRecognizer()
        }
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

    /**
     * Apply the full EXIF orientation (rotation AND mirroring) to a decoded
     * bitmap, since we decode manually instead of using fromFilePath and
     * InputImage's rotationDegrees cannot express the mirrored orientations
     * (tags 2/4/5/7). Recycles the input when a transform is applied.
     */
    private fun applyExifOrientation(bitmap: Bitmap, path: String): Bitmap {
        val orientation = try {
            ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (e: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            else -> return bitmap
        }
        val transformed = try {
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (t: Throwable) {
            Log.w(NAME, "EXIF transform failed, using untransformed bitmap: ${t.message}")
            return bitmap
        }
        if (transformed != bitmap) bitmap.recycle()
        return transformed
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
                        // Failures here land after safeResolve (which no-ops a
                        // second settle) — log so they are not invisible.
                        runCatching { doc.close() }
                            .onFailure { Log.w(NAME, "doc.close failed: ${it.message}") }
                    }
                } finally {
                    runCatching { fd.close() }
                        .onFailure { Log.w(NAME, "fd.close failed: ${it.message}") }
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

                val decoded = decodeCappedBitmap(file.path)
                if (decoded == null) {
                    safeReject(promise, "OCR_ERROR", "Could not decode image: ${file.path}")
                    return@Thread
                }
                val bitmap = applyExifOrientation(decoded, file.path)
                try {
                    val recognizer = acquireRecognizer()
                    if (recognizer == null) {
                        safeReject(promise, "OCR_ERROR", "OCR engine has been shut down")
                        return@Thread
                    }
                    val text = try {
                        Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), OCR_TIMEOUT_SECONDS, TimeUnit.SECONDS).text
                    } finally {
                        releaseRecognizer()
                    }
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
