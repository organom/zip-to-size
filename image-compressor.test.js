import JSZip from 'jszip';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CONFIG } from './compression.js';
import { ImageCompressor } from './image-compressor.js';

vi.mock('./libarchive.js', () => ({ Archive: { init: () => {}, open: vi.fn() } }));
vi.mock('./i18n.js', () => ({ t: (key, ...args) => (args.length ? `${key}:${args.join(',')}` : key) }));

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

function makeCompressor() {
    document.body.innerHTML = DOM_HTML;
    return new ImageCompressor();
}

const imageFile = { name: 'a.jpg', extension: '.jpg', originalData: new Uint8Array([1, 2, 3]).buffer, originalSize: 3 };

beforeEach(() => {
    vi.stubGlobal('JSZip', JSZip);
    vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('constructor', () => {
    it('sets the file input accept list from ARCHIVE_EXTENSIONS', () => {
        const app = makeCompressor();
        expect(app.el.fileInput.accept).toContain('.zip');
        expect(app.el.fileInput.accept).toContain('.rar');
    });
});

describe('upload area and file input events', () => {
    let app;
    beforeEach(() => {
        app = makeCompressor();
        vi.spyOn(app, 'processFile').mockResolvedValue();
    });

    it('opens the file picker on click', () => {
        const click = vi.spyOn(app.el.fileInput, 'click').mockImplementation(() => {});
        app.el.uploadArea.click();
        expect(click).toHaveBeenCalledOnce();
    });

    it('toggles the dragover class on dragover / dragleave', () => {
        const over = new Event('dragover', { cancelable: true });
        app.el.uploadArea.dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        expect(app.el.uploadArea.classList.contains('dragover')).toBe(true);

        const leave = new Event('dragleave', { cancelable: true });
        app.el.uploadArea.dispatchEvent(leave);
        expect(leave.defaultPrevented).toBe(true);
        expect(app.el.uploadArea.classList.contains('dragover')).toBe(false);
    });

    it('processes the first dropped file and clears dragover', () => {
        const file = new File(['x'], 'a.zip');
        app.el.uploadArea.classList.add('dragover');
        const drop = new Event('drop', { cancelable: true });
        drop.dataTransfer = { files: [file] };
        app.el.uploadArea.dispatchEvent(drop);
        expect(drop.defaultPrevented).toBe(true);
        expect(app.el.uploadArea.classList.contains('dragover')).toBe(false);
        expect(app.processFile).toHaveBeenCalledWith(file);
    });

    it('ignores a drop without files', () => {
        const drop = new Event('drop', { cancelable: true });
        drop.dataTransfer = { files: [] };
        app.el.uploadArea.dispatchEvent(drop);
        expect(app.processFile).not.toHaveBeenCalled();
    });

    it('processes the selected file on input change', () => {
        const file = new File(['x'], 'a.zip');
        Object.defineProperty(app.el.fileInput, 'files', { value: [file], configurable: true });
        app.el.fileInput.dispatchEvent(new Event('change'));
        expect(app.processFile).toHaveBeenCalledWith(file);
    });

    it('ignores an input change without a file', () => {
        Object.defineProperty(app.el.fileInput, 'files', { value: [], configurable: true });
        app.el.fileInput.dispatchEvent(new Event('change'));
        expect(app.processFile).not.toHaveBeenCalled();
    });

    it('wires the download and new-file buttons', () => {
        const download = vi.spyOn(URL, 'createObjectURL');
        app.el.downloadBtn.click();
        expect(download).not.toHaveBeenCalled();

        app.finalZipBlob = new Blob(['z']);
        app.el.newFileBtn.click();
        expect(app.finalZipBlob).toBeNull();
        expect(app.el.uploadSection.style.display).toBe('block');
    });
});

describe('processFile', () => {
    let app;
    beforeEach(() => {
        app = makeCompressor();
        vi.spyOn(app, 'showError');
    });

    it('loads a ZIP via JSZip, fills file info and compresses', async () => {
        const zip = new JSZip();
        zip.file('a.jpg', 'abc');
        const data = await zip.generateAsync({ type: 'uint8array' });
        const file = new File([data], 'Photos.ZIP');
        const compress = vi.spyOn(app, 'compressImages').mockResolvedValue();

        await app.processFile(file);

        expect(compress).toHaveBeenCalledOnce();
        expect(app.outputName).toBe('Photos-compressed.zip');
        expect(app.originalFileSize).toBe(file.size);
        expect(app.el.fileName.textContent).toBe('Photos.ZIP');
        expect(app.imageFiles.map(f => f.name)).toEqual(['a.jpg']);
        expect(app.el.processingSection.style.display).toBe('block');
        expect(app.showError).not.toHaveBeenCalled();
    });

    it('loads non-ZIP archives via libarchive', async () => {
        const zip = new JSZip();
        zip.file('b.png', 'png');
        const load = vi.spyOn(app, 'loadViaLibarchive').mockResolvedValue(zip);
        vi.spyOn(app, 'compressImages').mockResolvedValue();
        const file = new File(['x'], 'in.rar');

        await app.processFile(file);

        expect(load).toHaveBeenCalledWith(file);
        expect(app.imageFiles.map(f => f.name)).toEqual(['b.png']);
    });

    it('shows errorNoImages when the archive has no images', async () => {
        const zip = new JSZip();
        zip.file('readme.txt', 'hi');
        vi.spyOn(app, 'loadViaLibarchive').mockResolvedValue(zip);
        const compress = vi.spyOn(app, 'compressImages');

        await app.processFile(new File(['x'], 'in.7z'));

        expect(app.showError).toHaveBeenCalledWith('errorNoImages');
        expect(compress).not.toHaveBeenCalled();
        expect(globalThis.alert).toHaveBeenCalledWith('errorNoImages');
    });

    it('shows errorProcessing when loading throws', async () => {
        vi.spyOn(app, 'loadViaLibarchive').mockRejectedValue(new Error('bad'));

        await app.processFile(new File(['x'], 'in.tar'));

        expect(app.showError).toHaveBeenCalledWith('errorProcessing');
        expect(app.el.uploadSection.style.display).toBe('block');
    });
});

describe('extractImageFiles', () => {
    it('skips entries whose extraction fails', async () => {
        const app = makeCompressor();
        app.sourceZip = {
            files: {
                'bad.jpg': { dir: false, async: () => Promise.reject(new Error('corrupt')) },
                'ok.png': { dir: false, async: async () => new Uint8Array([1, 2]).buffer },
            },
        };

        await app.extractImageFiles();

        expect(app.imageFiles.map(f => f.name)).toEqual(['ok.png']);
        expect(app.totalImages).toBe(1);
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('trySkipCompression', () => {
    it('returns false without zipping when images exceed the image budget', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 1000 }];
        const gen = vi.spyOn(app, 'generateZipBlob');
        expect(await app.trySkipCompression(1000)).toBe(false);
        expect(gen).not.toHaveBeenCalled();
    });

    it('returns false when the re-zipped archive exceeds the target', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 10 }];
        vi.spyOn(app, 'generateZipBlob').mockResolvedValue({ size: 2000 });
        expect(await app.trySkipCompression(1000)).toBe(false);
        expect(app.finalZipBlob).toBeNull();
    });

    it('accepts the source archive when it already fits', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 10 }];
        app.totalImages = 1;
        app.originalFileSize = 2000;
        vi.spyOn(app, 'generateZipBlob').mockResolvedValue({ size: 500 });

        expect(await app.trySkipCompression(1000)).toBe(true);

        expect(app.processedImages).toBe(1);
        expect(app.el.progressText.textContent).toBe('complete');
        expect(app.el.progressPercent.textContent).toBe('100%');
        expect(app.el.resultSection.style.display).toBe('block');
    });
});

