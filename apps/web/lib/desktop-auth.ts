import { createHash, randomBytes } from 'crypto';

/**
 * MODUS Desktop signs in through the user's real browser, not inside the app.
 *
 * Why: Google/Apple sign-in in the Electron window can't use the passkeys a
 * person already has (they live in iCloud Keychain or Chrome, which an app
 * can't read), so Touch ID never appeared and Google fell back to "use your
 * phone over Bluetooth". Safari/Chrome have those passkeys and saved logins.
 *
 * Flow: desktop opens /desktop/signin?state=S in the browser -> the signed-in
 * browser page asks /api/desktop/auth-code for a one-time code -> hands it to
 * the app via modusdesktop://auth?code=C&state=S -> the app checks S is the one
 * IT started, loads /desktop/complete?code=C, which trades the code at
 * /api/desktop/auth-exchange for a Firebase custom token.
 *
 * Only a SHA-256 of the code is stored, it lives 2 minutes and works once.
 */
export const AUTH_CODE_COLLECTION = 'desktopAuthCodes';
export const AUTH_CODE_TTL_MS = 2 * 60 * 1000;

// 32 random bytes as base64url = 43 chars. Both the code and the desktop's state.
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newCode(): string {
  return randomBytes(32).toString('base64url');
}

export function codeId(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
