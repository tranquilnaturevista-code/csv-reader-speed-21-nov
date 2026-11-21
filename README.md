# Fast CSV Reader — Read broken CSV files faster

[![CSV Reader Speed](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tranquilnaturevista-code/csv-reader-speed-21-nov/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tranquilnaturevista-code/csv-reader-speed-21-nov/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every input — same `{columns, rows, errors}`,
including its broken-row policy (BOM, stray CRs, unterminated quotes,
quote junk, short and long rows) — in about a fifth of the CPU time.

## How it works

The reference walks the text one character at a time and builds every field
by appending one character at a time. This parser instead jumps from one
significant character to the next with `indexOf` (which V8 runs over the
string directly) and cuts each field's kept pieces out with `slice`:

- Every search is bounded by the piece it can end — the next comma for an
  unquoted field, the next quote for a quoted one — so no scan ever runs past
  the field it belongs to.
- A record whose line holds no quote at all is split at its commas in one
  native `split(',')` call.
- The common unquoted field is read inline in the record loop, with no
  function call per field.

No regular expressions, no network, no dependencies, nothing cached from one
case to the next. Pure: the same input always gives the same answer.

## Layout

- `solve.js` — the parser: an ES module whose `run(input)` returns
  csv-reader's answer for `{text, header}`.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`. It turns V8's incremental marking off before
  importing `solve.js`, as the house baseline's driver does.

## Verification

Correctness was checked against csv-reader 1.0.0 itself (the kit's
`program/generator/oracle.js`):

- 6/6 practice cases identical (byte-for-byte JSON).
- 106/106 hand-built edge cases identical: BOM, unterminated quotes,
  stray CRs, CRLF and lone CR inside quotes, quote junk, short/long rows,
  empty lines, header true/false, non-string input, large fields.
- 48/48 cases drawn by the kit's own generator from 8 different seeds
  identical.

Benchmark (CPU time, `process.cpuUsage`, `--no-incremental-marking`,
practice set: 6 cases, 10.2 MB of CSV, trimmed mean of 15 rounds):

| | CPU time | vs csv-reader |
| --- | --- | --- |
| csv-reader 1.0.0 (house baseline) | 585 ms | 1.00x |
| this entry | 118 ms | **4.96x faster** |

Per-case speedups on the practice set range from 4.5x to 8.9x (median).

## Running it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22 or later, nothing to install.
