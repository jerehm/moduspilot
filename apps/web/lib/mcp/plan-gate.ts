import { NextResponse } from 'next/server';
import { adminDb } from '../firebase-admin';
import { hasActiveAccess } from '../plan';

/**
 * Connectors (MCP) are a paid feature (his call, 2026-11-04). Free accounts can
 * see the directory but not connect, browse a connector or run its tools.
 * Records a free account already has are kept, just unused until they upgrade.
 */
export async function mcpAllowed(uid: string): Promise<boolean> {
  const snap = await adminDb.collection('users').doc(uid).get();
  return hasActiveAccess(snap.data());
}

export const MCP_PLAN_REQUIRED = () => NextResponse.json(
  { error: 'Connectors are part of MODUS and PILOT. Upgrade to connect one.', code: 'plan_required' },
  { status: 402 },
);

/** Both add routes share one ceiling, so the OAuth path can't skip it. */
export const MAX_MCP_SERVERS = 10;
