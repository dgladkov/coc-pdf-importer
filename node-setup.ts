// Node bootstrap shared by the test runner and the tooling scripts. pdfjs-dist
// expects a DOM `DOMMatrix` global that Node does not provide; supply it before
// any module that pulls in pdfjs is evaluated (loaded via `node --import`).
import DOMMatrix from '@thednp/dommatrix';
import 'math.sumprecise/auto'; // Automatically shims global.Math.sumPrecise
import 'es-arraybuffer-base64/auto'; // Shims Uint8Array.prototype.toHex, fromBase64, etc.

// The polyfill implements the matrix methods pdf.js uses at runtime but not the
// full DOM `DOMMatrix` static surface (fromFloat32Array, etc.), so cast to it.
global.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
