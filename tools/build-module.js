// Production build for release. Assembles the module files, packs them into a
// zip with 7-Zip (ultra compression), and leaves build/ with two artifacts:
//   build/module.zip   — the installable module (module.json, module.js + map,
//                         the pdf.js worker, lang/ and templates/)
//   build/module.json   — the manifest, served alongside the zip so Foundry's
//                         release manifest URL can point at it
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { copyPdfWorker } from './copy-worker.js';

const BUILD = 'build';
const STAGE = path.join(BUILD, 'staging'); // module contents, zipped then removed
// The 7-Zip console binary: "7z" on Windows, "7zz" on Linux/macOS.
const SEVEN_ZIP = process.platform === 'win32' ? '7z' : '7zz';

// Re-create the build directory from scratch each run.
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// Bundle the module into the staging dir (minified, with a source map). Mirrors
// the production esbuild settings in build.js.
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  target: ['node18'],
  minify: true,
  sourcemap: true,
  outfile: path.join(STAGE, 'module.js'),
});

// The pdf.js worker is fetched at runtime rather than bundled, so ship it too
// (with the Math.sumPrecise shim prepended — see tools/copy-worker.js).
await copyPdfWorker(STAGE);

// Static assets: the manifest Foundry reads, the Handlebars templates the config
// dialog loads, and the localization files.
fs.copyFileSync('module.json', path.join(STAGE, 'module.json'));
fs.cpSync('templates', path.join(STAGE, 'templates'), { recursive: true });
fs.cpSync('lang', path.join(STAGE, 'lang'), { recursive: true });

// Pack the staged files at the zip root (run from STAGE so paths have no prefix)
// with maximum compression, then drop the manifest next to the zip and clean up.
const archive = path.resolve(BUILD, 'module.zip');
try {
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx=9', '-bso0', '-bsp0', archive, '.'], {
    cwd: STAGE,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
} catch (err) {
  if (err.code === 'ENOENT')
    throw new Error(
      `7-Zip not found — install it and ensure "${SEVEN_ZIP}" is on PATH ` +
        `(Windows: 7-Zip provides "7z"; Linux/macOS: p7zip provides "7zz").`,
    );
  throw err;
}

fs.copyFileSync('module.json', path.join(BUILD, 'module.json'));
fs.rmSync(STAGE, { recursive: true, force: true });

console.log(`✅ Release built: ${BUILD}/module.zip + ${BUILD}/module.json`);
