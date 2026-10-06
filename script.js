import { t, setLang, getLang } from './i18n.js';
import { ImageCompressor } from './image-compressor.js';

function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    document.getElementById('themeBtn').textContent = dark ? '☀️' : '🌙';
    localStorage.setItem('ziptosize-theme', dark ? 'dark' : 'light');
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.documentElement.lang = getLang();
    document.title = t('title');
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === getLang());
    });
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const version = document.querySelector('meta[name="app-version"]')?.content;
    if (version) document.getElementById('appVersion').textContent = `v${version}`;

    const savedDark = localStorage.getItem('ziptosize-theme') === 'dark'
        || (localStorage.getItem('ziptosize-theme') === null && globalThis.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(savedDark);

    document.getElementById('themeBtn').addEventListener('click', () => {
        applyTheme(document.documentElement.dataset.theme !== 'dark');
    });

    applyTranslations();

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLang(btn.dataset.lang);
            applyTranslations();
        });
    });

    const app = new ImageCompressor();

    window.addEventListener('beforeunload', (e) => {
        if (app.el.processingSection.style.display !== 'none') {
            e.preventDefault();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'o':
                    e.preventDefault();
                    app.el.fileInput.click();
                    break;
                case 's':
                    e.preventDefault();
                    if (app.el.downloadBtn.offsetParent !== null) {
                        app.el.downloadBtn.click();
                    }
                    break;
            }
        }
    });
});
