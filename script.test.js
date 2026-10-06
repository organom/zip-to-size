import JSZip from 'jszip';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    CONFIG,
    MIME_TYPES,
    IMAGE_EXTENSIONS,
    QUALITY_FORMATS,
    formatFileSize,
    isIgnoredPath,
    trackBestResult,
    clampDimensions,
    outputFileName,
    perFileRatio,
    initialRatio,
} from './compression.js';
import { Archive } from './libarchive.js';
import { ImageCompressor } from './image-compressor.js';

vi.mock('./libarchive.js', () => ({ Archive: { init: () => {}, open: vi.fn() } }));
vi.mock('./i18n.js', () => ({ t: (key) => key, setLang: () => {}, getLang: () => 'en' }));

vi.stubGlobal('JSZip', JSZip);
vi.stubGlobal('alert', vi.fn());

const DOM_HTML = `
    <div id="uploadArea"></div>
    <input id="fileInput" type="file" />
    <input id="maxSize" type="number" value="2.5" />
    <button id="downloadBtn"></button>
    <button id="newFileBtn"></button>
    <span id="progressText"></span>
    <span id="progressPercent"></span>
    <div id="progressFill"></div>
    <span id="fileName"></span>
    <span id="fileSize"></span>
    <span id="originalSize"></span>
    <span id="imagesProcessed"></span>
    <span id="compressedSize"></span>
    <span id="savingsPercent"></span>
    <span id="finalSize"></span>
    <span id="spaceSaved"></span>
    <div id="uploadSection"></div>
    <div id="processingSection"></div>
    <div id="resultSection"></div>
`;

function resetDOM(maxSizeMBValue = '2.5') {
    document.body.innerHTML = DOM_HTML;
    document.getElementById('maxSize').value = maxSizeMBValue;
}

