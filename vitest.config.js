import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        coverage: {
            include: ['*.js'],
            exclude: ['*.test.js', 'vitest.config.js', 'eslint.config.js', 'libarchive.js', 'worker-bundle.js'],
        },
    },
});