describe('runCompressionIteration', () => {
    it('clamps the ratio, zips compressed images and records the size', async () => {
        const app = makeCompressor();
        const compressAll = vi.spyOn(app, 'compressAllImages').mockResolvedValue([{ name: 'a.jpg', data: new Blob(['abc']) }]);

        const { testZip, zipSize } = await app.runCompressionIteration(0.001, 1);

        expect(compressAll).toHaveBeenCalledWith(CONFIG.MIN_COMPRESSION_RATIO);
        expect(Object.keys(testZip.files)).toEqual(['a.jpg']);
        expect(app.currentIterationSize).toBe(zipSize);
        expect(app.el.progressText.textContent).toBe('compressionIteration:2');
    });
});

describe('findBestZip', () => {
    it('stops after MAX_STAGNANT_ITERATIONS of unchanged size and returns the best zip', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 10000 }];
        const zip = { id: 'z' };
        const spy = vi.spyOn(app, 'runCompressionIteration').mockResolvedValue({ testZip: zip, zipSize: 5000 });

        expect(await app.findBestZip(1000)).toBe(zip);
        expect(spy).toHaveBeenCalledTimes(CONFIG.MAX_STAGNANT_ITERATIONS + 1);
    });

    it('stops as soon as a result is within target', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 10000 }];
        const spy = vi.spyOn(app, 'runCompressionIteration')
            .mockResolvedValueOnce({ testZip: 'big', zipSize: 5000 })
            .mockResolvedValueOnce({ testZip: 'fit', zipSize: 900 });

        expect(await app.findBestZip(1000)).toBe('fit');
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy.mock.calls[1][0]).toBeCloseTo(spy.mock.calls[0][0] * CONFIG.RATIO_DECREASE);
    });

    it('resets the failure counter after a success', async () => {
        const app = makeCompressor();
        app.imageFiles = [{ originalSize: 10000 }];
        const spy = vi.spyOn(app, 'runCompressionIteration')
            .mockRejectedValueOnce(new Error('a'))
            .mockRejectedValueOnce(new Error('b'))
            .mockResolvedValueOnce({ testZip: 'big', zipSize: 5000 })
            .mockRejectedValueOnce(new Error('c'))
            .mockRejectedValueOnce(new Error('d'))
            .mockResolvedValueOnce({ testZip: 'fit', zipSize: 950 });

        expect(await app.findBestZip(1000)).toBe('fit');
        expect(spy).toHaveBeenCalledTimes(6);
    });
});

