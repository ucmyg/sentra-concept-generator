import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stableStringify } from '../canonical-json.ts';

import { explainRecord } from './explain.ts';
import { runFirstGeneration } from './run.ts';

const outDir = resolve(process.argv[2] ?? 'foundry-out');
mkdirSync(outDir, { recursive: true });

const report = await runFirstGeneration({ seed: 'first-generation-run', maxModelSize: 3 });

writeFileSync(
  resolve(outDir, 'registry.jsonl'),
  report.registry.toJSONL(stableStringify),
  'utf8',
);

const lines: string[] = [];
const say = (s = ''): void => {
  lines.push(s);
};

say('# Concept Foundry — first generation run');
say();
say(`seed: ${report.seed}`);
say(`records: ${report.registry.size()}   foundations: ${report.foundations.length}   consequences: ${report.consequences.length}`);
say();

say('## Foundations');
say();
for (const f of report.foundations) {
  say(`### ${f.name} (${f.id})`);
  say(`primitives: ${f.primitives.join(', ')}`);
  say(`operations: ${f.operations.map((o) => `${o.name}/${o.arity}`).join(', ')}`);
  say(`constants: ${f.constants.join(', ') || 'none'}`);
  for (const r of f.rules) say(`rule ${r.id}`);
  say();
}

say('## Substantial difference');
say();
say(`disjoint primitives: ${report.difference.disjoint_primitives}`);
say(`equivalent pairs: ${JSON.stringify(report.difference.equivalent_pairs)}`);
for (const [id, rules] of Object.entries(report.difference.non_interdefinable_rules)) {
  say(`${id}: rules with no counterpart elsewhere -> ${rules.join(', ') || 'NONE'}`);
}
say(`verdict: ${report.difference.substantially_different ? 'substantially different' : 'NOT substantially different'}`);
say();

say('## Nontrivial consequences');
say();
for (const c of report.consequences) {
  say(`- ${c.id} [${c.foundation_id}] ${c.nontrivial ? 'NONTRIVIAL' : 'trivial'} — ${c.nontrivial_reason}`);
}
say();

say('## Benchmark table (pre-registered before the run)');
say();
say('| benchmark | metric | foundation | baseline | measured | advantage |');
say('| --- | --- | --- | --- | --- | --- |');
for (const b of report.benchmarks) {
  for (const r of b.results) {
    say(`| ${b.id} | ${b.metric} | ${r.foundation_id} | ${r.baseline} | ${r.measured} | ${r.advantage ? 'yes' : 'no'} |`);
  }
}
say();

say('## Kills (cause of death recorded, records retained)');
say();
if (report.kills.length === 0) say('none in this run.');
for (const k of report.kills) say(`- ${k.id}: ${k.cause}`);
say();

say('## Rejected proposals');
say();
if (report.rejected_proposals.length === 0) say('none.');
for (const r of report.rejected_proposals) say(`- ${r.id}: ${r.rejections.join(', ')}`);
say();

say('## Open defects');
say();
for (const d of report.open_defects) say(`- ${d}`);
say();

say('## Registry (commentary layer — non-authoritative)');
say();
for (const record of report.registry.all()) {
  say('```');
  say(explainRecord(record));
  say('```');
  say();
}

writeFileSync(resolve(outDir, 'RUN-REPORT.md'), lines.join('\n'), 'utf8');
process.stdout.write(`${lines.slice(0, 40).join('\n')}\n\nwrote ${outDir}\n`);
