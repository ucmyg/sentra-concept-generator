/**
 * THE PROVES-NOTHING SWEEP
 *
 * A test that passes without exercising the thing it names is not a weak test.
 * It is a false witness: it reports health for as long as the mechanism is
 * broken, and goes red when the mechanism is repaired.
 *
 * Two occurrences in one night made this a class rather than an anecdote:
 *
 *   1. 'a screening run kills the overwhelming majority of what it proposes'
 *      asserted a kill-rate floor. A kill rate is exactly the number a broken
 *      killer inflates. It passed for as long as the equivalence channel was
 *      executing candidates on degenerate witnesses.
 *
 *   2. 'the chain breaks if any entry is altered' asserted that a fixture the
 *      test had itself just mutated was different from the original. It never
 *      called verify(). It named the tamper detector and tested nothing.
 *
 * This sweep catches the mechanically detectable symptoms. It cannot catch the
 * general case — that is what rule R1 in docs/genesis/EVIDENCE-LAW.md is for.
 * Exit code is non-zero when anything is flagged, so CI can hold the line.
 *
 * Usage: node tools/proves-nothing-sweep.mjs [testDir]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const testDir = resolve(process.argv[2] ?? 'tests');

/**
 * Every test file under dir, recursively.
 *
 * `.fixture` files are the sweep's own RED evidence — deliberately defective
 * tests, kept out of the runner by their extension. They are skipped when
 * sweeping the live suite and included when the fixture directory is the
 * explicit target, which is how `npm run sweep:red` proves the sweep fires.
 */
const FIXTURE_DIR = 'proves-nothing';

function testFiles(dir, isExplicitTarget) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === FIXTURE_DIR && !isExplicitTarget) continue;
      out.push(...testFiles(full, isExplicitTarget));
    } else if (entry.name.endsWith('.test.ts')) out.push(full);
    else if (isExplicitTarget && entry.name.endsWith('.test.ts.fixture')) out.push(full);
  }
  return out;
}

/** Split a file into top-level test(...) blocks by brace depth. */
function testBlocks(src) {
  const blocks = [];
  const re = /\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[2];
    let i = src.indexOf('{', re.lastIndex);
    if (i < 0) continue;
    let depth = 0;
    let end = i;
    for (; end < src.length; end += 1) {
      const ch = src[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ name, body: src.slice(i, end + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return blocks;
}

/** Words in a test name that claim it guards a mechanism. */
const GUARD_WORDS =
  /\b(gate|gated|chain|chained|kill|kills|killed|refus|reject|catch|caught|break|breaks|broken|tamper|verif|detect|must|never|cannot|blocks?|guard)\b/i;

const findings = [];

for (const file of testFiles(testDir, testDir.endsWith(FIXTURE_DIR))) {
  const src = readFileSync(file, 'utf8');
  for (const block of testBlocks(src)) {
    const rel = file.replace(`${process.cwd()}\\`, '').replace(`${process.cwd()}/`, '');
    const where = `${rel}:${block.line}`;

    // --- Symptom A: dead locals. Declared, never read again. ---
    const declared = [...block.body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)].map((x) => x[1]);
    for (const name of declared) {
      const uses = [...block.body.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
      if (uses <= 1) {
        findings.push({
          where,
          test: block.name,
          symptom: 'DEAD_LOCAL',
          detail: `'${name}' is assigned and never read — it is scaffolding the assertions do not touch`,
        });
      }
    }

    // --- Symptom B: void'd values. `void x` in a test is a suppressed unused. ---
    if (/^\s*void\s+\w+;/m.test(block.body)) {
      findings.push({
        where,
        test: block.name,
        symptom: 'VOIDED_VALUE',
        detail: 'a value is computed then discarded with `void` — the test built something it never checked',
      });
    }

    // --- Symptom C: a guard test that never calls anything. ---
    if (GUARD_WORDS.test(block.name)) {
      const calls = [...block.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((x) => x[1])
        .filter((n) => !/^(assert|test|it|expect|Object|Array|JSON|String|Number|Boolean|Set|Map|require|import|console)$/.test(n));
      if (calls.length === 0) {
        findings.push({
          where,
          test: block.name,
          symptom: 'NO_MECHANISM_INVOKED',
          detail: 'the name claims a guard, but the body invokes no function under test',
        });
      }
    }

    // --- Symptom E: an assertion comparing two aggregate outcome counts. ---
    // This is the one that mattered. `died > tally.SURVIVED` is a rate
    // assertion wearing a comparison's clothes: both sides are outcome
    // tallies from the same run, so a mechanism that mis-classifies inflates
    // one side and the assertion reports health. See EVIDENCE-LAW.md L1.
    const AGGREGATE =
      /\b(tally|candidates_screened|candidates_enumerated|survivors|results|died|killed|passed|failed)\b/;
    for (const a of block.body.matchAll(/assert\.\w+\(\s*([^,;]+?)\s*(?:,|\)\s*;)/g)) {
      const expr = a[1] ?? '';
      const comparison = /[<>]=?|!==?|===?/.test(expr);
      if (!comparison) continue;
      const sides = expr.split(/[<>]=?|!==?|===?/).filter((s) => s.trim().length > 0);
      if (sides.length < 2) continue;
      const aggregateSides = sides.filter((s) => AGGREGATE.test(s)).length;
      // Both sides derived from the same run's counts => a rate in disguise.
      // One side aggregate against a literal (e.g. `> 0`) is a breadth or
      // existence floor, which L1 explicitly permits.
      if (aggregateSides >= 2) {
        findings.push({
          where,
          test: block.name,
          symptom: 'RATE_ASSERTION',
          detail:
            `'${expr.trim()}' compares two outcome aggregates from the same run. ` +
            'A broken mechanism inflates one side, so this passes precisely when it should fail (EVIDENCE-LAW L1).',
        });
      }
    }

    // --- Symptom D: asserting on a fixture the test itself just built. ---
    // e.g. const forged = {...orig, x: 'new'}; assert.notEqual(forged.x, orig.x)
    const spreads = [...block.body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*\.\.\./g)].map((x) => x[1]);
    for (const name of spreads) {
      const asserted = new RegExp(`assert\\.\\w+\\(\\s*${name}\\.`).test(block.body);
      const passedOn = new RegExp(`\\b\\w+\\(([^)]*\\b)?${name}\\b`).test(
        block.body.replace(new RegExp(`const\\s+${name}\\s*=[^;]*;`), ''),
      );
      if (asserted && !passedOn) {
        findings.push({
          where,
          test: block.name,
          symptom: 'ASSERTS_OWN_FIXTURE',
          detail: `'${name}' was constructed by this test and asserted on directly, without being fed to the mechanism`,
        });
      }
    }
  }
}

if (findings.length === 0) {
  console.log('proves-nothing sweep: clean');
  process.exit(0);
}

console.log(`proves-nothing sweep: ${findings.length} finding(s)\n`);
for (const f of findings) {
  console.log(`  ${f.symptom}  ${f.where}`);
  console.log(`    test: ${f.test}`);
  console.log(`    ${f.detail}\n`);
}
process.exit(1);
