// Compression algorithm constants
export const CONFIG = {
    ZIP_OVERHEAD_FACTOR: 0.15,
    MIN_COMPRESSION_RATIO: 0.05,
    QUALITY_MIN: 0.1,
    QUALITY_MAX: 0.95,
    QUALITY_MULTIPLIER: 1.2,
    MIN_DIMENSION: 50,
    MAX_DIMENSION: 2048,
    IMAGE_TIMEOUT_MS: 10000,
    // Convergence: if result is within this range of target, accept it
    ACCEPTABLE_LOW: 0.8,   // 80% of target
    ACCEPTABLE_HIGH: 1.0,  // 100% of target
    // Ratio adjustments per iteration
    RATIO_DECREASE: 0.85,  // compress more aggressively when over target
    RATIO_INCREASE: 1.1,   // compress less when far under target
    // ZIP compression levels
    ZIP_TEST_LEVEL: 6,
    ZIP_FINAL_LEVEL: 9,
    MAX_ITERATIONS: 50,
    STAGNATION_THRESHOLD: 0.001,
    MAX_STAGNANT_ITERATIONS: 3,
    MAX_CONSECUTIVE_FAILURES: 3,
    PROGRESS: {
        EXTRACTING: 2,
        ANALYZING: 5,
        ITERATION_START: 10,
        ITERATION_STEP: 8,
        ITERATION_MAX: 80,
        FINALIZING: 90,
        COMPLETE: 100,
    },
};

export const BYTES_PER_MB = 1024 * 1024;

export const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tar.gz', '.tar.bz2', '.tar.xz'];

// Map extensions to their correct MIME types for canvas export
export const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    // GIF and BMP are not supported by canvas.toBlob — fall back to PNG
    '.gif': 'image/png',
    '.bmp': 'image/png',
};

export const IMAGE_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

// Formats that support a quality parameter in canvas.toBlob
export const QUALITY_FORMATS = new Set(['image/jpeg', 'image/webp']);

export function isSupportedArchive(fileName) {
    const name = fileName.toLowerCase();
    return ARCHIVE_EXTENSIONS.some(ext => name.endsWith(ext));
}

export function isIgnoredPath(filename) {
    const parts = filename.split('/');
    return parts.some(part => part === '__MACOSX' || part.startsWith('.'));
}

export function outputFileName(inputName) {
    const dot = inputName.lastIndexOf('.');
    const base = dot === -1 ? inputName : inputName.substring(0, dot);
    return `${base}-compressed.zip`;
}

export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function targetImageBytes(targetZipSizeBytes) {
    return targetZipSizeBytes * (1 - CONFIG.ZIP_OVERHEAD_FACTOR);
}

export function initialRatio(targetZipSizeBytes, totalOriginalSize) {
    return totalOriginalSize > 0
        ? targetImageBytes(targetZipSizeBytes) / totalOriginalSize
        : CONFIG.MIN_COMPRESSION_RATIO;
}

export function nextRatio(ratio, zipSize, targetZipSizeBytes) {
    return zipSize > targetZipSizeBytes
        ? ratio * CONFIG.RATIO_DECREASE
        : ratio * CONFIG.RATIO_INCREASE;
}

// Files larger than average get a more aggressive per-file ratio so they
// shrink toward the average first; smaller files get a gentler ratio.
// Once sizes are roughly equal the per-file ratio converges to the global one.
export function perFileRatio(ratio, avgSize, originalSize) {
    const sizeRatio = avgSize / originalSize; // < 1 for big files, > 1 for small
    return Math.min(ratio, ratio * sizeRatio);
}

export function exportQuality(mimeType, ratio) {
    return QUALITY_FORMATS.has(mimeType)
        ? Math.max(CONFIG.QUALITY_MIN, Math.min(CONFIG.QUALITY_MAX, ratio * CONFIG.QUALITY_MULTIPLIER))
        : undefined;
}

export function iterationProgress(iteration) {
    const { ITERATION_START, ITERATION_STEP, ITERATION_MAX } = CONFIG.PROGRESS;
    return Math.min(ITERATION_START + iteration * ITERATION_STEP, ITERATION_MAX);
}

export function isWithinTarget(zipSize, targetZipSizeBytes) {
    const relativeSize = zipSize / targetZipSizeBytes;
    return relativeSize >= CONFIG.ACCEPTABLE_LOW && relativeSize <= CONFIG.ACCEPTABLE_HIGH;
}

// Size stopped changing (oscillation / floor reached)
export function hasStagnated(zipSize, prevSize) {
    return Math.abs(zipSize - prevSize) / Math.max(prevSize, 1) < CONFIG.STAGNATION_THRESHOLD;
}

export function trackBestResult(testZip, currentZipSize, targetZipSizeBytes, bestZip, bestSize) {
    const underTarget = currentZipSize <= targetZipSizeBytes;
    const bestUnderTarget = bestSize <= targetZipSizeBytes;

    // Prefer the largest result that fits under target
    if (underTarget && (!bestUnderTarget || currentZipSize > bestSize)) {
        return { zip: testZip, size: currentZipSize };
    }
    // If nothing fits yet, prefer the smallest over-target result
    if (!bestUnderTarget && !underTarget && currentZipSize < bestSize) {
        return { zip: testZip, size: currentZipSize };
    }
    return { zip: bestZip, size: bestSize };
}

export function clampDimensions(width, height) {
    const aspect = width / height;
    if (width > CONFIG.MAX_DIMENSION || height > CONFIG.MAX_DIMENSION) {
        return aspect > 1
            ? { w: CONFIG.MAX_DIMENSION, h: Math.floor(CONFIG.MAX_DIMENSION / aspect) }
            : { w: Math.floor(CONFIG.MAX_DIMENSION * aspect), h: CONFIG.MAX_DIMENSION };
    }
    if (width < CONFIG.MIN_DIMENSION || height < CONFIG.MIN_DIMENSION) {
        return aspect > 1
            ? { w: Math.floor(CONFIG.MIN_DIMENSION * aspect), h: CONFIG.MIN_DIMENSION }
            : { w: CONFIG.MIN_DIMENSION, h: Math.floor(CONFIG.MIN_DIMENSION / aspect) };
    }
    return { w: width, h: height };
}
