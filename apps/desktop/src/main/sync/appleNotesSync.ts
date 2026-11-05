import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import log from 'electron-log';
import type { NoteRecord, SourceRead } from '../../shared/types';

const NOTE_STORE_PATH = path.join(
  os.homedir(),
  'Library/Group Containers/group.com.apple.notes/NoteStore.sqlite'
);

const MAX_BODY_CHARS = 20000;
// Cap on how many full note BODIES we ship per sync. Deliberately NOT a cap on
// the id list below: the server reconciles deletions against allIds, so a
// capped id list would delete every note past the cutoff on every sync.
const MAX_NOTES = 500;
// Refuse rather than truncate past this. Mirrors ALL_IDS_CEILING in
// apps/web/lib/desktop/reconcile.ts.
const ALL_IDS_CEILING = 5000;

export class FullDiskAccessError extends Error {
  constructor() {
    super('Full Disk Access not granted for Apple Notes');
    this.name = 'FullDiskAccessError';
  }
}

export function isFullDiskAccessGranted(): boolean {
  try {
    fs.accessSync(NOTE_STORE_PATH, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readVarint(buf: Buffer, pos: number): [value: number, next: number] {
  let result = 0;
  let shift = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result, pos];
}

// fatal:true throws on any invalid byte sequence — unlike Buffer#toString('utf8'),
// which silently substitutes U+FFFD and lets binary garbage (attachment blobs,
// style/font hashes) masquerade as decodable text. Strict validation here is
// what actually filters those out (a printable-ratio check alone isn't enough,
// since U+FFFD itself reads as "printable").
const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function tryDecodeStrictUtf8(segment: Buffer): string | null {
  try {
    return strictUtf8Decoder.decode(segment);
  } catch {
    return null;
  }
}

function isMostlyPrintable(text: string): boolean {
  let printable = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || code === 0x09 || code === 0x2028 || code === 0x2029 || (code >= 0x20 && code !== 0x7f)) printable++;
  }
  return text.length > 0 && printable / text.length > 0.85;
}

// Apple Notes' on-disk body is an undocumented protobuf schema that drifts
// across macOS versions (see plan's scope-cut note). Rather than hardcode
// exact field numbers, recursively scan every length-delimited field for
// valid, mostly-printable UTF-8 text — empirically the note's full plain
// text is always the longest match (attribute-run/style entries never embed
// text this long). Verified against real notes ranging 6-3045 chars.
// Budget guard: notes with attachments (images/audio/PDF) embed raw binary
// that isn't actually protobuf-structured. Walking it as if it were nested
// messages can misparse arbitrary bytes as deeply-nested submessages, and
// recursion blows up combinatorially on a single note — observed firsthand
// (one real note hung the whole sync for 2+ minutes). A hard call budget
// bounds total work regardless of depth/width; legitimate note text is
// reliably found within a few dozen calls (verified against real notes),
// so a generous budget never affects real extraction.
const MAX_WALK_CALLS = 20000;

function collectTextCandidates(buf: Buffer, pos: number, end: number, out: string[], budget: { calls: number }): void {
  while (pos < end) {
    if (budget.calls++ > MAX_WALK_CALLS) return;
    let tag: number;
    [tag, pos] = readVarint(buf, pos);
    const wireType = tag & 0x7;
    if (wireType === 0) {
      [, pos] = readVarint(buf, pos);
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 2) {
      let length: number;
      [length, pos] = readVarint(buf, pos);
      if (length < 0 || pos + length > end) return; // malformed/truncated — stop walking this message
      const segment = buf.subarray(pos, pos + length);
      pos += length;
      const text = tryDecodeStrictUtf8(segment);
      if (text && text.length >= 2 && isMostlyPrintable(text)) out.push(text);
      collectTextCandidates(segment, 0, segment.length, out, budget);
    } else if (wireType === 5) {
      pos += 4;
    } else {
      return; // unknown wire type — stop walking this message
    }
  }
}

function decodeNoteBody(gzipped: Buffer): string {
  const raw = zlib.gunzipSync(gzipped);
  const candidates: string[] = [];
  collectTextCandidates(raw, 0, raw.length, candidates, { calls: 0 });
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0].replace(/[\u2028\u2029]/g, '\n');
}

// CoreData/Cocoa epoch (2001-01-01) is this many seconds after the Unix epoch.
const CORE_DATA_EPOCH_OFFSET_SECONDS = 978307200;

interface RawNoteRow {
  identifier: string;
  title: string | null;
  folderTitle: string | null;
  dataPk: number | null;
  modified: number | null;
}

interface RawDataRow {
  ZDATA: Buffer | null;
  ZCRYPTOINITIALIZATIONVECTOR: Buffer | null;
}

