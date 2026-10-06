import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['libarchive.js', 'worker-bundle.js', 'node_modules/', 'coverage/'] },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, JSZip: 'readonly' },
        },
    },
    {
        files: ['*.test.js', 'vitest.config.js', 'eslint.config.js'],
        languageOptions: { globals: { ...globals.node, ...globals.vitest } },
    },
];
