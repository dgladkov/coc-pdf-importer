import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as esbuild from 'esbuild';
import { copyPdfWorker } from './tools/copy-worker.js';
import { bundleConfig } from './tools/esbuild-config.js';
import { ensureModuleOutputDir, REPO_ROOT } from './tools/fvtt-paths.js';

const isWatchMode = process.argv.includes('--watch');

async function loadDevelopmentOptions() {
  try {
    const mod = await import('./fvtt.config.js');
    return mod.default ?? {};
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      return {};
    }
    throw err;
  }
}

function resolveOutDir(developmentOptions) {
  const manifestPath = path.join(REPO_ROOT, 'module.json');
  let moduleId = null;
  try {
    moduleId = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).id;
  } catch (err) {
    console.warn('[build] could not read module.json:', err.message);
  }

  const dest = moduleId
    ? ensureModuleOutputDir(developmentOptions, moduleId)
    : null;
  if (dest) {
    return dest;
  }

  console.warn(
    '[build] fvtt.config.js userDataPath not set — output → repo root ' +
    '(copy fvtt.config.example.js → fvtt.config.js for Foundry Data/modules)',
  );
  return REPO_ROOT;
}

function copyStaticAssets(outDir) {
  fs.copyFileSync(
    path.join(REPO_ROOT, 'module.json'),
    path.join(outDir, 'module.json'),
  );
  fs.cpSync(path.join(REPO_ROOT, 'lang'), path.join(outDir, 'lang'), {
    recursive: true,
  });
  fs.cpSync(
    path.join(REPO_ROOT, 'templates'),
    path.join(outDir, 'templates'),
    { recursive: true },
  );
}

const copyAssetsPlugin = {
  name: 'copy-module-assets',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      const outDir = path.dirname(build.initialOptions.outfile || './');
      try {
        copyStaticAssets(outDir);
        await copyPdfWorker(outDir);
      } catch (err) {
        console.error('Failed to copy module assets:', err);
      }
    });
  },
};

const developmentOptions = await loadDevelopmentOptions();
const outDir = resolveOutDir(developmentOptions);
const outfile = path.join(outDir, 'module.js');

console.log(`[build] module output → ${outDir}`);

const baseConfig = {
  ...bundleConfig,
  outfile,
  plugins: [copyAssetsPlugin],
};

const devConfig = {
  ...baseConfig,
  minify: false,
};

const prodConfig = {
  ...baseConfig,
  minify: true,
};

async function run() {
  if (isWatchMode) {
    const ctx = await esbuild.context(devConfig);
    await ctx.watch();
    console.log('👀 Development mode active: Watching for changes...');
  } else {
    console.log('🚀 Production mode active: Building minified bundle...');
    await esbuild.build(prodConfig);
    console.log('✅ Production build finished successfully.');
  }
}

run().catch((error) => {
  console.error('❌ Build script encountered a critical error:', error);
  process.exit(1);
});
