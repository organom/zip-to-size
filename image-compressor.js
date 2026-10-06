import { Archive } from './libarchive.js';
import { t } from './i18n.js';
import {
    CONFIG,
    BYTES_PER_MB,
    ARCHIVE_EXTENSIONS,
    MIME_TYPES,
    IMAGE_EXTENSIONS,
    isSupportedArchive,
    isIgnoredPath,
    outputFileName,
    formatFileSize,
    targetImageBytes,
    initialRatio,
    nextRatio,
    perFileRatio,
    exportQuality,
    iterationProgress,
    isWithinTarget,
    hasStagnated,
    trackBestResult,
    clampDimensions,
} from './compression.js';

Archive.init({ workerUrl: './worker-bundle.js' });

function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

export class ImageCompressor {
    sourceZip = null;
    imageFiles = [];
    totalImages = 0;
    processedImages = 0;
    finalZipBlob = null;
    originalFileSize = 0;
    currentIterationSize = 0;

    constructor() {
        this.el = {
            uploadArea: document.getElementById('uploadArea'),
            fileInput: document.getElementById('fileInput'),
            maxSize: document.getElementById('maxSize'),
            downloadBtn: document.getElementById('downloadBtn'),
            newFileBtn: document.getElementById('newFileBtn'),
            progressText: document.getElementById('progressText'),
            progressPercent: document.getElementById('progressPercent'),
            progressFill: document.getElementById('progressFill'),
            fileName: document.getElementById('fileName'),
            fileSize: document.getElementById('fileSize'),
            originalSize: document.getElementById('originalSize'),
            imagesProcessed: document.getElementById('imagesProcessed'),
            compressedSize: document.getElementById('compressedSize'),
            savingsPercent: document.getElementById('savingsPercent'),
            finalSize: document.getElementById('finalSize'),
            spaceSaved: document.getElementById('spaceSaved'),
            uploadSection: document.getElementById('uploadSection'),
            processingSection: document.getElementById('processingSection'),
            resultSection: document.getElementById('resultSection'),
        };
        this.el.fileInput.accept = ARCHIVE_EXTENSIONS.join(',');
        this.maxSizeMB = Number.parseFloat(this.el.maxSize.value) || 2.5;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.el.uploadArea.addEventListener('click', () => this.el.fileInput.click());
        this.el.uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); this.el.uploadArea.classList.add('dragover'); });
        this.el.uploadArea.addEventListener('dragleave', (e) => { e.preventDefault(); this.el.uploadArea.classList.remove('dragover'); });
        this.el.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.el.uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) this.processFile(file);
        });
        this.el.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.processFile(file);
        });

        this.el.maxSize.addEventListener('change', (e) => {
            const val = Number.parseFloat(e.target.value);
            if (!Number.isNaN(val) && val >= 0.1 && val <= 50) {
                this.maxSizeMB = val;
            } else {
                e.target.value = this.maxSizeMB;
            }
        });

        this.el.downloadBtn.addEventListener('click', this.downloadCompressedZip.bind(this));
        this.el.newFileBtn.addEventListener('click', this.resetApplication.bind(this));
    }

    async processFile(file) {
        const isZip = file.name.toLowerCase().endsWith('.zip');

        if (!isSupportedArchive(file.name)) {
            this.showError(t('errorUnsupported'));
            return;
        }

        try {
            this.showSection('processingSection');
            this.updateProgress(t('loadingArchive'), 0);
            this.outputName = outputFileName(file.name);
            this.originalFileSize = file.size;

            if (isZip) {
                const arrayBuffer = await file.arrayBuffer();
                this.sourceZip = await JSZip.loadAsync(arrayBuffer);
            } else {
                this.sourceZip = await this.loadViaLibarchive(file);
            }

            await this.extractImageFiles();

            if (this.imageFiles.length === 0) {
                this.showError(t('errorNoImages'));
                return;
            }

            this.el.fileName.textContent = file.name;
            this.el.fileSize.textContent = formatFileSize(file.size);
            await this.compressImages();
        } catch (error) {
            console.error('Error processing file:', error);
            this.showError(t('errorProcessing'));
        }
    }

    async loadViaLibarchive(file) {
        this.updateProgress(t('extractingArchive'), CONFIG.PROGRESS.EXTRACTING);
        const archive = await Archive.open(file);
        // extractFiles() extracts all entries and returns nested { path: File } object.
        // getFilesArray() then flattens it to [{ file: File, path: "dir/" }].
        // Must call extractFiles() first so entries are File objects, not ArchiveReader stubs.
        await archive.extractFiles();
        const entries = await archive.getFilesArray();
        const zip = new JSZip();

        await Promise.all(entries.map(async ({ file: entry, path }) => {
            if (entry instanceof File) {
                zip.file(path + entry.name, await entry.arrayBuffer());
            }
        }));

        return zip;
    }

    get totalOriginalSize() {
        return this.imageFiles.reduce((sum, img) => sum + img.originalSize, 0);
    }

    generateZipBlob(zip, level) {
        return zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level },
        });
    }

    showSection(name) {
        for (const section of ['uploadSection', 'processingSection', 'resultSection']) {
            this.el[section].style.display = section === name ? 'block' : 'none';
        }
    }

    async extractImageFiles() {
        this.imageFiles = [];

        for (const [filename, zipEntry] of Object.entries(this.sourceZip.files)) {
            if (zipEntry.dir || isIgnoredPath(filename)) {
                continue;
            }

            const dotIndex = filename.lastIndexOf('.');
            if (dotIndex === -1) continue;
            const extension = filename.toLowerCase().substring(dotIndex);
            if (!IMAGE_EXTENSIONS.has(extension)) {
                continue;
            }

            try {
                const arrayBuffer = await zipEntry.async('arraybuffer');
                this.imageFiles.push({
                    name: filename,
                    originalData: arrayBuffer,
                    extension: extension,
                    originalSize: arrayBuffer.byteLength,
                });
            } catch (error) {
                console.warn(`Failed to extract ${filename}:`, error);
            }
        }

        this.totalImages = this.imageFiles.length;
        this.updateStats();
    }

    async trySkipCompression(targetZipSizeBytes) {
        if (this.totalOriginalSize > targetImageBytes(targetZipSizeBytes)) return false;

        const finalBlob = await this.generateZipBlob(this.sourceZip, CONFIG.ZIP_FINAL_LEVEL);

        if (finalBlob.size > targetZipSizeBytes) return false;

        this.finalZipBlob = finalBlob;
        this.processedImages = this.totalImages;
        this.updateProgress(t('complete'), CONFIG.PROGRESS.COMPLETE);
        this.updateStats();
        this.showResults(finalBlob.size);
        return true;
    }

    async runCompressionIteration(compressionRatio, iteration) {
        const ratio = Math.max(compressionRatio, CONFIG.MIN_COMPRESSION_RATIO);

        this.updateProgress(t('compressionIteration', iteration + 1), iterationProgress(iteration));

        console.log(`Iteration ${iteration + 1}: ratio=${ratio.toFixed(3)}`);

        const compressedImages = await this.compressAllImages(ratio);
        const testZip = new JSZip();
        for (const img of compressedImages) testZip.file(img.name, img.data);

        const zipBlob = await this.generateZipBlob(testZip, CONFIG.ZIP_TEST_LEVEL);

        console.log(`Iteration ${iteration + 1}: ZIP size ${(zipBlob.size / BYTES_PER_MB).toFixed(2)} MB`);
        this.currentIterationSize = zipBlob.size;
        this.updateStats();
        return { testZip, zipSize: zipBlob.size };
    }

    async findBestZip(targetZipSizeBytes) {
        let compressionRatio = initialRatio(targetZipSizeBytes, this.totalOriginalSize);
        let best = { zip: null, size: Infinity };

        let consecutiveFailures = 0;
        let prevSize = Infinity;
        let stagnationCount = 0;
        for (let iteration = 0; iteration < CONFIG.MAX_ITERATIONS; iteration++) {
            let result;
            try {
                result = await this.runCompressionIteration(compressionRatio, iteration);
                consecutiveFailures = 0;
            } catch (error) {
                console.error(`Failed ZIP generation in iteration ${iteration + 1}:`, error);
                consecutiveFailures++;
                if (consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) break;
                compressionRatio *= CONFIG.RATIO_DECREASE;
                continue;
            }

            best = trackBestResult(result.testZip, result.zipSize, targetZipSizeBytes, best.zip, best.size);

            if (isWithinTarget(result.zipSize, targetZipSizeBytes)) break;

            stagnationCount = hasStagnated(result.zipSize, prevSize) ? stagnationCount + 1 : 0;
            if (stagnationCount >= CONFIG.MAX_STAGNANT_ITERATIONS) break;
            prevSize = result.zipSize;

            compressionRatio = nextRatio(compressionRatio, result.zipSize, targetZipSizeBytes);
        }

        if (!best.zip) throw new Error('Failed to create compressed ZIP');
        return best.zip;
    }

    async compressImages() {
        this.updateProgress(t('analyzingImages'), CONFIG.PROGRESS.ANALYZING);

        const targetZipSizeBytes = this.maxSizeMB * BYTES_PER_MB;

        if (await this.trySkipCompression(targetZipSizeBytes)) return;

        const bestZip = await this.findBestZip(targetZipSizeBytes);

        this.updateProgress(t('finalizing'), CONFIG.PROGRESS.FINALIZING);

        const finalBlob = await this.generateZipBlob(bestZip, CONFIG.ZIP_FINAL_LEVEL);
        this.finalZipBlob = finalBlob;

        console.log(`Final ZIP size: ${(finalBlob.size / BYTES_PER_MB).toFixed(2)} MB`);

        this.updateProgress(t('complete'), CONFIG.PROGRESS.COMPLETE);
        this.updateStats();
        this.showResults(finalBlob.size);
    }

    async compressAllImages(ratio) {
        const compressedImages = [];
        this.processedImages = 0;

        const avgSize = this.totalOriginalSize / this.imageFiles.length;

        for (const imageFile of this.imageFiles) {
            try {
                const compressedData = await this.compressImage(imageFile, perFileRatio(ratio, avgSize, imageFile.originalSize));
                compressedImages.push({ name: imageFile.name, data: compressedData });
            } catch (error) {
                console.error(`Failed to compress ${imageFile.name}:`, error);
                compressedImages.push({ name: imageFile.name, data: new Blob([imageFile.originalData]) });
            }

            this.processedImages++;
            this.updateStats();
        }

        return compressedImages;
    }

    renderToBlob(img, imageFile, compressionRatio) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const scale = Math.sqrt(compressionRatio);
        const { w, h } = clampDimensions(Math.floor(img.width * scale), Math.floor(img.height * scale));

        canvas.width = w;
        canvas.height = h;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        const mimeType = MIME_TYPES[imageFile.extension] || 'image/jpeg';
        return canvasToBlob(canvas, mimeType, exportQuality(mimeType, compressionRatio));
    }

    compressImage(imageFile, compressionRatio) {
        return new Promise((resolve) => {
            let settled = false;
            let blobUrl = null;
            let timeoutId = null;

            const settle = (blob) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                if (blobUrl) URL.revokeObjectURL(blobUrl);
                resolve(blob);
            };

            const fallback = () => settle(new Blob([imageFile.originalData]));

            timeoutId = setTimeout(() => {
                console.warn(`Timeout processing ${imageFile.name}, using original`);
                fallback();
            }, CONFIG.IMAGE_TIMEOUT_MS);

            try {
                blobUrl = URL.createObjectURL(new Blob([imageFile.originalData]));
            } catch (error) {
                console.error(`Error creating blob URL for ${imageFile.name}:`, error);
                fallback();
                return;
            }

            const img = new Image();
            img.onload = async () => {
                try {
                    const resultBlob = await this.renderToBlob(img, imageFile, compressionRatio);
                    if (resultBlob) {
                        settle(resultBlob);
                    } else {
                        console.warn(`Failed to create blob for ${imageFile.name}, using original`);
                        fallback();
                    }
                } catch (error) {
                    console.error(`Error processing ${imageFile.name}:`, error);
                    fallback();
                }
            };
            img.onerror = () => {
                console.error(`Failed to load image: ${imageFile.name}`);
                fallback();
            };
            img.src = blobUrl;
        });
    }

    updateProgress(text, percent) {
        this.el.progressText.textContent = text;
        this.el.progressPercent.textContent = `${Math.round(percent)}%`;
        this.el.progressFill.style.width = `${percent}%`;
    }

    updateStats() {
        this.el.originalSize.textContent = formatFileSize(this.originalFileSize || this.totalOriginalSize);
        this.el.imagesProcessed.textContent = `${this.processedImages}/${this.totalImages}`;

        const displaySize = this.finalZipBlob?.size ?? this.currentIterationSize;
        if (displaySize > 0) {
            this.el.compressedSize.textContent = formatFileSize(displaySize);
            const base = this.originalFileSize || this.totalOriginalSize;
            const savings = base > 0
                ? ((base - displaySize) / base * 100).toFixed(1)
                : '0.0';
            this.el.savingsPercent.textContent = `${savings}%`;
        }
    }

    showResults(finalSize) {
        const base = this.originalFileSize || this.totalOriginalSize;
        const spaceSaved = base - finalSize;
        const savingsPercent = base > 0
            ? ((spaceSaved / base) * 100).toFixed(1)
            : '0.0';

        this.el.finalSize.textContent = formatFileSize(finalSize);
        this.el.spaceSaved.textContent = spaceSaved >= 0
            ? `${formatFileSize(spaceSaved)} (${savingsPercent}%)`
            : `+${formatFileSize(-spaceSaved)} (${t('zipOverhead')})`;

        this.showSection('resultSection');
    }

    downloadCompressedZip() {
        if (!this.finalZipBlob) return;

        const url = URL.createObjectURL(this.finalZipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.outputName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    resetApplication() {
        this.sourceZip = null;
        this.finalZipBlob = null;
        this.outputName = null;
        this.originalFileSize = 0;
        this.currentIterationSize = 0;
        this.imageFiles = [];
        this.totalImages = 0;
        this.processedImages = 0;

        this.el.fileInput.value = '';
        this.showSection('uploadSection');
    }

    showError(message) {
        console.error('Error:', message);
        alert(message);
        this.resetApplication();
    }
}
