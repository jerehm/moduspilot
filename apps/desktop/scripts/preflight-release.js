// Fails the release BEFORE an 8-minute build if the credentials it needs are
// missing from the environment.
//
// This exists because of a real, silent failure (2026-07-22): `npm run release`
// ran to completion with none of these set. electron-builder does not treat a
// missing credential as an error — MacTargetHelper.notarizeIfProvided() calls
// log.warn("skipped macOS notarization") and returns. The result looked like a
// successful release but was a signed-but-UNNOTARIZED build that was never
// published: no latest-mac.yml, no GitHub release, and artifacts macOS
// Gatekeeper blocks on any machine other than the one that built them
// ("Apple cannot check it for malicious software"). Shipping that is worse than
// shipping nothing, and nothing in the output says so.
//
// The three notarization paths below mirror MacTargetHelper.getNotarizeOptions
// exactly, in its order — keep them in sync if electron-builder changes.

// The nicest path: store the app-specific password in the keychain ONCE, then
// only ever export APPLE_KEYCHAIN_PROFILE. App-specific passwords do not
// expire, and Apple never shows one twice, so this is also how you stop losing it:
//   xcrun notarytool store-credentials modus-notary \
//     --apple-id app@joinfitr.com --team-id 8KF5J7X9BU --password '<pw>'
const NOTARIZE_PATHS = [
  {
    name: 'keychain profile',
    vars: ['APPLE_KEYCHAIN_PROFILE'],
    hint: 'APPLE_KEYCHAIN_PROFILE=modus-notary (after `xcrun notarytool store-credentials`)',
  },
  {
    name: 'Apple ID + app-specific password',
    vars: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    hint: 'APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (team is 8KF5J7X9BU)',
  },
  {
    name: 'App Store Connect API key',
    vars: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
    hint: 'APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER',
  },
];

const set = (v) => Boolean(process.env[v]);
const satisfied = NOTARIZE_PATHS.find((p) => p.vars.every(set));

// A half-filled path is worse than an empty one: electron-builder throws on
// some combinations and silently skips on others, so call it out either way.
const partial = NOTARIZE_PATHS.filter((p) => p.vars.some(set) && !p.vars.every(set));

const problems = [];

if (!satisfied) {
  problems.push(
    'Notarization: no complete credential set. Use ONE of:\n' +
      NOTARIZE_PATHS.map((p) => `        - ${p.hint}`).join('\n') +
      (partial.length
        ? `\n      Partially set (missing ${partial
            .flatMap((p) => p.vars.filter((v) => !set(v)))
            .join(', ')}) — electron-builder would skip or throw.`
        : '')
  );
}

if (!set('GH_TOKEN') && !set('GITHUB_TOKEN')) {
  problems.push('Publishing: GH_TOKEN is unset — run `export GH_TOKEN=$(gh auth token)`');
}

if (problems.length > 0) {
  console.error('\n  Release aborted — the build would produce nothing usable:\n');
  for (const p of problems) console.error(`    • ${p}\n`);
  console.error(
    '  electron-builder does NOT fail on missing credentials. It skips\n' +
      '  notarization and/or publishing and still exits 0, leaving artifacts\n' +
      '  that Gatekeeper blocks. Export the above and re-run.\n'
  );
  process.exit(1);
}

console.log(`[preflight] notarization via ${satisfied.name}; publish token present`);

// User copy rule (no em dash, en dash or emoji). Cheap, and a release is the
// last chance to catch it. See scripts/check-copy.js.
require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, 'check-copy.js')], { stdio: 'inherit' });
