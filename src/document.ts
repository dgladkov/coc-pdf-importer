// Single entry point for importing a PDF: it may contain actor stat blocks
// (handled by the process.ts parser + importer.ts builder) and/or pulp reference
// items (handled by pulp.ts). This ties the two together so callers — the UI and
// the dump tool — deal with one function and one { actors, items } shape.
import { processPDF } from "./process.ts";
import type { CocCharacter } from "./process.ts";
import { extractPdfText, buildPulpItems, createPulpItems } from "./pulp.ts";
import { importCharacters } from "./importer.ts";
import type { ImportResult } from "./importer.ts";

export interface DocumentContent {
  actors: CocCharacter[];
  items: any[];
}

// Everything importable from a document: the actor stat blocks plus any guarded
// reference items. A non-pulp PDF simply yields items: [].
export async function processDocument(
  data: Uint8Array,
  source = "Pulp Cthulhu",
): Promise<DocumentContent> {
  // pdf.js detaches the input buffer as it reads it, so the two passes can't
  // share one Uint8Array; give each its own copy and run them in turn.
  const actors = await processPDF(data.slice());
  const text = await extractPdfText(data.slice());
  return { actors, items: buildPulpItems(text, source) };
}

export interface ImportDocumentOptions {
  /** Folder name for both the Actor folder and the parent Item folder. */
  folderName?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface ImportDocumentResult {
  actors: ImportResult;
  items: { created: number; items: any[] };
}

// Import a document's actors and items in one call. Actors are created at the top
// level of a "<folderName>" Actor folder (unchanged, for compatibility); items go
// into typed subfolders of a same-named Item folder (see createPulpItems).
export async function importDocument(
  data: Uint8Array,
  options: ImportDocumentOptions = {},
): Promise<ImportDocumentResult> {
  const { actors, items } = await processDocument(data);
  const folderName = options.folderName ?? "PDF Import";
  const actorResult = await importCharacters(actors, {
    folderName,
    notify: false,
  });
  const itemResult = await createPulpItems(items, {
    folderName,
    notify: false,
  });
  if (options.notify !== false) {
    ui.notifications.info(
      `Imported ${actorResult.created} actors and ${itemResult.created} items.`,
    );
  }
  return { actors: actorResult, items: itemResult };
}
