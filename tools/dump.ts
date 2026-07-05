// Dump the raw pdf.js text of fixture PDF(s), page by page, to out/ — for
// inspecting how the extractor sees a document when debugging the parser.
//
//   npm run dump:text                 # every fixture -> out/<name>.txt
//   npm run dump:text -- "<file.pdf>" # just that one (resolved in fixtures/)
//
// Reads from fixtures/ (see fixtures/README.md); writes gitignored out/*.txt.
import fs from 'node:fs/promises';
import process from 'node:process';
import * as pdfjs from 'pdfjs-dist';
import { FIXTURES, OUT, pdfInputs, outPath } from './fixtures.ts';

async function processPage(pdf: pdfjs.PDFDocumentProxy, i: number) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items as any[]) {
    out += ' ' + item.str;
  }
  return out;
}

async function dump(file: string) {
  const data = new Uint8Array(await fs.readFile(file));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: Promise<string>[] = [];
  for (let i = 1; i <= pdf.numPages; i++) pages.push(processPage(pdf, i));
  return (await Promise.all(pages)).join('\n\n===PAGE BREAK===\n\n');
}

const inputs = await pdfInputs();
if (inputs.length === 0) {
  console.error(`No PDFs found in ${FIXTURES}/ — see fixtures/README.md.`);
  process.exit(1);
}

await fs.mkdir(OUT, { recursive: true });

for (const input of inputs) {
  const output = outPath(input, '.txt');
  let text: string;
  try {
    text = await dump(input);
  } catch (e) {
    console.warn(`skip ${input} (${e instanceof Error ? e.message : String(e)})`);
    continue;
  }
  await fs.writeFile(output, text);
  console.log('wrote', text.length, 'chars to', output);
}
