// Shared esbuild options for the module bundle, used by both the dev/prod build
// (build.js) and the release build (tools/build-module.js) so the two can't drift.
export const bundleConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  target: ['node18'],
  sourcemap: true,
  // Some transitive shim deps (es-arraybuffer-base64 → es-shims) reference the
  // bare Node global `global`, which is undefined in the browser. Rewrite it to
  // `globalThis`. esbuild respects scoping, so shadowed locals are untouched.
  define: { global: 'globalThis' },
};
