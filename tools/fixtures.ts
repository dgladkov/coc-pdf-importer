// Shared helpers for the dump tools: resolve which PDF(s) to process and where
// their output goes.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const FIXTURES = 'fixtures';
export const OUT = 'out';

// The PDFs to process: the CLI argument if one is given (resolved inside
// fixtures/ unless it is an absolute path), otherwise every *.pdf in fixtures/.
export async function pdfInputs(): Promise<string[]> {
  const arg = process.argv[2];
  if (arg) return [path.isAbsolute(arg) ? arg : path.join(FIXTURES, arg)];

  const entries = await fs.readdir(FIXTURES).catch(() => [] as string[]);
  return entries
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((f) => path.join(FIXTURES, f));
}

// Output path in out/ named after the input PDF, e.g. "foo.pdf" -> "out/foo.json".
export function outPath(input: string, ext: string): string {
  return path.join(OUT, path.basename(input).replace(/\.pdf$/i, '') + ext);
}
