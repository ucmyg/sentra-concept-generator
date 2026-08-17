import { appendFileSync, existsSync } from 'node:fs';
import { stableStringify } from '../src/canonical-json.ts';
import { loadRun } from '../src/foundry/run-store.ts';
import { ScreenLedger } from '../src/foundry/screen-ledger.ts';
const P='foundry-ledger/incidents.jsonl';
const sink=(e)=>appendFileSync(P,`${stableStringify(e)}\n`,'utf8');
const l=existsSync(P)?loadRun(P,sink):new ScreenLedger(sink);
const ID='AUDIT-CLOSE-2026-08-16';
if(l.all().some(e=>e.evidence?.audit_id===ID)){console.log('already recorded');process.exit(0);}
l.observe('ledger-integrity','screening audit closed',{
  audit_id:ID,
  reference_run:'foundry-ledger/runs/exhaustive-hashed-0001/screen-ledger.jsonl',
  reference_seed:'exhaustive-hashed', exhaustive:true, verdicts:767, survived:128,
  method:'replay of deterministic enumeration+sampling, validated 767/767 against ledger content identities before use',
  rows:{ 'audit-run':{verdicts:36,confirmed:36,reversed:0,unverifiable:0},
         'throwaway-20:26':{verdicts:'~60 of 233',unverifiable:'all',cites:'INC-2026-08-16-fixed-path-overwrite'} },
  wrongly_executed:[], survived_then_killed_now:[],
  caveat:'EQUIVALENT_TO_KNOWN is 0 across all 767 — the equivalence killer remains unobserved on real enumerated input',
},'the close is a fact about the record, so it belongs on the record');
console.log('recorded, chain entries:',l.length,'verified:',l.verify().ok);
