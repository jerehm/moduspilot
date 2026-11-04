import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getMcpServers } from '@/lib/mcp-servers';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { uid } = auth;

  // The stored header is a credential; the browser only needs to know one exists.
  const servers = (await getMcpServers(uid)).map(({ authHeader, redirectUri: _r, ...rest }) => ({
    ...rest,
    hasAuthHeader: !!authHeader,
  }));
  return NextResponse.json({ servers });
}