describe('compressImages', () => {
    it('returns early when compression can be skipped', async () => {
        const app = makeCompressor();
        vi.spyOn(app, 'trySkipCompression').mockResolvedValue(true);
        const find = vi.spyOn(app, 'findBestZip');
        await app.compressImages();
        expect(find).not.toHaveBeenCalled();
    });

    it('finalizes the best zip at the final level and shows results', async () => {
        const app = makeCompressor();
        app.originalFileSize = 4000;
        vi.spyOn(app, 'trySkipCompression').mockResolvedValue(false);
        vi.spyOn(app, 'findBestZip').mockResolvedValue('best');
        const gen = vi.spyOn(app, 'generateZipBlob').mockResolvedValue({ size: 1000 });

        await app.compressImages();

        expect(gen).toHaveBeenCalledWith('best', CONFIG.ZIP_FINAL_LEVEL);
        expect(app.finalZipBlob).toEqual({ size: 1000 });
        expect(app.el.compressedSize.textContent).toBe('1000 Bytes');
        expect(app.el.savingsPercent.textContent).toBe('75.0%');
        expect(app.el.spaceSaved.textContent).toBe('2.93 KB (75.0%)');
        expect(app.el.resultSection.style.display).toBe('block');
    });
});

describe('compressAllImages', () => {
    it('uses the original bytes when an image fails to compress', async () => {
        const app = makeCompressor();
        app.imageFiles = [imageFile, { ...imageFile, name: 'b.jpg' }];
        app.totalImages = 2;
        vi.spyOn(app, 'compressImage')
            .mockRejectedValueOnce(new Error('x'))
            .mockResolvedValueOnce(new Blob(['ok']));

        const result = await app.compressAllImages(0.5);

        expect(result.map(r => r.name)).toEqual(['a.jpg', 'b.jpg']);
        expect(result[0].data.size).toBe(3);
        expect(result[1].data.size).toBe(2);
        expect(app.el.imagesProcessed.textContent).toBe('2/2');
    });
});

