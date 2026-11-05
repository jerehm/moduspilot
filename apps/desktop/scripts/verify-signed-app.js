// Refuses a Mac build that macOS would kill on launch.
//
// Runs as electron-builder's afterSign hook, and by hand on any .app:
//   node scripts/verify-signed-app.js "out/mac-arm64/MODUS Desktop.app"
//
// Why it exists (2026-11-04): 0.3.2, 0.4.0, 0.4.1 and 0.4.2 all shipped with a
// `keychain-access-groups` entitlement and no provisioning profile. Each one
// passed codesign --verify, notarization and Gatekeeper, and each one was
// SIGKILLed by the kernel the instant it started (exit 137, "The application
// can't be opened"). None of those checks run the app, so nothing caught it.
// This does two things they don't:
//   1. a RESTRICTED entitlement without an embedded provisioning profile fails
//   2. the signed binary is actually started, when it matches this Mac's
//      architecture, and must not be killed by a signal within a few seconds
const { execFileSync, spawn } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const path = require('path');

// Entitlements that macOS only honours on a Developer ID app when an embedded
// provisioning profile grants them. Without the profile the process is killed.
const RESTRICTED = [
  'keychain-access-groups',
  'com.apple.application-identifier',
  'com.apple.developer.team-identifier',
  'com.apple.developer.associated-domains',
  'com.apple.developer.icloud-container-identifiers',
  'com.apple.developer.icloud-services',
  'aps-environment',
  'com.apple.developer.aps-environment',
];

// electron-builder's Arch enum.
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function entitlementsOf(app) {
  try {
    return execFileSync('codesign', ['-d', '--entitlements', ':-', app], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function launchProbe(app) {
  const name = readdirSync(path.join(app, 'Contents/MacOS'))[0];
  const bin = path.join(app, 'Contents/MacOS', name);
  return new Promise((resolve) => {
    const child = spawn(bin, [], { stdio: 'ignore' });
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    child.on('exit', (code, signal) => finish({ code, signal }));
    child.on('error', (err) => finish({ code: null, signal: null, error: err.message }));
    // Still alive after 4s means it got past exec and started. SIGKILL, because a tray app ignores SIGTERM and would keep the single-instance lock.
    setTimeout(() => {
      if (!done) { child.kill('SIGKILL'); finish({ alive: true }); }
    }, 4000);
  });
}

async function verify(app, arch) {
  const problems = [];
  const ents = entitlementsOf(app);
  const hasProfile = existsSync(path.join(app, 'Contents/embedded.provisionprofile'));
  for (const key of RESTRICTED) {
    if (ents.includes(`<key>${key}</key>`) || ents.includes(`"${key}"`)) {
      if (!hasProfile) {
        problems.push(`restricted entitlement "${key}" with no Contents/embedded.provisionprofile: macOS kills this app at launch`);
      }
    }
  }

  if (!arch || arch === process.arch) {
    const r = await launchProbe(app);
    if (r.alive) console.log(`[verify-signed-app] launch probe: started and stayed up (${path.basename(app)})`);
    else if (r.signal || r.code === 137) problems.push(`launch probe: killed at start (signal ${r.signal ?? 'SIGKILL'}, code ${r.code})`);
    else if (r.error) problems.push(`launch probe: could not start (${r.error})`);
    else console.log(`[verify-signed-app] launch probe: exited cleanly with code ${r.code} (another instance is probably running)`);
  } else {
    console.log(`[verify-signed-app] launch probe skipped: ${arch} build on a ${process.arch} Mac (entitlement check still ran)`);
  }

  if (problems.length) {
    throw new Error(`[verify-signed-app] REFUSING ${app}\n  - ${problems.join('\n  - ')}`);
  }
  console.log(`[verify-signed-app] OK ${app}`);
}

// electron-builder afterSign hook.
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const name = `${context.packager.appInfo.productFilename}.app`;
  await verify(path.join(context.appOutDir, name), ARCH[context.arch]);
};

if (require.main === module) {
  const app = process.argv[2];
  if (!app) { console.error('usage: node scripts/verify-signed-app.js <path/to/App.app>'); process.exit(2); }
  verify(path.resolve(app)).catch((e) => { console.error(e.message); process.exit(1); });
}
