// pdf.js's worker calls recent language additions — `Math.sumPrecise` (laying
// out text runs) and `Uint8Array.prototype.toHex` / `Uint8Array.fromBase64`
// (computing document fingerprints). A browser/Foundry client that predates
// them makes the worker throw (e.g. `a.toHex is not a function`) — the same
// gap we shim away in Node via node-setup.ts. We can't inject a global into the
// worker at runtime, so we prepend the polyfills to the worker file itself when
// copying it into a build.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";

const WORKER_SRC = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";

let shimPromise;

// Bundle the same `math.sumprecise/auto` and `es-arraybuffer-base64/auto` shims
// the Node tooling uses into a self-contained browser IIFE (cached — it never
// changes within a run).
function buildShim() {
  shimPromise ??= esbuild
    .build({
      stdin: {
        contents:
          "import 'math.sumprecise/auto';\nimport 'es-arraybuffer-base64/auto';",
        resolveDir: process.cwd(),
        loader: "js",
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      minify: true,
      write: false,
    })
    .then((result) => result.outputFiles[0].text.trimEnd());
  return shimPromise;
}

// Write pdf.js's worker into `destDir` with the shims prepended so the
// polyfills are installed before the worker body runs.
export async function copyPdfWorker(destDir) {
  const shim = await buildShim();
  const worker = fs.readFileSync(WORKER_SRC, "utf8");
  fs.writeFileSync(
    path.join(destDir, "pdf.worker.min.mjs"),
    `${shim};\n${worker}`,
  );
}
