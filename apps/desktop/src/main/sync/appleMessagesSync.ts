import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import log from 'electron-log';
import { buildContactLookup } from './appleContacts';
import type { ConversationRecord, SourceRead } from '../../shared/types';

const CHAT_DB_PATH = path.join(os.homedir(), 'Library/Messages/chat.db');
const CORE_DATA_EPOCH_OFFSET_SECONDS = 978307200; // 2001-01-01 vs Unix epoch
// Cap on how many full transcripts we ship, NOT on the id list — see the note
// on MAX_NOTES in appleNotesSync.ts.
const MAX_CHATS = 30;
const MESSAGES_PER_CHAT = 12;
const MAX_BODY_CHARS = 8000;
/** Mirrors ALL_IDS_CEILING in apps/web/lib/desktop/reconcile.ts. */
const ALL_IDS_CEILING = 5000;

export class FullDiskAccessError extends Error {
  constructor() {
    super('Full Disk Access not granted for Messages');
    this.name = 'FullDiskAccessError';
  }
}

export function isFullDiskAccessGranted(): boolean {
  try {
    fs.accessSync(CHAT_DB_PATH, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// Same lock-contention issue as Apple Notes (see appleNotesSync.ts) — Messages.app
// holds chat.db open near-constantly, so a direct open can hang. Snapshot first.
function snapshotChatDb(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modus-messages-'));
  const dest = path.join(tmpDir, 'chat.db');
  try {
    fs.copyFileSync(CHAT_DB_PATH, dest);
    for (const suffix of ['-wal', '-shm']) {
      const src = CHAT_DB_PATH + suffix;
      if (fs.existsSync(src)) fs.copyFileSync(src, dest + suffix);
    }
  } catch (err) {
    // A failed copy (disk full) left a partial 100MB+ copy behind on every
    // 5 minute sync, filling the disk. The caller never learned the dir.
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  }
  return dest;
}

// Modern macOS stores message text in an NSArchiver "typedstream" blob
// (attributedBody) rather than the plain `text` column whenever the message
// has any rich attributes (links, mentions, even just being part of a thread)
// — empirically ~90%+ of recent messages on a real machine. This is NOT a
// binary plist (no bplist00 magic) — it's the older NXTypedStream format,
// which encodes object class names and string contents the same way: a
// single length byte (when < 0x80) followed by that many raw bytes. Rather
// than write a full typedstream/class-graph decoder, scan every byte
// position for a plausible length-prefixed printable-ASCII run and keep the
// longest one that isn't a known NSKeyedArchiver/typedstream class or
// attribute-key name — same "find the longest real text, ignore the
// metadata" strategy that worked for Apple Notes' protobuf.
// Known limitation: only handles ASCII text (typedstream encodes non-ASCII
// strings differently); messages that are pure emoji/non-Latin text will
// come back empty and get skipped.
const TYPEDSTREAM_STOPLIST = new Set([
  'streamtyped', 'NSAttributedString', 'NSObject', 'NSString', 'NSMutableString',
  'NSDictionary', 'NSMutableDictionary', 'NSNumber', 'NSValue', 'NSArray', 'NSMutableArray',
  'NSMutableAttributedString', 'NSData', 'NSMutableData', 'NSURL', 'NSUUID',
  '__kIMMessagePartAttributeName', '__kIMFileTransferGUIDAttributeName',
  '__kIMLinkAttributeName', '__kIMDataDetectedAttributeName',
  '__kIMOneTimeCodeAttributeName', '__kIMCalendarEventAttributeName',
  '__kIMTextEffectAttributeName', '__kIMTextBoldAttributeName',
  '__kIMTextItalicAttributeName', '__kIMTextUnderlineAttributeName',
  '__kIMTextStrikethroughAttributeName', '__kIMMentionConfirmedMentionAttributeName',
]);

function isPrintableAsciiRun(buf: Buffer, start: number, length: number): boolean {
  for (let i = start; i < start + length; i++) {
    const b = buf[i];
    if (!((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x09)) return false;
  }
  return true;
}

// 1-2 byte "matches" are reliably typedstream framing artifacts (single-byte
// type tags that happen to land on a printable ASCII value), not real
// message text — observed directly ('@', 'iI') winning by default on
// messages with no real ASCII content. Requiring length >= 3 trades away a
// few genuine very-short replies ("ok", "no") for reliably rejecting that
// noise; a message that decodes to nothing real correctly comes back empty
// and gets skipped, rather than showing fake content.
const MIN_DECODED_TEXT_LENGTH = 3;

function decodeAttributedBody(buf: Buffer): string {
  let best = '';
  for (let pos = 0; pos < buf.length; pos++) {
    const length = buf[pos];
    if (length === 0 || length >= 0x80) continue;
    if (pos + 1 + length > buf.length) continue;
    if (!isPrintableAsciiRun(buf, pos + 1, length)) continue;
    const text = buf.toString('ascii', pos + 1, pos + 1 + length);
    if (text.length < MIN_DECODED_TEXT_LENGTH || TYPEDSTREAM_STOPLIST.has(text)) continue;
    if (text.length > best.length) best = text;
  }
  return best;
}

function idForChat(chatIdentifier: string): string {
  return crypto.createHash('sha1').update(chatIdentifier).digest('hex').slice(0, 24);
}

interface RawChatRow {
  chatRowId: number;
  chatIdentifier: string;
  displayName: string | null;
  lastDate: number;
}

interface RawMessageRow {
  text: string | null;
  attributedBody: Buffer | null;
  isFromMe: number;
  handleId: string | null;
  date: number;
}

export function readRecentMessages(): SourceRead<ConversationRecord> {
  if (!isFullDiskAccessGranted()) throw new FullDiskAccessError();

  let snapshotDir: string;
  let snapshotPath: string;
  try {
    snapshotPath = snapshotChatDb();
    snapshotDir = path.dirname(snapshotPath);
  } catch (err) {
    log.error('[appleMessages] failed to snapshot chat.db', err);
    throw new FullDiskAccessError();
  }

  let db: Database.Database;
  try {
    db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    log.error('[appleMessages] failed to open chat.db snapshot', err);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    throw new FullDiskAccessError();
  }

  try {
    // item_type = 0 is a normal text message — excludes group-action system
    // messages (member added/removed, name changes, etc.).
    const chats = db
      .prepare(
        `SELECT
           c.ROWID as chatRowId,
           c.chat_identifier as chatIdentifier,
           c.display_name as displayName,
           MAX(m.date) as lastDate
         FROM chat c
         JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
         JOIN message m ON m.ROWID = cmj.message_id
         WHERE m.item_type = 0
         GROUP BY c.ROWID
         ORDER BY lastDate DESC
         LIMIT ?`
      )
      .all(MAX_CHATS) as RawChatRow[];

    // Lossless id list, same snapshot, no LIMIT. Deduped through a Set because
    // Messages keeps SEPARATE chat rows for the same chat_identifier across
    // iMessage and SMS, and idForChat collapses them onto one doc id.
    const allIds = Array.from(
      new Set(
        (
          db
            .prepare(
              `SELECT DISTINCT c.chat_identifier as chatIdentifier
               FROM chat c
               JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
               JOIN message m ON m.ROWID = cmj.message_id
               WHERE m.item_type = 0 AND c.chat_identifier IS NOT NULL`
            )
            .all() as { chatIdentifier: string }[]
        ).map((r) => idForChat(r.chatIdentifier))
      )
    );

    const messageStmt = db.prepare(
      `SELECT m.text as text, m.attributedBody as attributedBody, m.is_from_me as isFromMe, h.id as handleId, m.date as date
       FROM message m
       JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       LEFT JOIN handle h ON h.ROWID = m.handle_id
       WHERE cmj.chat_id = ? AND m.item_type = 0
       ORDER BY m.date DESC
       LIMIT ?`
    );

    const participantStmt = db.prepare(
      `SELECT h.id as id FROM chat_handle_join chj
       JOIN handle h ON h.ROWID = chj.handle_id
       WHERE chj.chat_id = ?`
    );

    // Best-effort phone/email → contact-name lookup from the local Contacts DB.
    // Returns an empty lookup (resolve → null) if Contacts can't be read, so
    // transcripts just fall back to raw handle IDs rather than failing.
    const contacts = buildContactLookup();

    const records: ConversationRecord[] = [];
    for (const chat of chats) {
      const rows = messageStmt.all(chat.chatRowId, MESSAGES_PER_CHAT) as RawMessageRow[];
      const lines: string[] = [];
      // rows are newest-first — reverse for a chronological transcript
      for (const row of rows.slice().reverse()) {
        let text = row.text ?? '';
        if (!text && row.attributedBody) {
          try {
            text = decodeAttributedBody(row.attributedBody);
          } catch (err) {
            log.error('[appleMessages] failed to decode attributedBody', err);
          }
        }
        if (!text) continue;
        const sender = row.isFromMe
          ? 'You'
          : (row.handleId ? (contacts.resolve(row.handleId) ?? row.handleId) : 'Unknown');
        lines.push(`${sender}: ${text}`);
      }
      if (lines.length === 0) continue;

      let title = chat.displayName;
      if (!title) {
        const participants = (participantStmt.all(chat.chatRowId) as { id: string }[]).map(
          (p) => contacts.resolve(p.id) ?? p.id
        );
        title = participants.length > 0 ? participants.join(', ') : chat.chatIdentifier;
      }

      records.push({
        id: idForChat(chat.chatIdentifier),
        title: title.slice(0, 100),
        body: lines.join('\n').slice(0, MAX_BODY_CHARS),
        source: 'desktop-imessage',
        modifiedAt: (chat.lastDate / 1e9 + CORE_DATA_EPOCH_OFFSET_SECONDS) * 1000,
      });
    }
    const complete = allIds.length <= ALL_IDS_CEILING;
    if (!complete) {
      log.error(`[appleMessages] ${allIds.length} threads exceeds the ${ALL_IDS_CEILING} id ceiling — no deletions will be reconciled`);
    }
    log.info(`[appleMessages] decoded ${records.length} conversation(s) of ${allIds.length} threads`);
    return { records, allIds, complete };
  } finally {
    db.close();
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}
