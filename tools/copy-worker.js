// pdf.js's worker calls `Math.sumPrecise` (used when laying out text runs). It
// is a recent addition to the language, so a browser/Foundry client that
// predates it makes the worker throw and silently mis-extract text — the same
// truncation we shim away in Node via node-setup.ts. We can't inject a global
// into the worker at runtime, so we prepend the polyfill to the worker file
// itself when copying it into a build.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";

const WORKER_SRC = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";

let shimPromise;

// Bundle the same `math.sumprecise/auto` shim the Node tooling uses into a
// self-contained browser IIFE (cached — it never changes within a run).
function buildShim() {
  shimPromise ??= esbuild
    .build({
      stdin: {
        contents: "import 'math.sumprecise/auto';",
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

// Write pdf.js's worker into `destDir` with the Math.sumPrecise shim prepended
// so the polyfill is installed before the worker body runs.
export async function copyPdfWorker(destDir) {
  const shim = await buildShim();
  const worker = fs.readFileSync(WORKER_SRC, "utf8");
  fs.writeFileSync(
    path.join(destDir, "pdf.worker.min.mjs"),
    `${shim};\n${worker}`,
  );
}
