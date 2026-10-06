import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TRANSLATIONS } from './i18n.js';

describe('TRANSLATIONS', () => {
    const englishKeys = Object.keys(TRANSLATIONS.en).sort();

    for (const lang of Object.keys(TRANSLATIONS)) {
        it(`${lang} has the same keys as en`, () => {
            expect(Object.keys(TRANSLATIONS[lang]).sort()).toEqual(englishKeys);
        });

        it(`${lang} uses the same value types as en`, () => {
            for (const key of englishKeys) {
                expect(typeof TRANSLATIONS[lang][key]).toBe(typeof TRANSLATIONS.en[key]);
            }
        });

        it(`${lang} compressionIteration includes the iteration number`, () => {
            expect(TRANSLATIONS[lang].compressionIteration(7)).toContain('7');
        });
    }
});

async function loadI18n({ saved = null, language } = {}) {
    vi.resetModules();
    localStorage.clear();
    if (saved !== null) localStorage.setItem('ziptosize-lang', saved);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    return import('./i18n.js');
}

describe('language detection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('uses a saved supported language over the browser language', async () => {
        const { getLang } = await loadI18n({ saved: 'de', language: 'pt-PT' });
        expect(getLang()).toBe('de');
    });

    it('ignores an unsupported saved language and uses the browser language', async () => {
        const { getLang } = await loadI18n({ saved: 'fr', language: 'pt-BR' });
        expect(getLang()).toBe('pt');
    });

    it('matches the browser language case-insensitively on its first two letters', async () => {
        const { getLang } = await loadI18n({ language: 'DE-at' });
        expect(getLang()).toBe('de');
    });

    it('falls back to en for an unsupported browser language', async () => {
        const { getLang } = await loadI18n({ language: 'fr-FR' });
        expect(getLang()).toBe('en');
    });

    it('falls back to en when the browser language is empty', async () => {
        const { getLang } = await loadI18n({ language: '' });
        expect(getLang()).toBe('en');
    });
});

describe('t / setLang', () => {
    let i18n;

    beforeEach(async () => {
        i18n = await loadI18n({ language: 'en-US' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('returns the string for the current language', () => {
        expect(i18n.t('complete')).toBe('Complete!');
    });

    it('calls function values with the given arguments', () => {
        expect(i18n.t('compressionIteration', 3)).toBe('Compression iteration 3...');
    });

    it('returns the key itself when it is unknown', () => {
        expect(i18n.t('noSuchKey')).toBe('noSuchKey');
    });

    it('switches language and persists it', () => {
        i18n.setLang('pt');
        expect(i18n.getLang()).toBe('pt');
        expect(i18n.t('complete')).toBe('Concluído!');
        expect(i18n.t('compressionIteration', 2)).toBe('Iteração de compressão 2...');
        expect(localStorage.getItem('ziptosize-lang')).toBe('pt');
    });

    it('ignores unsupported languages', () => {
        i18n.setLang('fr');
        expect(i18n.getLang()).toBe('en');
        expect(localStorage.getItem('ziptosize-lang')).toBeNull();
    });

    it('falls back to en when the current language lacks a key', () => {
        i18n.setLang('de');
        const saved = i18n.TRANSLATIONS.de.finalSize;
        delete i18n.TRANSLATIONS.de.finalSize;
        try {
            expect(i18n.t('finalSize')).toBe('Final Size');
        } finally {
            i18n.TRANSLATIONS.de.finalSize = saved;
        }
    });
});