describe('compressImage', () => {
    beforeEach(() => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    function stubLoadingImage() {
        vi.stubGlobal('Image', class {
            width = 100;
            height = 80;
            set src(_url) { Promise.resolve().then(() => this.onload()); }
        });
    }

    it('falls back to original bytes when the blob URL cannot be created', async () => {
        URL.createObjectURL.mockImplementation(() => { throw new Error('nope'); });
        const app = makeCompressor();

        const blob = await app.compressImage(imageFile, 0.5);

        expect(blob.size).toBe(3);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('resolves with the rendered blob on success', async () => {
        stubLoadingImage();
        const app = makeCompressor();
        const rendered = new Blob(['rendered!']);
        vi.spyOn(app, 'renderToBlob').mockResolvedValue(rendered);

        expect(await app.compressImage(imageFile, 0.5)).toBe(rendered);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('falls back when rendering yields no blob', async () => {
        stubLoadingImage();
        const app = makeCompressor();
        vi.spyOn(app, 'renderToBlob').mockResolvedValue(null);

        const blob = await app.compressImage(imageFile, 0.5);

        expect(blob.size).toBe(3);
        expect(console.warn).toHaveBeenCalled();
    });

    it('falls back when rendering throws', async () => {
        stubLoadingImage();
        const app = makeCompressor();
        vi.spyOn(app, 'renderToBlob').mockRejectedValue(new Error('canvas'));

        const blob = await app.compressImage(imageFile, 0.5);

        expect(blob.size).toBe(3);
    });

    it('keeps the timeout fallback when rendering finishes late', async () => {
        vi.useFakeTimers();
        stubLoadingImage();
        const app = makeCompressor();
        let finishRender;
        vi.spyOn(app, 'renderToBlob').mockReturnValue(new Promise((r) => { finishRender = r; }));

        const promise = app.compressImage(imageFile, 0.5);
        await vi.advanceTimersByTimeAsync(CONFIG.IMAGE_TIMEOUT_MS);
        finishRender(new Blob(['late result']));
        const blob = await promise;
        await Promise.resolve();

        expect(blob.size).toBe(3);
        expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    });
});

describe('renderToBlob', () => {
    let ctx;
    let toBlob;

    beforeEach(() => {
        ctx = { drawImage: vi.fn() };
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
        toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) { cb(new Blob(['out'])); });
    });

    it('scales by sqrt(ratio) and exports with the mapped MIME type and quality', async () => {
        const app = makeCompressor();

        const blob = await app.renderToBlob({ width: 400, height: 200 }, { extension: '.jpg' }, 0.25);

        expect(blob.size).toBe(3);
        expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 200, 100);
        expect(ctx.imageSmoothingQuality).toBe('high');
        expect(toBlob.mock.calls[0][1]).toBe('image/jpeg');
        expect(toBlob.mock.calls[0][2]).toBeCloseTo(0.3);
    });

    it('exports PNG without quality', async () => {
        const app = makeCompressor();
        await app.renderToBlob({ width: 100, height: 100 }, { extension: '.png' }, 1);
        expect(toBlob.mock.calls[0][1]).toBe('image/png');
        expect(toBlob.mock.calls[0][2]).toBeUndefined();
    });

    it('defaults to image/jpeg for unknown extensions', async () => {
        const app = makeCompressor();
        await app.renderToBlob({ width: 100, height: 100 }, { extension: '.xyz' }, 1);
        expect(toBlob.mock.calls[0][1]).toBe('image/jpeg');
    });
});

describe('updateStats', () => {
    it('reports 0.0% savings when there is no base size', () => {
        const app = makeCompressor();
        app.currentIterationSize = 500;
        app.updateStats();
        expect(app.el.compressedSize.textContent).toBe('500 Bytes');
        expect(app.el.savingsPercent.textContent).toBe('0.0%');
    });

    it('leaves compressed size untouched when nothing is compressed yet', () => {
        const app = makeCompressor();
        app.el.compressedSize.textContent = '-';
        app.updateStats();
        expect(app.el.compressedSize.textContent).toBe('-');
        expect(app.el.imagesProcessed.textContent).toBe('0/0');
    });
});

describe('downloadCompressedZip', () => {
    it('does nothing without a final blob', () => {
        const app = makeCompressor();
        const create = vi.spyOn(URL, 'createObjectURL');
        app.downloadCompressedZip();
        expect(create).not.toHaveBeenCalled();
    });

    it('clicks a temporary anchor with the output name and revokes the URL', () => {
        const app = makeCompressor();
        app.finalZipBlob = new Blob(['zip']);
        app.outputName = 'out-compressed.zip';
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dl');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const clicked = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
        });

        app.downloadCompressedZip();

        expect(clicked).toEqual([{ href: 'blob:dl', download: 'out-compressed.zip', attached: true }]);
        expect(document.querySelector('a')).toBeNull();
        expect(revoke).toHaveBeenCalledWith('blob:dl');
    });
});
