import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./libarchive.js', () => ({ Archive: { init: () => {}, open: vi.fn() } }));

const INDEX_HTML = readFileSync(join(import.meta.dirname, 'index.html'), 'utf8');

let registered = [];

function track(target) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, opts) => {
        registered.push({ target, type, fn });
        return original(type, fn, opts);
    });
}

async function boot({ theme = null, lang = null, prefersDark = false, language = 'en-US' } = {}) {
    vi.resetModules();
    localStorage.clear();
    if (theme !== null) localStorage.setItem('ziptosize-theme', theme);
    if (lang !== null) localStorage.setItem('ziptosize-lang', lang);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: prefersDark })));
    document.documentElement.innerHTML = new DOMParser().parseFromString(INDEX_HTML, 'text/html').documentElement.innerHTML;
    delete document.documentElement.dataset.theme;
    track(document);
    track(window);
    await import('./script.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
}

const $ = (id) => document.getElementById(id);

beforeEach(() => {
    registered = [];
    vi.stubGlobal('JSZip', JSZip);
    vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const { target, type, fn } of registered) target.removeEventListener(type, fn);
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('bootstrap', () => {
    it('shows the app version from the meta tag', async () => {
        await boot();
        const version = document.querySelector('meta[name="app-version"]').content;
        expect($('appVersion').textContent).toBe(`v${version}`);
    });

    it('leaves the version empty without the meta tag', async () => {
        await boot();
        document.querySelector('meta[name="app-version"]').remove();
        $('appVersion').textContent = '';
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect($('appVersion').textContent).toBe('');
    });
});

describe('theme', () => {
    it('uses the saved dark theme', async () => {
        await boot({ theme: 'dark' });
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect($('themeBtn').textContent).toBe('☀️');
        expect(localStorage.getItem('ziptosize-theme')).toBe('dark');
    });

    it('uses the saved light theme even when the OS prefers dark', async () => {
        await boot({ theme: 'light', prefersDark: true });
        expect(document.documentElement.dataset.theme).toBe('');
        expect($('themeBtn').textContent).toBe('🌙');
    });

    it('follows prefers-color-scheme when nothing is saved', async () => {
        await boot({ prefersDark: true });
        expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem('ziptosize-theme')).toBe('dark');
    });

    it('defaults to light when nothing is saved and the OS prefers light', async () => {
        await boot();
        expect(document.documentElement.dataset.theme).toBe('');
        expect(localStorage.getItem('ziptosize-theme')).toBe('light');
    });

    it('toggles on theme button click', async () => {
        await boot();
        $('themeBtn').click();
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem('ziptosize-theme')).toBe('dark');
        $('themeBtn').click();
        expect(document.documentElement.dataset.theme).toBe('');
        expect(localStorage.getItem('ziptosize-theme')).toBe('light');
    });
});

describe('translations', () => {
    it('applies the detected language to data-i18n elements, title, lang and active button', async () => {
        await boot({ language: 'pt-PT' });
        expect(document.documentElement.lang).toBe('pt');
        expect(document.title).toBe('ZipToSize - Comprimir imagens em qualquer arquivo para um tamanho alvo');
        expect(document.querySelector('[data-i18n="downloadBtn"]').textContent).toBe('Descarregar ZIP Comprimido');
        const active = [...document.querySelectorAll('.lang-btn.active')].map(b => b.dataset.lang);
        expect(active).toEqual(['pt']);
    });

    it('switches language on lang button click and persists it', async () => {
        await boot();
        expect(document.querySelector('[data-i18n="finalSize"]').textContent).toBe('Final Size');

        document.querySelector('.lang-btn[data-lang="de"]').click();

        expect(document.querySelector('[data-i18n="finalSize"]').textContent).toBe('Endgröße');
        expect(document.documentElement.lang).toBe('de');
        expect(localStorage.getItem('ziptosize-lang')).toBe('de');
        const active = [...document.querySelectorAll('.lang-btn.active')].map(b => b.dataset.lang);
        expect(active).toEqual(['de']);
    });

    it('translates every data-i18n element in index.html', async () => {
        await boot({ lang: 'de' });
        const { TRANSLATIONS } = await import('./i18n.js');
        for (const el of document.querySelectorAll('[data-i18n]')) {
            expect(el.textContent).toBe(TRANSLATIONS.de[el.dataset.i18n]);
        }
    });
});

describe('beforeunload', () => {
    function fireBeforeUnload() {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e;
    }

    it('blocks unload while processing', async () => {
        await boot();
        $('processingSection').style.display = 'block';
        expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it('allows unload when not processing', async () => {
        await boot();
        $('processingSection').style.display = 'none';
        expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });
});

describe('keyboard shortcuts', () => {
    function press(key, mods) {
        const e = new KeyboardEvent('keydown', { key, cancelable: true, ...mods });
        document.dispatchEvent(e);
        return e;
    }

    it('Ctrl+O opens the file picker', async () => {
        await boot();
        const click = vi.spyOn($('fileInput'), 'click').mockImplementation(() => {});
        expect(press('o', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(click).toHaveBeenCalledOnce();
    });

    it('Cmd+S clicks download when the button is visible', async () => {
        await boot();
        Object.defineProperty($('downloadBtn'), 'offsetParent', { get: () => document.body });
        const click = vi.spyOn($('downloadBtn'), 'click').mockImplementation(() => {});
        expect(press('s', { metaKey: true }).defaultPrevented).toBe(true);
        expect(click).toHaveBeenCalledOnce();
    });

    it('Ctrl+S does not click download when the button is hidden', async () => {
        await boot();
        const click = vi.spyOn($('downloadBtn'), 'click').mockImplementation(() => {});
        expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(click).not.toHaveBeenCalled();
    });

    it('ignores other Ctrl keys and unmodified keys', async () => {
        await boot();
        const click = vi.spyOn($('fileInput'), 'click').mockImplementation(() => {});
        expect(press('x', { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press('o', {}).defaultPrevented).toBe(false);
        expect(click).not.toHaveBeenCalled();
    });
});
