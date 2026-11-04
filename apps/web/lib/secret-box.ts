import crypto from 'crypto';

/**
 * AES-256-GCM sealing for secrets we must store (connector OAuth tokens).
 *
 * Firestore is not a secret store: anything readable by the Admin SDK lands in
 * backups and exports in the clear. Sealed values are useless without the key.
 *
 * Key: SECRET_BOX_KEY when set (rotate via SECRET_BOX_KEY_OLD, see openKeys), else derived from
 * FIREBASE_PRIVATE_KEY the same way lib/oauth-state.ts derives its HMAC key, so
 * no new env var is needed to ship. The derivation label keeps it distinct from
 * the state-signing key.
 */
function derive(secret: string): Buffer {
  return crypto.createHash('sha256').update('modus-secret-box-v1:').update(secret).digest();
}

function key(): Buffer {
  const secret = process.env.SECRET_BOX_KEY || process.env.FIREBASE_PRIVATE_KEY || '';
  if (!secret) throw new Error('secret-box: no key material available');
  return derive(secret);
}

/**
 * Every key a sealed value may have been made with, current first. Rotating
 * used to wipe every stored grant: open() only knew the new key, returned null,
 * and the next save overwrote the record. To rotate, move the old value to
 * SECRET_BOX_KEY_OLD and set the new one; values re-seal on their next save.
 */
function openKeys(): Buffer[] {
  const out = [key()];
  for (const s of [process.env.SECRET_BOX_KEY_OLD, process.env.SECRET_BOX_KEY ? process.env.FIREBASE_PRIVATE_KEY : undefined]) {
    if (s) out.push(derive(s));
  }
  return out;
}

/** Seal a JSON value → "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/** Open a sealed value. Returns null on any tamper, wrong key or bad format. */
export function open<T = unknown>(sealed: string | null | undefined): T | null {
  if (!sealed || typeof sealed !== 'string') return null;
  const [v, ivB, tagB, ctB] = sealed.split('.');
  if (v !== 'v1' || !ivB || !tagB || ctB === undefined) return null;
  for (const k of openKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
      const pt = Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]);
      return JSON.parse(pt.toString('utf8')) as T;
    } catch { /* try the next key */ }
  }
  return null;
}
