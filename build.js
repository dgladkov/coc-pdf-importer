import path from 'node:path';
import process from 'node:process';
import * as esbuild from 'esbuild';
import { copyPdfWorker } from './tools/copy-worker.js';

const isWatchMode = process.argv.includes('--watch');

const copyPdfWorkerPlugin = {
  name: 'copy-pdf-worker',
  setup(build) {
    build.onEnd(async () => {
      // Copy the pdf.js worker next to the bundle, with the Math.sumPrecise shim
      // prepended (see tools/copy-worker.js).
      const outDir = path.dirname(build.initialOptions.outfile || './');
      try {
        await copyPdfWorker(outDir);
      } catch (err) {
        console.error('Failed to copy PDF.js worker:', err);
      }
    });
  },
};

const baseConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  target: ['node18'],
  outfile: 'module.js',
  plugins: [copyPdfWorkerPlugin],
};

const devConfig = {
  ...baseConfig,
  minify: false,
  sourcemap: true,
}

const prodConfig = {
  ...baseConfig,
  minify: true,
  sourcemap: true,
}


// 5. Orchestrate build execution strategy
async function run() {
  if (isWatchMode) {
    // Creates persistent context required for live tracking
    const ctx = await esbuild.context(devConfig);
    await ctx.watch();
    console.log('👀 Development mode active: Watching for changes...');
  } else {
    // Performs a highly optimized single compilation pass
    console.log('🚀 Production mode active: Building minified bundle...');
    await esbuild.build(prodConfig);
    console.log('✅ Production build finished successfully.');
  }
}

// 6. Safely invoke the async runner and catch top-level errors
run().catch((error) => {
  console.error('❌ Build script encountered a critical error:', error);
  process.exit(1);
});