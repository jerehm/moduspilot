'use client';

import { auth } from '@/lib/firebase';
import type { FileMeta, VersionDoc } from '@/lib/workspace';

export type { FileMeta, VersionDoc };

async function headers(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post<T>(ws: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await headers()) },
    body: JSON.stringify({ ws, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const wsApi = {
  async list(ws: string): Promise<FileMeta[]> {
    const res = await fetch(`/api/workspace?ws=${encodeURIComponent(ws)}`, { headers: await headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not load files');
    return data.files ?? [];
  },
  read: (ws: string, path: string) => post<{ meta: FileMeta; content: string | null }>(ws, { op: 'read', path }),
  write: (ws: string, path: string, content: string) => post<{ meta: FileMeta }>(ws, { op: 'write', path, content }),
  rename: (ws: string, path: string, to: string) => post<{ meta: FileMeta }>(ws, { op: 'rename', path, to }),
  remove: (ws: string, path: string) => post<{ ok: true }>(ws, { op: 'delete', path }),
  versions: (ws: string, path: string) => post<{ versions: Omit<VersionDoc, 'content'>[] }>(ws, { op: 'versions', path }),
  version: (ws: string, path: string, n: number) => post<{ version: VersionDoc }>(ws, { op: 'version', path, n }),
  restore: (ws: string, path: string, n: number) => post<{ meta: FileMeta }>(ws, { op: 'restore', path, n }),
  async upload(ws: string, file: File, folder = 'uploads'): Promise<FileMeta> {
    const form = new FormData();
    form.set('ws', ws);
    form.set('folder', folder);
    form.set('file', file);
    const res = await fetch('/api/workspace/upload', { method: 'POST', headers: await headers(), body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? 'Upload failed');
    return data.meta;
  },
};

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
