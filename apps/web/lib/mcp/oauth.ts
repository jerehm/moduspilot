import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { adminDb } from '../firebase-admin';
import { seal, open } from '../secret-box';
import { invalidateMcpServers } from '../mcp-servers';

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
  /**
   * A client registered by a consent that has not finished yet (a start from
   * another origin, e.g. dev, which shares Firestore). It only replaces
   * `client` once that consent returns tokens, so an abandoned consent no
   * longer swaps the client under a grant that still works.
   */
  pendingClient?: OAuthClientInformationMixed;
  pendingRedirectUri?: string;
}

/** httpOnly cookie binding a consent round trip to the browser that started it. */
export const MCP_NONCE_COOKIE = 'mcp_oauth_nonce';

export type McpAuthStatus = 'connected' | 'pending' | 'needs_reconnect';

function blobRef(uid: string, serverId: string) {
  return adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId).collection('private').doc('oauth');
}

function serverRef(uid: string, serverId: string) {
  return adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId);
}

export async function setMcpAuthStatus(uid: string, serverId: string, status: McpAuthStatus): Promise<void> {
  await serverRef(uid, serverId).set({ authStatus: status }, { merge: true });
  // The server list is cached 60s; without this chat kept retrying a dead
  // connector (or ignoring a revived one) until the cache ran out.
  invalidateMcpServers(uid);
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

  /** The access token this provider started from, to tell if another request refreshed since. */
  private loadedAccess: string | undefined;

  private async load(): Promise<OAuthBlob> {
    if (this.blob) return this.blob;
    this.blob = await this.readStored();
    this.loadedAccess = this.blob.tokens?.access_token;
    return this.blob;
  }

  private async readStored(): Promise<OAuthBlob> {
    const snap = await blobRef(this.uid, this.serverId).get();
    return (snap.exists ? open<OAuthBlob>(snap.data()?.blob as string) : null) ?? {};
  }

  /**
   * Patch the STORED record in a transaction. Chat, the catalog and widget
   * routes each hold their own provider for one connector; writing back a
   * whole stale copy let one request erase what another had just saved.
   */
  private async save(patch: Partial<OAuthBlob>): Promise<void> {
    const ref = blobRef(this.uid, this.serverId);
    this.blob = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const cur = (snap.exists ? open<OAuthBlob>(snap.data()?.blob as string) : null) ?? {};
      const next = { ...cur, ...patch };
      tx.set(ref, { blob: seal(next) });
      return next;
    });
  }

  /**
   * True when someone else already replaced the tokens we started from. Two
   * requests refreshing one rotating refresh token at once: the loser gets
   * invalid_grant, and the SDK then deletes the tokens and asks for consent.
   * When the winner's fresh tokens are already stored, that would sign the
   * user out for nothing.
   */
  private async refreshedElsewhere(): Promise<boolean> {
    const stored = await this.readStored();
    const access = stored.tokens?.access_token;
    if (access && access !== this.loadedAccess) {
      this.blob = stored;
      return true;
    }
    return false;
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
    if (this.opts.interactive && b.redirectUri !== this.redirectUri) {
      return b.pendingRedirectUri === this.redirectUri ? b.pendingClient : undefined;
    }
    return b.client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    const b = await this.load();
    // A grant from another origin still works: park the new client until this
    // consent returns tokens (saveTokens promotes it).
    if (this.opts.interactive && b.client && b.tokens && b.redirectUri !== this.redirectUri) {
      await this.save({ pendingClient: client, pendingRedirectUri: this.redirectUri });
      return;
    }
    await this.save({ client, redirectUri: this.redirectUri, pendingClient: undefined, pendingRedirectUri: undefined });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Some servers omit refresh_token on refresh; keep the one we had.
    const b = await this.load();
    const prev = b.tokens;
    const merged = { ...tokens, refresh_token: tokens.refresh_token ?? prev?.refresh_token };
    // Tokens from a consent made with a parked client: that client is now the one.
    const promote = this.opts.interactive && b.pendingClient && b.pendingRedirectUri === this.redirectUri
      ? { client: b.pendingClient, redirectUri: b.pendingRedirectUri, pendingClient: undefined, pendingRedirectUri: undefined }
      : {};
    await this.save({ ...promote, tokens: merged, tokensAt: Date.now() });
    this.loadedAccess = merged.access_token;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.authorizationUrl = url;
    if (!this.opts.interactive && !(await this.refreshedElsewhere())) {
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
    if (scope === 'all') {
      if (await this.refreshedElsewhere()) return;
      return this.save({ client: undefined, tokens: undefined, verifier: undefined, redirectUri: undefined });
    }
    if (scope === 'client') return this.save({ client: undefined, redirectUri: undefined });
    if (scope === 'tokens') {
      if (await this.refreshedElsewhere()) return;
      return this.save({ tokens: undefined });
    }
    if (scope === 'verifier') return this.save({ verifier: undefined });
  }
}

/** The callback every connector registers. Same origin as the request. */
export function mcpRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/mcp/oauth/callback`;
}
