#!/usr/bin/env node
/**
 * Copy the runtime secrets a deployed instance needs from .env into
 * .env.cloudrun.yaml.
 *
 * WHY THIS EXISTS
 * ---------------
 * The two files drifted, silently and expensively. Production carried
 * TWITTER_CLIENT_ID: 'localdev' — a placeholder — so X sent every visitor to
 * "Something went wrong" the moment they tried to link an account, with no
 * error anywhere in our own logs because the failure happens on X's side. The
 * X bot keys and the model API keys were absent entirely, which means those
 * features have never been able to run on sageart.xyz at all.
 *
 * Reads values and writes them; never prints one. Reports only the key name
 * and whether it was replaced, added or skipped.
 *
 *   node scripts/sync-prod-secrets.mjs          # show what would change
 *   node scripts/sync-prod-secrets.mjs --write  # apply
 */
import fs from 'fs';

const KEYS = [
  // OAuth 2.0 — visitor X-account linking
  'TWITTER_CLIENT_ID',
  'TWITTER_CLIENT_SECRET',
  // OAuth 1.0a — the @SAGEARTXYZ bot posting as itself
  'SAGE_X_APP_KEY',
  'SAGE_X_APP_SECRET',
  'SAGE_X_ACCESS_TOKEN',
  'SAGE_X_ACCESS_SECRET',
  // the agent cannot answer at all without these
  'ANTHROPIC_API_KEY',
  'KREA_API_KEY',
];

const WRITE = process.argv.includes('--write');
const ENV = '.env';
const YAML = '.env.cloudrun.yaml';

const env = fs.readFileSync(ENV, 'utf8');
const readEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

let yaml = fs.readFileSync(YAML, 'utf8');
const report = [];

for (const k of KEYS) {
  const v = readEnv(k);
  if (!v) {
    report.push([k, 'SKIPPED — not set locally either']);
    continue;
  }
  const line = new RegExp(`^'${k}': .*$`, 'm');
  const existing = yaml.match(line);
  if (existing) {
    // Report whether the value actually differs, without showing either one.
    const current = existing[0].slice(k.length + 5).replace(/^'|'$/g, '');
    if (current === v) {
      report.push([k, 'already correct']);
      continue;
    }
    report.push([k, `REPLACE (was ${current.length} chars, now ${v.length})`]);
    yaml = yaml.replace(line, `'${k}': '${v}'`);
  } else {
    report.push([k, `ADD (${v.length} chars)`]);
    yaml = yaml.replace(/\n?$/, '\n') + `'${k}': '${v}'\n`;
  }
}

// The bot is dry-run by default everywhere. It must be opted in explicitly, and
// production is the one place that genuinely should post.
if (!/^'SAGE_X_LIVE':/m.test(yaml)) {
  yaml = yaml.replace(/\n?$/, '\n') + `'SAGE_X_LIVE': 'true'\n`;
  report.push(['SAGE_X_LIVE', 'ADD (true — the bot posts for real)']);
}

for (const [k, what] of report) console.log(`  ${k.padEnd(24)} ${what}`);

// A malformed line takes the whole service down on next deploy, so check the
// shape of every line before writing rather than trusting the edits above.
const bad = yaml
  .split('\n')
  .filter(Boolean)
  .filter((l) => !/^'[A-Z0-9_]+': /.test(l));
if (bad.length) {
  console.error(`\nREFUSING TO WRITE — ${bad.length} malformed line(s):`);
  bad.forEach((b) => console.error('  ' + b.split(':')[0]));
  process.exit(1);
}

if (!WRITE) {
  console.log('\nDRY RUN — pass --write to apply.');
  process.exit(0);
}

fs.writeFileSync(YAML, yaml);
console.log(`\nwrote ${YAML} (${yaml.split('\n').filter(Boolean).length} keys). Redeploy to apply.`);
