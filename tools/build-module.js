// Production build for release: assembles a clean build/ directory containing
// only the files the Foundry module ships with — the manifest, the bundled
// module.js + source map, the pdf.js worker, and the lang/ and templates/
// folders.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { copyPdfWorker } from './copy-worker.js';

const BUILD = 'build';

// Re-create the build directory from scratch each run.
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

// Bundle the module straight into build/ (minified, with a source map). Mirrors
// the production esbuild settings in build.js.
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  target: ['node18'],
  minify: true,
  sourcemap: true,
  outfile: path.join(BUILD, 'module.js'),
});

// The pdf.js worker is fetched at runtime rather than bundled, so ship it too
// (with the Math.sumPrecise shim prepended — see tools/copy-worker.js).
await copyPdfWorker(BUILD);

// Static assets: the manifest Foundry reads, the Handlebars templates the
// config dialog loads, and the localization files.
fs.copyFileSync('module.json', path.join(BUILD, 'module.json'));
fs.cpSync('templates', path.join(BUILD, 'templates'), { recursive: true });
fs.cpSync('lang', path.join(BUILD, 'lang'), { recursive: true });

console.log(`✅ Production module built in ${BUILD}/`);
