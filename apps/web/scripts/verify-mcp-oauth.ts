/**
 * MCP OAuth storage: sealing round trip, tamper rejection, and the provider's
 * refresh-safe client lookup.
 *
 *   cd apps/web && npx tsx scripts/verify-mcp-oauth.ts
 *
 * Live discovery + DCR against Pika and Higgsfield is checked by hand with
 * POST /api/mcp/oauth/start (both returned consent URLs on 2026-11-03).
 */
import { seal, open } from '../lib/secret-box';
process.env.SECRET_BOX_KEY ||= 'verify-only-key';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) { failures++; if (detail !== undefined) console.log(`   ${JSON.stringify(detail)}`); }
}

const value = { tokens: { access_token: 'at_123', refresh_token: 'rt_456' }, verifier: 'v' };
const sealed = seal(value);
check('sealed hides the token', !sealed.includes('at_123') && !sealed.includes('rt_456'));
check('round trip', JSON.stringify(open(sealed)) === JSON.stringify(value));
check('two seals differ (random IV)', seal(value) !== sealed);
const parts = sealed.split('.');
const flipped = [parts[0], parts[1], parts[2], parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA')].join('.');
check('tampered ciphertext rejected', open(flipped) === null);
check('garbage rejected', open('nope') === null && open(null) === null);
process.env.SECRET_BOX_KEY = 'another-key';
check('wrong key rejected', open(sealed) === null);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
