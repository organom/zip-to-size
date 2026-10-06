# Code review improvements

Date: 2026-10-04

Review of zip-to-size for correctness, security and understandability; functionality is done, so only bug fixes (marked *BUG FIX*) change behaviour, everything else is behaviour-preserving.
Vendored, not reviewed: `libarchive.js`, `worker-bundle.js`, `libarchive.wasm`. Baseline: `npm test` 41/41 pass (v0.0.18, 6537f1b).

## Objectives

* OBJ1 Fix correctness bugs in size targeting, output contents and browser edge cases
* OBJ2 Harden supply chain and accessibility basics
* OBJ3 Make `script.js` easy to read and test (pure logic separated from DOM)
* OBJ4 Close test-coverage gaps and align README with actual behaviour

## Open Issues

* O1 Non-image entries (txt, pdf, …) are dropped from output when compression runs but kept when it is skipped — intended "images only" output or keep all entries? (T1.1)
* O2 Best result over target: show warning on result screen, or treat as error? (T1.2)
* O3 GIF/BMP re-encoded as PNG: rename entry to `.png`, or keep original bytes untouched? (T1.5)
* O4 Images below 50 px: never upscale (skip) vs current upscale clamp? (T1.4)
* O5 Self-host JSZip / Font Awesome (README claims offline use) or keep CDN + SRI? (T2.1)
* O6 Pre-push hook bump commit: move to CI / pre-commit, or keep and document? (T1.12)

## Tasks

* 🔲 T1 Correctness *BUG FIX*
    * 🔲 T1.1 Non-image entries lost / inconsistent between skip and compress paths — script.js:231, 266-267
    * 🔲 T1.2 Over-target result reported as success — script.js:251-255, 332-343
    * 🔲 T1.3 Ratio unbounded above 1 → images upscaled — script.js:328, 357, 393
    * 🔲 T1.4 `clampDimensions` upscales small images; 0 px / huge canvas for extreme aspect — script.js:374-387
    * 🔲 T1.5 GIF/BMP written as PNG data under original `.gif`/`.bmp` name — script.js:35-36, 361
    * 🔲 T1.6 Re-encoded image can be larger than original; no keep-original check — script.js:360-361
    * 🔲 T1.7 Re-entrant `processFile` (Ctrl+O / drop during processing) races shared state — script.js:83-92, 113, 588-591
    * 🔲 T1.8 `localStorage` unguarded → module init throws when storage blocked — i18n.js:103,109,119; script.js:541,560
    * 🔲 T1.9 Object URL revoked synchronously after `click()` → download may abort (Safari/Firefox) — script.js:499-506
    * 🔲 T1.10 libarchive `Archive` never closed → worker leak per file — script.js:154-168
    * 🔲 T1.11 `formatFileSize` breaks for <1, negative and ≥1 TB — script.js:529-535
    * 🔲 T1.12 Pre-push hook: macOS-only `sed -i ''`, bump commit not part of in-flight push — .githooks/pre-push:31-34
    * 🔲 T1.13 `beforeunload` lacks `returnValue` (older Chromium) — script.js:579-583
    * 🔲 T1.14 Default target mismatch 3.5 (HTML) vs 2.5 fallback — index.html:48; script.js:75
