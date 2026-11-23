#!/usr/bin/env node
/**
 * Copy guard for the desktop app. Same rule as apps/web/scripts/check-copy.mjs:
 * no em dash, no en dash, no emoji in prose, in anything a user reads.
 *
 * apps/web's guard never looked at apps/desktop, which is how the Screen
 * Recording panel shipped "then relaunch — macOS only applies..." (found
 * 2026-11-23).
 *
 * What it reads:
 *   - src/**\/*.ts: string and template literals, via the TypeScript AST, so
 *     comments are never flagged. Arguments to log.* and console.* are skipped:
 *     log lines are for us, not the user.
 *   - assets/*.html: visible text between tags, and the string literals of
 *     inline <script> blocks (same AST pass). HTML, CSS and JS comments are
 *     skipped.
 *
 * Run: node scripts/check-copy.js   (exits 1 on any finding). Also runs in
 * scripts/preflight-release.js, so a release cannot ship a banned character.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const EM_DASH = '—';
const EN_DASH = '–';
// Emoji ranges only. Arrows are allowed, as in the web guard.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

const findings = [];

function check(text, where, kind) {
  if (!text) return;
  const isProse = /[A-Za-z]+(?:['’A-Za-z]*\s+[A-Za-z]['’A-Za-z]*){2,}/.test(text);
  let reason = '';
  if (text.includes(EM_DASH)) reason = 'em dash';
  else if (text.includes(EN_DASH)) reason = 'en dash';
  else if (isProse && EMOJI.test(text)) reason = 'emoji in prose';
  if (!reason) return;
  findings.push(`${where}  ${reason}  ${kind}: "${text.replace(/\s+/g, ' ').trim().slice(0, 80)}"`);
}

/** log.info(...), log.error(...), console.warn(...) and the like. */
function isLogCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const obj = node.expression.expression;
  return ts.isIdentifier(obj) && (obj.text === 'log' || obj.text === 'console');
}

function scanScript(src, fileName, lineOffset) {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rel = path.relative(ROOT, fileName);
  const visit = (node) => {
    if (isLogCall(node)) return;
    let text = null;
    let kind = '';
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { text = node.text; kind = 'string'; }
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) { text = node.text; kind = 'template'; }
    if (text != null) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      check(text, `${rel}:${line + 1 + lineOffset}`, kind);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

const lineAt = (src, index) => src.slice(0, index).split('\n').length;

function scanHtml(file) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  // Inline scripts: AST pass, so JS comments are skipped.
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    scanScript(m[1], file, lineAt(src, m.index) - 1);
  }
  // Visible text: drop scripts, styles and comments (blanked so line numbers
  // stay right), then read what sits between tags.
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const visible = src
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  for (const m of visible.matchAll(/>([^<]+)</g)) {
    if (m[1].trim()) check(m[1], `${rel}:${lineAt(visible, m.index)}`, 'html');
  }
  // Attributes people read: title, placeholder, aria-label, alt.
  for (const m of visible.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"]*)"/g)) {
    check(m[1], `${rel}:${lineAt(visible, m.index)}`, 'attribute');
  }
}

const tsFiles = walk(path.join(ROOT, 'src'), '.ts');
const htmlFiles = walk(path.join(ROOT, 'assets'), '.html');
for (const f of tsFiles) scanScript(fs.readFileSync(f, 'utf8'), f, 0);
for (const f of htmlFiles) scanHtml(f);

if (findings.length) {
  console.error(`\ncheck-copy: ${findings.length} banned character(s) in desktop copy:\n`);
  for (const f of findings) console.error('  ' + f);
  console.error('\nRewrite the copy (comma, colon, period or a new sentence). Comments and log lines are exempt.\n');
  process.exit(1);
}
console.log(`check-copy: clean (${tsFiles.length} ts, ${htmlFiles.length} html).`);
