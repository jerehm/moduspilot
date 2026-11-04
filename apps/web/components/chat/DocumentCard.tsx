'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { markdownToHtml, printDocument, docKey } from '@/lib/document';
import DocumentEditor from './DocumentEditor';
import { useWorkspacePanel } from '@/components/workspace/workspace-context';
import { wsApi } from '@/lib/workspace-client';

/** documents/<title>.md, kept to safe filename characters. */
function docPath(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document';
  return `documents/${name}.md`;
}

interface DocPayload { title?: string; markdown?: string }

// MODUS document canvas. Renders the full document inline (capped with a fade),
// opens a workspace to edit it with a live preview, exports a real PDF, and
// persists edits to Firestore (users/{uid}/documents/{key}) so they survive
// reloads — keyed by the original block content so the same doc reloads edited.
export default function DocumentCard({ raw }: { raw: string }) {
  let data: DocPayload;
  try { data = JSON.parse(raw); } catch { data = { markdown: raw }; }
  const origTitle = (data.title ?? 'Document').trim();
  const origMarkdown = (data.markdown ?? '').trim();
  const key = docKey(origTitle, origMarkdown);

  const [title, setTitle] = useState(origTitle);
  const [markdown, setMarkdown] = useState(origMarkdown);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const ws = useWorkspacePanel();
  const [opening, setOpening] = useState(false);

  // Move the document into the chat's workspace, where it gets versions,
  // history and the side panel editor. The first open writes it; later opens
  // reuse the file, so edits made in Files are what you see next time.
  async function openInFiles() {
    if (!ws?.workspaceId) return;
    const path = docPath(title);
    setOpening(true);
    try {
      await wsApi.read(ws.workspaceId, path).catch(async () => { await wsApi.write(ws.workspaceId!, path, markdown); });
      ws.openFile(path);
    } catch { /* the card still works on its own */ }
    finally { setOpening(false); }
  }
  const loadedRef = useRef(false);

  // Load any persisted edits for this document once.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'users', uid, 'documents', key)).then(snap => {
      const d = snap.data();
      if (d) { if (d.title) setTitle(d.title as string); if (typeof d.markdown === 'string') setMarkdown(d.markdown); }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(newTitle: string, newMarkdown: string) {
    setTitle(newTitle);
    setMarkdown(newMarkdown);
    const uid = auth.currentUser?.uid;
    if (uid) {
      setSaving(true);
      try {
        await setDoc(doc(db, 'users', uid, 'documents', key), {
          title: newTitle, markdown: newMarkdown, updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch { /* edit stays in session even if the write fails */ }
      finally { setSaving(false); }
    }
    setEditing(false);
  }

  function copy() {
    navigator.clipboard?.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="border border-border rounded-2xl overflow-hidden bg-panel max-w-md"
      >
        <div className="px-4 py-3 flex items-center gap-2.5 border-b border-border">
          <div className="w-8 h-8 rounded-lg surface-tint border border-tint flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-brand">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-text truncate flex-1">{title}</p>
        </div>

        {/* Full inline render, capped with a fade */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={e => { if (e.key === 'Enter') setEditing(true); }}
          className="block w-full text-left relative max-h-72 overflow-hidden group cursor-pointer"
        >
          <div className="modus-doc px-5 py-4" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-panel to-transparent pointer-events-none" />
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-muted group-hover:text-brand transition-colors">Open document</span>
        </div>

        <div className="px-4 py-2.5 flex items-center gap-3 border-t border-border">
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-brand hover:underline">Edit</button>
          {ws?.workspaceId && (
            <button onClick={openInFiles} disabled={opening} className="text-xs text-muted hover:text-text transition-colors disabled:opacity-50">{opening ? 'Opening…' : 'Open in Files'}</button>
          )}
          <button onClick={() => printDocument(title, markdown)} className="text-xs text-muted hover:text-text transition-colors">Download PDF</button>
          <button onClick={copy} className="text-xs text-muted hover:text-text transition-colors">{copied ? 'Copied' : 'Copy text'}</button>
        </div>
      </motion.div>

      <DocumentEditor
        open={editing}
        title={title}
        markdown={markdown}
        saving={saving}
        onClose={() => setEditing(false)}
        onSave={handleSave}
      />
    </>
  );
}
