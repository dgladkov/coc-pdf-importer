// Parse fixture PDF(s) and write each document's { actors, items } to out/ as
// JSON, reporting the actor total, how many fell back to an "Unknown" name, and
// the item count. Handy for eyeballing parser output after a change.
//
//   npm run dump:json                 # every fixture -> out/<name>.json
//   npm run dump:json -- "<file.pdf>" # just that one (resolved in fixtures/)
//
// Reads from fixtures/ (see fixtures/README.md); writes gitignored out/*.json.
import fs from 'node:fs/promises';
import process from 'node:process';
import { processDocument } from '../src/document.ts';
import { FIXTURES, OUT, pdfInputs, outPath } from './fixtures.ts';

const inputs = await pdfInputs();
if (inputs.length === 0) {
  console.error(`No PDFs found in ${FIXTURES}/ — see fixtures/README.md.`);
  process.exit(1);
}

await fs.mkdir(OUT, { recursive: true });

for (const input of inputs) {
  const output = outPath(input, '.json');
  let buf: Buffer;
  try {
    buf = await fs.readFile(input);
  } catch {
    console.warn(`skip ${input} (not found)`);
    continue;
  }
  const doc = await processDocument(new Uint8Array(buf));
  await fs.writeFile(output, JSON.stringify(doc, null, 2));
  console.log(
    output,
    'actors=' + doc.actors.length,
    'Unknown=' + doc.actors.filter((c) => c.name === 'Unknown').length,
    'items=' + doc.items.length
  );
}