* 🔲 T2 Security
    * 🔲 T2.1 CDN scripts/styles without SRI; JSZip global from CDN — index.html:9-10, 134
    * 🔲 T2.2 Archive entry names with `..` / absolute paths passed through to output (zip-slip on user's extraction) — script.js:164, 197, 267
* 🔲 T3 Accessibility and i18n
    * 🔲 T3.1 Upload area not keyboard-operable (div, no role/tabindex/key handler) — index.html:32; script.js:80
    * 🔲 T3.2 Icon-only buttons / icons lack labels; lang buttons lack `aria-pressed` — index.html:16,22-26,34
    * 🔲 T3.3 Progress lacks `role=progressbar`/`aria-live` — index.html:66-74
    * 🔲 T3.4 Focus outline removed — styles.css:292-293
    * 🔲 T3.5 Untranslated dynamic/static text; unused keys `processing`/`analyzingFile`/`initializing` — index.html:60-61,68; i18n.js:9-11
    * 🔲 T3.6 Language switch mid-run does not refresh progress/result texts — script.js:544-553
    * 🔲 T3.7 Units/decimals in `formatFileSize` not localized — script.js:532-534
    * 🔲 T3.8 `alert()` for errors — script.js:525
* ✅ T4 Understandability refactors (no behaviour change)
    * ✅ T4.1 Split pure logic (CONFIG, clampDimensions, trackBestResult, outputFileName, formatFileSize, ratio step) into an ES module — script.js:7-42,107-111,243-256,374-387,529-535
    * ✅ T4.2 Split `compressImages` loop (68 lines) into ratio/convergence helpers — script.js:277-344
    * ✅ T4.3 Name magic numbers (stagnation 0.001/3, failures 3, progress 2/5/10/8/80/90/100, `1024*1024`, `95/100`) into CONFIG — script.js:11,125,153,261,278,280,302,317,319,334
    * ✅ T4.4 Single source for supported archive extensions — script.js:116; index.html:38; i18n.js:29
    * ✅ T4.5 Rename misleading identifiers: `originalZip` (any archive), `compressionRatio` stat (shows savings %), `drawAndExport(settle, fallback)` — script.js:45,68,389
    * ✅ T4.6 `compressImage`: promisify `toBlob`, declare `blobUrl` before `settle` (TDZ reliance) — script.js:421-458
    * ✅ T4.7 Deduplicate target-image-size computation — script.js:227, 284
    * ✅ T4.8 Separate UI bootstrap (theme, lang, shortcuts) from `ImageCompressor` — script.js:538-601
    * ✅ T4.9 Remove dead code: `getSupportedLangs` — i18n.js:123
    * ✅ T4.10 Consistent `Number.parseFloat` — script.js:534
* 🔲 T5 Performance / memory
    * 🔲 T5.1 Every iteration re-decodes every image; cache `ImageBitmap` — script.js:352-369, 443-456
    * 🔲 T5.2 Whole archive held 3-4× in memory (buffer, JSZip, `originalData`, per-iteration blobs) — script.js:130-131, 162-166, 210-216
    * 🔲 T5.3 Progress capped at 80% after iteration 9 of 50 — script.js:261
* ✅ T6 Tests
    * ✅ T6.1 Import module directly instead of regex-strip + `vm` eval (after T4.1) — script.test.js:8-60; compression.integration.test.js:9-11,165-172
    * ✅ T6.2 Unit tests: `clampDimensions`, `outputFileName`, per-file ratio, `extractImageFiles` filters
    * ✅ T6.3 Tests: iteration failure path, `compressImage` timeout/onerror fallback, `loadViaLibarchive` (mocked)
    * ✅ T6.4 i18n key parity test across en/pt/de — i18n.js:1-98
    * ✅ T6.5 Stub `alert` (jsdom "Not implemented" noise) — script.test.js:366
    * ✅ T6.6 Add lint script (ESLint) — package.json:6-10; eslint.config.js
* ✅ T7 Docs
    * ✅ T7.1 README algorithm stops: add stagnation + 50-iteration cap; "larger files first" wording — README.md:44-50, 9
    * ✅ T7.2 README browser matrix wrong (class fields, `?.`, `replaceAll` need Chrome 85+/Safari 14+) — README.md:84-90
    * ✅ T7.3 README structure missing `i18n.js`, `.githooks/`; "offline" claim vs CDN deps — README.md:78, 136-150
    * ✅ T7.4 package.json `author`/`keywords` empty; JSZip version duplicated (CDN vs devDep) — package.json:14,15,23; index.html:134
* ✅ T8 Raise test coverage
    * 61 → 130 tests; coverage includes all app `*.js` (vendored libarchive/worker excluded) — vitest.config.js
    * All files 79.4/72.4/81.9 → 100/100/100 % stmts/branch/lines
    * image-compressor.js 78.6/74.6/81.2 → 100/100/100; i18n.js 38.9/25/43.8 → 100/100/100; script.js not reported → 100/100/100; compression.js 100/88.9/100 → 100/100/100
    * New: image-compressor.test.js, script.dom.test.js (bootstraps real index.html); extended i18n.test.js, script.test.js

### Classification

Treated LOGICAL (not done) under "implement all non logical changing fixes":

* T1.1–T1.14 — behaviour
* T2.1, T2.2 — security
* T3.1–T3.8 — UI
* T5.1 — decoding
* T5.2 — memory
* T5.3 — UI

### T1.1 Non-image entries

* Skip path zips `originalZip` (all entries incl. `__MACOSX`, dotfiles); compress path builds `testZip` from images only.
* Size targeting also ignores non-image bytes. Fix per O1: either copy non-image entries into `testZip` (and subtract their size from the image budget) or filter both paths.

### T1.2 Over-target result

* `trackBestResult` falls back to smallest over-target zip; `compressImages` then shows "Compression Complete!" regardless.
* Final level-9 re-zip size is never compared with target.

### T1.3 Unbounded ratio

* `RATIO_INCREASE` multiplies without cap; `sqrt(ratio) > 1` scales images up (only `MAX_DIMENSION` limits). Cap ratio at 1.

### T1.4 clampDimensions

* MIN branch enlarges images already <50 px. Aspect >2048 → `h = 0` → `toBlob` null; aspect 1:10000 at MIN → 50×500000 canvas.

### T1.7 Re-entrancy

* No busy flag; second run overwrites `imageFiles`/`originalZip` mid-loop. Ignore input/drop/shortcut while processing.

### T1.12 Pre-push hook

* Commit created inside pre-push is not in the refs being pushed; `sed -i ''` fails on GNU sed.

### T2.1 SRI

* JSZip 3.10.1 and Font Awesome 6.4.0 from cdnjs without `integrity`/`crossorigin`; compromise of CDN runs code on user's files.

### T4.1 Module split

* Tests currently `vm`-eval `script.js` with imports stripped by regex; any import/format change breaks tests silently. Exporting pure helpers removes this.