function makeCompressor(maxSizeMBValue = '2.5') {
    resetDOM(maxSizeMBValue);
    return new ImageCompressor();
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────

describe('CONFIG', () => {
    it('has sane convergence bounds', () => {
        expect(CONFIG.ACCEPTABLE_LOW).toBeLessThan(CONFIG.ACCEPTABLE_HIGH);
        expect(CONFIG.ACCEPTABLE_LOW).toBeGreaterThan(0);
        expect(CONFIG.ACCEPTABLE_HIGH).toBeLessThanOrEqual(1);
    });

    it('ratio decrease is < 1, ratio increase is > 1', () => {
        expect(CONFIG.RATIO_DECREASE).toBeLessThan(1);
        expect(CONFIG.RATIO_INCREASE).toBeGreaterThan(1);
    });

    it('MIN_DIMENSION is less than MAX_DIMENSION', () => {
        expect(CONFIG.MIN_DIMENSION).toBeLessThan(CONFIG.MAX_DIMENSION);
    });

    it('quality bounds are valid', () => {
        expect(CONFIG.QUALITY_MIN).toBeGreaterThan(0);
        expect(CONFIG.QUALITY_MAX).toBeLessThanOrEqual(1);
        expect(CONFIG.QUALITY_MIN).toBeLessThan(CONFIG.QUALITY_MAX);
    });
});

// ─── MIME_TYPES / IMAGE_EXTENSIONS ──────────────────────────────────────────

describe('MIME_TYPES', () => {
    it('maps jpeg extensions to image/jpeg', () => {
        expect(MIME_TYPES['.jpg']).toBe('image/jpeg');
        expect(MIME_TYPES['.jpeg']).toBe('image/jpeg');
    });

    it('maps gif and bmp to image/png (canvas fallback)', () => {
        expect(MIME_TYPES['.gif']).toBe('image/png');
        expect(MIME_TYPES['.bmp']).toBe('image/png');
    });

    it('IMAGE_EXTENSIONS contains all MIME_TYPES keys', () => {
        for (const ext of Object.keys(MIME_TYPES)) {
            expect(IMAGE_EXTENSIONS.has(ext)).toBe(true);
        }
    });

    it('QUALITY_FORMATS only includes jpeg and webp', () => {
        expect(QUALITY_FORMATS.has('image/jpeg')).toBe(true);
        expect(QUALITY_FORMATS.has('image/webp')).toBe(true);
        expect(QUALITY_FORMATS.has('image/png')).toBe(false);
    });
});

// ─── formatFileSize ──────────────────────────────────────────────────────────

describe('formatFileSize', () => {
    it('returns "0 Bytes" for 0', () => {
        expect(formatFileSize(0)).toBe('0 Bytes');
    });

    it('formats bytes', () => {
        expect(formatFileSize(512)).toBe('512 Bytes');
    });

    it('formats kilobytes', () => {
        expect(formatFileSize(1024)).toBe('1 KB');
    });

    it('formats megabytes', () => {
        expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    });

    it('formats gigabytes', () => {
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('rounds to 2 decimal places', () => {
        expect(formatFileSize(1500)).toBe('1.46 KB');
    });
});

// ─── isIgnoredPath ───────────────────────────────────────────────────────────

describe('isIgnoredPath', () => {
    it('ignores __MACOSX paths', () => {
        expect(isIgnoredPath('__MACOSX/image.jpg')).toBe(true);
    });

    it('ignores dot-prefixed files', () => {
        expect(isIgnoredPath('.DS_Store')).toBe(true);
        expect(isIgnoredPath('folder/.hidden')).toBe(true);
    });

    it('allows normal paths', () => {
        expect(isIgnoredPath('photos/image.jpg')).toBe(false);
        expect(isIgnoredPath('image.png')).toBe(false);
    });
});

// ─── trackBestResult ─────────────────────────────────────────────────────────

describe('trackBestResult', () => {
    const target = 1000;
    const zipA = { id: 'A' };
    const zipB = { id: 'B' };

    it('prefers under-target over over-target', () => {
        const result = trackBestResult(zipA, 900, target, zipB, 1100);
        expect(result.zip).toBe(zipA);
        expect(result.size).toBe(900);
    });

    it('prefers larger under-target when both are under', () => {
        const result = trackBestResult(zipA, 950, target, zipB, 800);
        expect(result.zip).toBe(zipA);
        expect(result.size).toBe(950);
    });

    it('keeps existing best when new is smaller under-target', () => {
        const result = trackBestResult(zipA, 800, target, zipB, 950);
        expect(result.zip).toBe(zipB);
        expect(result.size).toBe(950);
    });

    it('prefers smaller over-target when nothing fits', () => {
        const result = trackBestResult(zipA, 1050, target, zipB, 1200);
        expect(result.zip).toBe(zipA);
        expect(result.size).toBe(1050);
    });

    it('keeps existing best when no improvement over target', () => {
        const result = trackBestResult(zipA, 1200, target, zipB, 1050);
        expect(result.zip).toBe(zipB);
        expect(result.size).toBe(1050);
    });

    it('handles Infinity as initial bestSize (first iteration)', () => {
        const result = trackBestResult(zipA, 1200, target, null, Infinity);
        expect(result.zip).toBe(zipA);
        expect(result.size).toBe(1200);
    });
});

// ─── maxSizeMB input validation ──────────────────────────────────────────────

describe('maxSize input validation', () => {
    it('reads initial value from input', () => {
        const app = makeCompressor('5');
        expect(app.maxSizeMB).toBe(5);
    });

    it('defaults to 2.5 for invalid initial value', () => {
        const app = makeCompressor('abc');
        expect(app.maxSizeMB).toBe(2.5);
    });

    it('updates maxSizeMB on valid change event', () => {
        const app = makeCompressor('2.5');
        const input = document.getElementById('maxSize');
        input.value = '10';
        input.dispatchEvent(new Event('change'));
        expect(app.maxSizeMB).toBe(10);
    });

    it('rejects value below minimum and restores previous', () => {
        const app = makeCompressor('2.5');
        const input = document.getElementById('maxSize');
        input.value = '0.05';
        input.dispatchEvent(new Event('change'));
        expect(app.maxSizeMB).toBe(2.5);
        expect(input.value).toBe('2.5');
    });

    it('rejects value above maximum and restores previous', () => {
        const app = makeCompressor('2.5');
        const input = document.getElementById('maxSize');
        input.value = '100';
        input.dispatchEvent(new Event('change'));
        expect(app.maxSizeMB).toBe(2.5);
        expect(input.value).toBe('2.5');
    });

    it('rejects NaN and restores previous', () => {
        const app = makeCompressor('2.5');
        const input = document.getElementById('maxSize');
        input.value = 'not-a-number';
        input.dispatchEvent(new Event('change'));
        expect(app.maxSizeMB).toBe(2.5);
    });
});

// ─── totalOriginalSize ───────────────────────────────────────────────────────

describe('totalOriginalSize', () => {
    let app;
    beforeEach(() => { app = makeCompressor(); });

    it('returns 0 with no images', () => {
        expect(app.totalOriginalSize).toBe(0);
    });

    it('sums originalSize across all images', () => {
        app.imageFiles = [
            { originalSize: 100 },
            { originalSize: 200 },
            { originalSize: 300 },
        ];
        expect(app.totalOriginalSize).toBe(600);
    });
});

// ─── showSection ─────────────────────────────────────────────────────────────

describe('showSection', () => {
    let app;
    beforeEach(() => { app = makeCompressor(); });

    it('shows the named section and hides others', () => {
        app.showSection('processingSection');
        expect(document.getElementById('processingSection').style.display).toBe('block');
        expect(document.getElementById('uploadSection').style.display).toBe('none');
        expect(document.getElementById('resultSection').style.display).toBe('none');
    });

    it('can switch to resultSection', () => {
        app.showSection('resultSection');
        expect(document.getElementById('resultSection').style.display).toBe('block');
        expect(document.getElementById('uploadSection').style.display).toBe('none');
    });
});

// ─── showResults ─────────────────────────────────────────────────────────────

describe('showResults', () => {
    let app;
    beforeEach(() => { app = makeCompressor(); });

    it('shows space saved as positive when images shrank', () => {
        app.imageFiles = [{ originalSize: 2000 }];
        app.showResults(1000);
        expect(document.getElementById('spaceSaved').textContent).toContain('(50.0%)');
        expect(document.getElementById('spaceSaved').textContent).not.toContain('ZIP overhead');
    });

    it('shows ZIP overhead message when final size exceeds original', () => {
        app.imageFiles = [{ originalSize: 500 }];
        app.showResults(1000);
        expect(document.getElementById('spaceSaved').textContent).toContain('zipOverhead');
    });

    it('handles zero original size without crashing', () => {
        app.imageFiles = [];
        expect(() => app.showResults(0)).not.toThrow();
    });
});

// ─── resetApplication ────────────────────────────────────────────────────────

describe('resetApplication', () => {
    let app;
    beforeEach(() => { app = makeCompressor(); });

    it('clears all state and shows upload section', () => {
        app.imageFiles = [{ originalSize: 100 }];
        app.totalImages = 1;
        app.processedImages = 1;
        app.finalZipBlob = new Blob(['x']);
        app.resetApplication();

        expect(app.imageFiles).toHaveLength(0);
        expect(app.totalImages).toBe(0);
        expect(app.processedImages).toBe(0);
        expect(app.finalZipBlob).toBeNull();
        expect(app.sourceZip).toBeNull();
        expect(document.getElementById('uploadSection').style.display).toBe('block');
    });
});

// ─── processFile ─────────────────────────────────────────────────────────────

describe('processFile', () => {
    let app;
    beforeEach(() => {
        app = makeCompressor();
        vi.spyOn(app, 'showError');
    });

    it('rejects non-ZIP files', async () => {
        const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
        await app.processFile(file);
        expect(app.showError).toHaveBeenCalledWith('errorUnsupported');
    });
});

// ─── clampDimensions ─────────────────────────────────────────────────────────

describe('clampDimensions', () => {
    it('keeps dimensions within bounds unchanged', () => {
        expect(clampDimensions(800, 600)).toEqual({ w: 800, h: 600 });
    });

    it('caps landscape width at MAX_DIMENSION keeping aspect', () => {
        expect(clampDimensions(4096, 2048)).toEqual({ w: CONFIG.MAX_DIMENSION, h: 1024 });
    });

    it('caps portrait height at MAX_DIMENSION keeping aspect', () => {
        expect(clampDimensions(1000, 4000)).toEqual({ w: 512, h: CONFIG.MAX_DIMENSION });
    });

    it('raises landscape height to MIN_DIMENSION keeping aspect', () => {
        expect(clampDimensions(40, 20)).toEqual({ w: 100, h: CONFIG.MIN_DIMENSION });
    });

    it('raises portrait width to MIN_DIMENSION keeping aspect', () => {
        expect(clampDimensions(20, 40)).toEqual({ w: CONFIG.MIN_DIMENSION, h: 100 });
    });
});

describe('initialRatio', () => {
    it('divides the image budget by the original size', () => {
        expect(initialRatio(1000, 850)).toBeCloseTo(1);
    });

    it('uses MIN_COMPRESSION_RATIO when there are no original bytes', () => {
        expect(initialRatio(1000, 0)).toBe(CONFIG.MIN_COMPRESSION_RATIO);
    });
});

// ─── outputFileName ──────────────────────────────────────────────────────────

describe('outputFileName', () => {
    it('replaces the extension with -compressed.zip', () => {
        expect(outputFileName('photos.rar')).toBe('photos-compressed.zip');
    });

    it('strips only the last extension', () => {
        expect(outputFileName('photos.tar.gz')).toBe('photos.tar-compressed.zip');
    });

    it('appends suffix when there is no extension', () => {
        expect(outputFileName('photos')).toBe('photos-compressed.zip');
    });
});

// ─── perFileRatio ────────────────────────────────────────────────────────────

describe('perFileRatio', () => {
    it('uses the global ratio for average-sized files', () => {
        expect(perFileRatio(0.5, 1000, 1000)).toBe(0.5);
    });

    it('is more aggressive for files larger than average', () => {
        expect(perFileRatio(0.5, 1000, 2000)).toBe(0.25);
    });

    it('never exceeds the global ratio for smaller files', () => {
        expect(perFileRatio(0.5, 1000, 500)).toBe(0.5);
    });
});

// ─── extractImageFiles ───────────────────────────────────────────────────────

describe('extractImageFiles', () => {
    it('keeps only image entries outside ignored paths', async () => {
        const app = makeCompressor();
        const zip = new JSZip();
        zip.file('a.jpg', 'a');
        zip.file('b.txt', 'b');
        zip.file('__MACOSX/c.jpg', 'c');
        zip.file('.hidden.png', 'd');
        zip.file('noext', 'e');
        zip.folder('dir');
        zip.file('dir/E.PNG', 'ee');
        app.sourceZip = zip;

        await app.extractImageFiles();

        expect(app.imageFiles.map(f => f.name)).toEqual(['a.jpg', 'dir/E.PNG']);
        expect(app.imageFiles[1].extension).toBe('.png');
        expect(app.imageFiles[1].originalSize).toBe(2);
        expect(app.totalImages).toBe(2);
    });
});

// ─── findBestZip failure path ────────────────────────────────────────────────

describe('findBestZip', () => {
    beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('gives up after MAX_CONSECUTIVE_FAILURES and reduces ratio after each failure', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 1000 }];
        const spy = vi.spyOn(app, 'runCompressionIteration').mockRejectedValue(new Error('boom'));

        await expect(app.findBestZip(1000)).rejects.toThrow('Failed to create compressed ZIP');

        expect(spy).toHaveBeenCalledTimes(CONFIG.MAX_CONSECUTIVE_FAILURES);
        const [first] = spy.mock.calls[0];
        const [second] = spy.mock.calls[1];
        expect(second).toBeCloseTo(first * CONFIG.RATIO_DECREASE);
    });
});

