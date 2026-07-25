#!/usr/bin/env node
// Routing regression check for the X bot.
//
// Every misroute so far has been a phrasing nobody enumerated: "make" matching
// a bug report, "how do I mint" reading as a commission, "rework" missing
// entirely, a thread reply mistaken for a summons, "can you paint me" swallowed
// as a question. Keyword routing is only as good as its corpus, so the corpus
// is checked in and run rather than reasoned about.
//
//   node scripts/check-mention-routing.mjs
//
// Add a line to mentionRouting.cases.json whenever a real mention routes wrong.
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'sage-route-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, `
import { isAddressed, routeMention } from '${process.cwd()}/src/utilities/xMentions';
import cases from '${process.cwd()}/src/utilities/mentionRouting.cases.json';
const BOT = '1187436872173273091';
let pass = 0; const fails = [];
for (const [text, expected, media] of cases) {
  const m = { tweetId:'1', authorXUserId:'2', authorHandle:'t', text,
    mediaUrls: media ? ['https://pbs.twimg.com/x.jpg'] : [],
    inReplyToUserId: undefined, selfUserId: BOT, selfHandle: 'sageartxyz' };
  const got = !isAddressed(m) ? 'IGNORE' : (routeMention(m) || 'IGNORE');
  if (got === expected) pass++;
  else fails.push('  want ' + expected.padEnd(9) + ' got ' + String(got).padEnd(9) + JSON.stringify(text.slice(0,56)));
}
console.log(pass + '/' + cases.length + ' correct');
if (fails.length) { console.log('\\nMISROUTED:'); fails.forEach(f => console.log(f)); process.exit(1); }
`);
const out = join(dir, 'out.js');
try {
  execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs',
    `--alias:@=${process.cwd()}/src`, '--log-level=error', `--outfile=${out}`], { stdio: 'inherit' });
  execFileSync('node', [out], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
