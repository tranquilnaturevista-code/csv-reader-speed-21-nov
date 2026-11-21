// The program the harness runs: `node /bot/main.ts` (Node 22). It reads every
// case from /input/cases.json (a JSON array of {id, input}), answers each one
// alone with run() from solve.js, and writes /output/answers.json: a JSON
// array of the answers, one per case and in the cases' order. Outside a
// container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it (the house baseline runs the same way, and an entry
// may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
// Stringify each answer as it is produced and join the pieces: the bytes
// are exactly JSON.stringify(answers), but the whole answers array is never
// held in memory at once (the graded sets run to tens of megabytes).
// The ?? 'null' keeps the one case array stringify would map to null
// (an undefined answer) identical.
const parts: string[] = [];
for (const c of cases) parts.push(JSON.stringify(run(c.input)) ?? 'null');
writeFileSync(join(OUTPUT_DIR, 'answers.json'), `[${parts.join(',')}]`);