// ─── compressImage fallbacks ─────────────────────────────────────────────────

describe('compressImage fallbacks', () => {
    const imageFile = { name: 'a.jpg', extension: '.jpg', originalData: new Uint8Array([1, 2, 3]).buffer };

    beforeEach(() => {
        URL.createObjectURL = vi.fn(() => 'blob:mock');
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.stubGlobal('JSZip', JSZip);
        vi.stubGlobal('alert', vi.fn());
        vi.restoreAllMocks();
    });

    it('returns original bytes when the image fails to load', async () => {
        vi.stubGlobal('Image', class {
            set src(_url) { Promise.resolve().then(() => this.onerror()); }
        });
        const app = makeCompressor();

        const blob = await app.compressImage(imageFile, 0.5);

        expect(blob.size).toBe(3);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('returns original bytes when processing times out', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('Image', class {
            set src(_url) {}
        });
        const app = makeCompressor();

        const promise = app.compressImage(imageFile, 0.5);
        vi.advanceTimersByTime(CONFIG.IMAGE_TIMEOUT_MS);
        const blob = await promise;

        expect(blob.size).toBe(3);
    });
});

// ─── loadViaLibarchive ───────────────────────────────────────────────────────

describe('loadViaLibarchive', () => {
    it('copies extracted File entries into a JSZip with their paths', async () => {
        const app = makeCompressor();
        Archive.open.mockResolvedValue({
            extractFiles: vi.fn(),
            getFilesArray: async () => [
                { file: new File(['abc'], 'a.jpg'), path: 'dir/' },
                { file: { name: 'stub' }, path: '' },
            ],
        });

        const zip = await app.loadViaLibarchive(new File(['x'], 'in.rar'));

        expect(Object.keys(zip.files)).toEqual(['dir/', 'dir/a.jpg']);
        expect(await zip.file('dir/a.jpg').async('string')).toBe('abc');
    });
});