// Opening the live NoteStore.sqlite directly hangs while Notes.app's
// background indexer holds it open (WAL lock contention) — copying it (plus
// its -wal/-shm sidecars, which hold not-yet-checkpointed recent edits) to a
// scratch dir first and reading the copy avoids touching the live lock
// entirely. Standard approach for reading any actively-used SQLite/WAL file.
function snapshotNoteStore(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modus-notes-'));
  const dest = path.join(tmpDir, 'NoteStore.sqlite');
  try {
    fs.copyFileSync(NOTE_STORE_PATH, dest);
    for (const suffix of ['-wal', '-shm']) {
      const src = NOTE_STORE_PATH + suffix;
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

export function readAppleNotes(): SourceRead<NoteRecord> {
  if (!isFullDiskAccessGranted()) throw new FullDiskAccessError();

  let snapshotDir: string;
  let snapshotPath: string;
  try {
    snapshotPath = snapshotNoteStore();
    snapshotDir = path.dirname(snapshotPath);
  } catch (err) {
    log.error('[appleNotes] failed to snapshot NoteStore.sqlite', err);
    throw new FullDiskAccessError();
  }

  let db: Database.Database;
  try {
    db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    log.error('[appleNotes] failed to open NoteStore.sqlite snapshot', err);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    throw new FullDiskAccessError();
  }

  try {
    // ZFOLDERTYPE = 1 is the Recently Deleted folder — exclude trashed notes.
    const rows = db
      .prepare(
        `SELECT
           n.ZIDENTIFIER as identifier,
           n.ZTITLE1 as title,
           f.ZTITLE2 as folderTitle,
           n.ZNOTEDATA as dataPk,
           n.ZMODIFICATIONDATE1 as modified
         FROM ZICCLOUDSYNCINGOBJECT n
         LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON f.Z_PK = n.ZFOLDER
         WHERE n.ZNOTEDATA IS NOT NULL
           AND (f.ZFOLDERTYPE IS NULL OR f.ZFOLDERTYPE != 1)
         ORDER BY n.ZMODIFICATIONDATE1 DESC
         LIMIT ?`
      )
      .all(MAX_NOTES) as RawNoteRow[];

    // The lossless id list, on the SAME snapshot (a second snapshotNoteStore()
    // would re-copy a file that runs to hundreds of MB).
    //
    // ELIGIBILITY PREDICATES ONLY — deliberately nothing that can fail per row.
    // A note whose protobuf fails to decode, or whose walk exhausts
    // MAX_WALK_CALLS, is skipped from `records` but MUST stay in this list, or
    // the server would hard-delete it on a heuristic and it would flap back in
    // next sync. Conversely a password-locked note (crypto IV present) and a
    // Recently Deleted note are BOTH correctly absent here, which is what makes
    // locking a note retract the plaintext already sitting in Firestore.
    const allIds = (
      db
        .prepare(
          `SELECT n.ZIDENTIFIER AS identifier
           FROM ZICCLOUDSYNCINGOBJECT n
           LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON f.Z_PK = n.ZFOLDER
           LEFT JOIN ZICNOTEDATA d          ON d.Z_PK = n.ZNOTEDATA
           WHERE n.ZNOTEDATA IS NOT NULL
             AND n.ZIDENTIFIER IS NOT NULL
             AND (f.ZFOLDERTYPE IS NULL OR f.ZFOLDERTYPE != 1)
             AND d.ZCRYPTOINITIALIZATIONVECTOR IS NULL`
        )
        .all() as { identifier: string }[]
    ).map((r) => r.identifier);

    const dataStmt = db.prepare(
      'SELECT ZDATA, ZCRYPTOINITIALIZATIONVECTOR FROM ZICNOTEDATA WHERE Z_PK = ?'
    );

    const records: NoteRecord[] = [];
    for (const row of rows) {
      if (row.dataPk == null || !row.identifier) continue;
      const dataRow = dataStmt.get(row.dataPk) as RawDataRow | undefined;
      if (!dataRow?.ZDATA) continue;
      if (dataRow.ZCRYPTOINITIALIZATIONVECTOR) {
        log.info('[appleNotes] skipping password-locked note', row.identifier);
        continue;
      }

      let body: string;
      try {
        body = decodeNoteBody(dataRow.ZDATA);
      } catch (err) {
        log.error('[appleNotes] failed to decode note body', row.identifier, err);
        continue;
      }
      if (!body) continue;

      records.push({
        id: row.identifier,
        title: (row.title ?? body.split('\n')[0] ?? 'Untitled').slice(0, 100),
        body: body.slice(0, MAX_BODY_CHARS),
        folder: row.folderTitle ?? undefined,
        source: 'desktop-apple-notes',
        modifiedAt: row.modified != null ? (row.modified + CORE_DATA_EPOCH_OFFSET_SECONDS) * 1000 : undefined,
      });
    }
    const complete = allIds.length <= ALL_IDS_CEILING;
    if (!complete) {
      log.error(`[appleNotes] ${allIds.length} notes exceeds the ${ALL_IDS_CEILING} id ceiling — no deletions will be reconciled`);
    }
    log.info(`[appleNotes] decoded ${records.length} note(s) of ${allIds.length} eligible`);
    return { records, allIds, complete };
  } finally {
    db.close();
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}
