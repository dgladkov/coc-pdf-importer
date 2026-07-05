import "math.sumprecise/auto"; // shim Math.sumPrecise on the main thread (pdf.js
// uses it; the worker gets the same shim prepended at build time). Must be first.
import * as pdfjs from "pdfjs-dist";
import { PdfImporterConfig } from "./importer-ui.ts";

// Foundry globals (game, ui, Hooks, foundry) are declared in ./foundry.d.ts.

function registerSettings() {
  game.settings.registerMenu("coc-pdf-importer", "pdfImporter", {
    name: "coc-pdf-importer.Settings.Name",
    label: "coc-pdf-importer.Settings.Label",
    hint: "coc-pdf-importer.Settings.Hint",
    icon: "fa-solid fa-upload",
    type: PdfImporterConfig,
    restricted: true,
  });
}

function registerWorker() {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "/modules/coc-pdf-importer/pdf.worker.min.mjs",
    window.location.origin,
  ).toString();
}

Hooks.once("init", function () {
  registerWorker();
  registerSettings();
});
