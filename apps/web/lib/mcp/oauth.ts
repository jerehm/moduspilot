import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { adminDb } from '../firebase-admin';
import { seal, open } from '../secret-box';

/**
 * MCP OAuth 2.1 for connectors that sign in (Pika, Higgsfield, Linear...).
 *
 * The SDK's `auth()` does the protocol: protected-resource discovery, auth
 * server metadata, dynamic client registration, PKCE, code exchange and
 * refresh. This provider is only the storage it needs, made stateless-safe for
 * serverless: every read and write goes to Firestore, sealed with secret-box.
 *
 * Storage: users/{uid}/mcpServers/{id}/private/oauth  { blob: <sealed> }
 * Two levels under the user doc, so firestore.rules' default deny keeps it
 * away from clients (the one-level wildcard there does not reach it).
 */

interface OAuthBlob {
  /** The redirect the client was registered with. A different one = re-register. */
  redirectUri?: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  tokensAt?: number;
  verifier?: string;
}

export type McpAuthStatus = 'connected' | 'pending' | 'needs_reconnect';

function blobRef(uid: string, serverId: string) {
  return adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId).collection('private').doc('oauth');
}

function serverRef(uid: string, serverId: string) {
  return adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId);
}

export async function setMcpAuthStatus(uid: string, serverId: string, status: McpAuthStatus): Promise<void> {
  await serverRef(uid, serverId).set({ authStatus: status }, { merge: true });
}

export async function deleteMcpOAuth(uid: string, serverId: string): Promise<void> {
  await blobRef(uid, serverId).delete().catch(() => {});
}

export class FirestoreMcpOAuthProvider implements OAuthClientProvider {
  private blob: OAuthBlob | null = null;
  /** Set when the SDK wants the user sent to the auth server. */
  authorizationUrl: URL | null = null;

  constructor(
    private readonly uid: string,
    private readonly serverId: string,
    private readonly redirectUri: string,
    private readonly opts: {
      /** Signed state for the consent round trip. Omit in chat (no consent there). */
      state?: string;
      /** Chat mode: a needed consent means the stored grant is dead. */
      interactive: boolean;
    },
  ) {}

  private async load(): Promise<OAuthBlob> {
    if (this.blob) return this.blob;
    const snap = await blobRef(this.uid, this.serverId).get();
    this.blob = (snap.exists ? open<OAuthBlob>(snap.data()?.blob as string) : null) ?? {};
    return this.blob;
  }

  private async save(patch: Partial<OAuthBlob>): Promise<void> {
    const cur = await this.load();
    this.blob = { ...cur, ...patch };
    await blobRef(this.uid, this.serverId).set({ blob: seal(this.blob) });
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'MODUS',
      client_uri: 'https://moduspilot.com',
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Public client: the secret would live on a server anyway, and PKCE is
      // the protection. Servers that insist on a secret return one from DCR,
      // and the SDK then uses it.
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.opts.state ?? '';
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const b = await this.load();
    // Registered for another origin (dev vs prod share Firestore): register
    // again, but only when starting a consent. A chat refresh never redirects,
    // and re-registering there would orphan the tokens the old client holds.
    if (this.opts.interactive && b.redirectUri !== this.redirectUri) return undefined;
    return b.client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.save({ client, redirectUri: this.redirectUri });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Some servers omit refresh_token on refresh; keep the one we had.
    const prev = (await this.load()).tokens;
    const merged = { ...tokens, refresh_token: tokens.refresh_token ?? prev?.refresh_token };
    await this.save({ tokens: merged, tokensAt: Date.now() });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.authorizationUrl = url;
    if (!this.opts.interactive) {
      // In chat there is nobody to send to a consent screen. The grant expired
      // or was revoked, so say so on the connector instead of failing silently.
      await setMcpAuthStatus(this.uid, this.serverId, 'needs_reconnect');
    }
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.save({ verifier });
  }

  async codeVerifier(): Promise<string> {
    const v = (await this.load()).verifier;
    if (!v) throw new Error('No PKCE verifier stored for this connector');
    return v;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') return this.save({ client: undefined, tokens: undefined, verifier: undefined, redirectUri: undefined });
    if (scope === 'client') return this.save({ client: undefined, redirectUri: undefined });
    if (scope === 'tokens') return this.save({ tokens: undefined });
    if (scope === 'verifier') return this.save({ verifier: undefined });
  }
}

/** The callback every connector registers. Same origin as the request. */
export function mcpRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/mcp/oauth/callback`;
}
