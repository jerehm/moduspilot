'use client';

import { useWorkspacePanel } from '@/components/workspace/workspace-context';
import { wsApi } from '@/lib/workspace-client';
import { SlashMenu, ResourcePicker, useCatalog, slashQuery, matchPrompts, enterPicksPrompt } from './PluginCatalog';
import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '@/components/ui/Tooltip';
import { auth } from '@/lib/firebase';
import { extForAudioType } from '@/lib/audio-format';
import ModelSwitcher from '@/components/chat/ModelSwitcher';
import PresetPicker from '@/components/chat/PresetPicker';
import FilePreviewModal from '@/components/chat/FilePreviewModal';
import ModelPicker, { MIN_PICKED } from '@/components/chat/ModelPicker';
import type { Preset } from '@/hooks/useUserSettings';

interface ConnectedServices {
  google: boolean; notion: boolean; slack: boolean; github: boolean; contacts: boolean;
}

interface Props {
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onVoiceTranscript: (text: string) => void;
  onImageAttach: (base64: string, mimeType: string) => void;
  isLoading: boolean;
  /** While streaming, the send button becomes Stop and calls this. */
  onStop?: () => void;
  attachedImage: string | null;
  onClearImage: () => void;
  attachedFiles?: { name: string; text: string }[];
  onFileAttach?: (name: string, text: string) => void;
  onRemoveFile?: (index: number) => void;
  webSearchOn?: boolean;
  onToggleWebSearch?: () => void;
  compareOn?: boolean;
  onToggleCompare?: () => void;
  /** The user's picked model ids for multi-model. */
  compareSelected?: string[];
  onToggleCompareModel?: (id: string) => void;
  connectedServices?: ConnectedServices | null;
  /** Puts text in the composer and focuses it, for menu items that start an ask. */
  onSeedPrompt?: (text: string) => void;
  /** MODUS asked a question and it's still unanswered — the composer says so. */
  openQuestion?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** When set (signed-in users), shows the model switcher. */
  plan?: string;
  modelChoice?: string;
  onModelChange?: (value: string) => void;
  /** Saved prompt presets and which are active for this thread. */
  presets?: Preset[];
  activePresetIds?: Set<string>;
  onTogglePreset?: (id: string) => void;
  /**
   * True when the composer is docked at the bottom of a conversation. The
   * hairline above it separates it from the transcript — but on the opening
   * screen the composer floats in the middle of an empty pane, where that same
   * rule reads as a stray line drawn across the page.
   */
  docked?: boolean;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|xml|tsx?|jsx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|css|scss|html?|sh|bash|zsh|sql|toml|ini|env)$/i;
const MAX_CHARS = 24000;

export default function ChatInput({
  input, onChange, onSubmit, onVoiceTranscript, onImageAttach, isLoading, onStop,
  attachedImage, onClearImage, attachedFiles = [], onFileAttach, onRemoveFile,
  webSearchOn = false, onToggleWebSearch, compareOn = false, onToggleCompare,
  compareSelected = [], onToggleCompareModel,
  connectedServices, onSeedPrompt, openQuestion = false, textareaRef, plan, modelChoice, onModelChange,
  presets = [], activePresetIds, onTogglePreset,
  docked = true,
}: Props) {
  const workspacePanel = useWorkspacePanel();
  // Plugin prompts on "/" and plugin resources in the + menu (phase 6).
  const slash = slashQuery(input);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [slashClosedFor, setSlashClosedFor] = useState<string | null>(null);
  const [slashPick, setSlashPick] = useState(0);
  const [recording, setRecording] = useState(false);
  // Between stopping the recording and the transcript arriving the mic looked
  // idle for seconds, which reads as broken (11-03 audit round 3).
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const catalog = useCatalog(slash !== null || menuOpen);
  const slashMenuShown = slash !== null && slashClosedFor !== input && !!catalog && matchPrompts(catalog.prompts, slash).length > 0;
  const [extracting, setExtracting] = useState<string | null>(null);
  const [attachError, setAttachError] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const imageRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Auto-grow the composer. The textarea is rows={1} and never grew, so typing
  // past one line scrolled the earlier lines out of view with no scrollbar — the
  // top of what you typed just vanished. Keyed on `input` (not an onInput handler)
  // so it also resizes for programmatic sets: voice transcripts and seeded
  // prompts. Reset to 'auto' first so it shrinks back to one row after send.
  // 144px === max-h-36; past that the textarea scrolls internally (overflow-y-auto).
  useEffect(() => {
    const el = textareaRef?.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input, textareaRef]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashMenuShown && e.key === 'Escape') { e.preventDefault(); setSlashClosedFor(input); return; }
    // Enter on "/name" uses that prompt instead of sending "/name" to the
    // model, but only when it clearly names one (see enterPicksPrompt).
    if (slashMenuShown && e.key === 'Enter' && !e.shiftKey && catalog && slash !== null && enterPicksPrompt(catalog.prompts, slash)) {
      e.preventDefault(); setSlashPick(n => n + 1); return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.closest('form')?.requestSubmit();
    }
  }

  async function toggleRecording() {
    if (transcribing) return;
    if (recording) { mediaRef.current?.stop(); setRecording(false); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError('Microphone access denied.');
      setTimeout(() => setVoiceError(''), 3000);
      return;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      // Unsupported browser: this threw uncaught and the mic just did nothing.
      stream.getTracks().forEach(t => t.stop());
      setVoiceError('Voice input is not supported in this browser.');
      setTimeout(() => setVoiceError(''), 4000);
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      // 🪤 THE FILENAME IS LOAD-BEARING. Whisper detects the audio format from the
      // extension, and FormData names an unnamed Blob "blob" — no extension — so
      // every web/desktop transcription was rejected before it ever reached the
      // model. The server's `|| 'audio.webm'` fallback could not save it either,
      // because "blob" is truthy. Send a real name.
      //
      // Take the type from the RECORDER, not a hardcoded 'audio/webm': Safari's
      // MediaRecorder emits audio/mp4, and labelling that as webm mislabels it
      // just as badly as sending no name at all.
      const type = recorder.mimeType?.split(';')[0] || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      const form = new FormData();
      form.append('audio', blob, `audio.${extForAudioType(type)}`);
      setTranscribing(true);
      // A hung upload used to leave nothing on screen until the server gave up.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
          body: form,
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({})) as { text?: string; error?: string };
        // Surface failures (rate limit, audio too large, transcription error) and
        // empty transcriptions instead of silently doing nothing — the user just
        // recorded and stopped, so no feedback reads as a broken feature.
        if (!res.ok || !data.text) {
          setVoiceError(data.error || 'Could not transcribe that. Try again.');
          setTimeout(() => setVoiceError(''), 4000);
          return;
        }
        onVoiceTranscript(data.text);
      } catch {
        setVoiceError('Could not transcribe that. Try again.');
        setTimeout(() => setVoiceError(''), 4000);
      } finally {
        clearTimeout(timer);
        setTranscribing(false);
      }
    };
    recorder.start();
    mediaRef.current = recorder;
    setRecording(true);
  }

  // Keep the original file in the chat's workspace (uploads/), so it shows in
  // Files and can be previewed later. The model still reads the extracted
  // text; this never blocks or fails the attach.
  function keepOriginal(file: File) {
    const ws = workspacePanel?.workspaceId;
    if (!ws) return;
    void wsApi.upload(ws, file).then(() => workspacePanel?.refresh()).catch(() => {});
  }

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    keepOriginal(file);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header, base64] = result.split(',');
      const mimeType = header.match(/data:(.*);/)?.[1] || 'image/jpeg';
      onImageAttach(base64, mimeType);
    };
    reader.readAsDataURL(file);
  }

  async function handleDocChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onFileAttach) return;
    setAttachError('');
    setExtracting(file.name);
    try {
      const isText = file.type.startsWith('text/') || TEXT_EXT.test(file.name);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isDocx = /\.docx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      // Match spreadsheets by extension (not the ms-excel MIME, which some
      // browsers also report for .csv — those must stay on the text path).
      const isSheet = /\.(xlsx|xls)$/i.test(file.name)
        || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      let text = '';
      if (isText && !isDocx && !isSheet) {
        text = (await file.text()).slice(0, MAX_CHARS);
        if (!text.trim()) throw new Error('That file looks empty.');
      } else if (isPdf || isDocx || isSheet) {
        const token = await auth.currentUser?.getIdToken();
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/attachments/extract', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not read that file.');
        text = data.text as string;
      } else {
        throw new Error('Unsupported file. Try a PDF, Word, Excel, text, or CSV file.');
      }
      onFileAttach(file.name, text);
      keepOriginal(file);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not read that file.');
      setTimeout(() => setAttachError(''), 4000);
    } finally {
      setExtracting(null);
    }
  }

  // Multi-model with one model isn't a comparison — block the send rather than
  // fan out to a single column.
  const compareReady = !compareOn || compareSelected.length >= MIN_PICKED;
  const canSend = !isLoading && compareReady
    && (!!input.trim() || !!attachedImage || attachedFiles.length > 0);

  const services: { key: keyof ConnectedServices; label: string }[] = [
    { key: 'google', label: 'Google' }, { key: 'notion', label: 'Notion' },
    { key: 'slack', label: 'Slack' }, { key: 'github', label: 'GitHub' }, { key: 'contacts', label: 'Contacts' },
  ];

  return (
    <form onSubmit={onSubmit} className={docked ? 'border-t border-border' : ''}>
      <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
      <input ref={docRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={handleDocChange} />

      <div className="max-w-4xl mx-auto px-4 md:px-8 py-4">
        {/* Multi-model picker — visible while the mode is on, so the chosen set
            is in front of you at the moment you send. */}
        {onToggleCompareModel && plan && (
          <ModelPicker
            open={compareOn}
            selected={compareSelected}
            plan={plan}
            onToggleModel={onToggleCompareModel}
            onClose={() => onToggleCompare?.()}
          />
        )}

        {/* Attachment chips. Each one is clickable and opens a preview, so a
            wrong file is caught before sending rather than after. */}
        {(attachedImage || attachedFiles.length > 0 || extracting) && (
          <div className="mb-2 flex flex-wrap gap-2">
            <AnimatePresence initial={false} mode="popLayout">
              {attachedImage && (
                <motion.div
                  key="image"
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="relative inline-block group/img"
                >
                  <button type="button" onClick={() => setImagePreviewOpen(true)} aria-label="Preview attached image">
                    <img src={`data:image/jpeg;base64,${attachedImage}`} alt="attachment" className="h-16 w-16 object-cover rounded-lg border border-border transition-transform group-hover/img:scale-[1.04]" />
                  </button>
                  <button type="button" onClick={onClearImage} aria-label="Remove image" className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-border rounded-full text-muted text-xs flex items-center justify-center hover:text-text transition-colors">×</button>
                </motion.div>
              )}
              {attachedFiles.map((f, i) => (
                <motion.button
                  key={`${f.name}-${i}`}
                  type="button"
                  layout
                  initial={{ opacity: 0, scale: 0.85, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.85, y: 4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => setPreviewIndex(i)}
                  title={`${f.name} · click to preview`}
                  className="flex items-center gap-2 bg-panel border border-border hover-border-tint rounded-lg pl-2 pr-1.5 py-1.5 max-w-[220px] transition-colors group/file"
                >
                  <span className="text-muted group-hover/file:text-brand transition-colors"><FileIcon /></span>
                  <span className="text-xs text-text truncate">{f.name}</span>
                  <span className="text-[9px] text-muted/70 shrink-0 tabular-nums">
                    {f.text.length > 999 ? `${Math.round(f.text.length / 1000)}k` : f.text.length}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onRemoveFile?.(i); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onRemoveFile?.(i); } }}
                    className="text-muted hover:text-red-400 shrink-0 cursor-pointer transition-colors"
                    aria-label={`Remove ${f.name}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3 h-3"><path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" /></svg>
                  </span>
                </motion.button>
              ))}
              {extracting && (
                <motion.span
                  key="extracting"
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.16 }}
                  className="flex items-center gap-2 bg-panel border border-border rounded-lg px-2.5 py-1.5"
                >
                  <span className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-muted truncate max-w-[160px]">Reading {extracting}…</span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        )}

        <FilePreviewModal
          file={previewIndex !== null ? attachedFiles[previewIndex] ?? null : null}
          onClose={() => setPreviewIndex(null)}
          onRemove={previewIndex !== null ? () => onRemoveFile?.(previewIndex) : undefined}
        />

        <AnimatePresence>
          {imagePreviewOpen && attachedImage && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setImagePreviewOpen(false)}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            >
              <motion.img
                initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                src={`data:image/jpeg;base64,${attachedImage}`}
                alt="Attached image preview"
                onClick={e => e.stopPropagation()}
                className="max-w-full max-h-full rounded-xl shadow-2xl"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* relative: anchors the slash menu and resource picker above the box. */}
        <div className="relative flex gap-3 items-end bg-panel border border-border rounded-2xl px-4 py-3">
          {/* "+" menu */}
          <div className="relative shrink-0" ref={menuRef}>
            <Tooltip label="Attach & tools" side="top">
              <motion.button
                type="button"
                onClick={() => setMenuOpen(o => !o)}
                whileTap={{ scale: 0.88 }}
                transition={{ duration: 0.12 }}
                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${menuOpen ? 'surface-tint border-brand/40 text-brand' : 'border-border text-muted hover:text-text hover-border-tint'}`}
                aria-label="Attach and tools"
                aria-expanded={menuOpen}
              >
                {/* The + rotates into an × so the button reads as a toggle. */}
                <motion.svg
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"
                  animate={{ rotate: menuOpen ? 135 : 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                >
                  <path d="M12 5v14M5 12h14" />
                </motion.svg>
              </motion.button>
            </Tooltip>

            <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 6 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="absolute bottom-full mb-2 left-0 w-64 origin-bottom-left bg-panel border border-border rounded-xl shadow-2xl p-1.5 z-50"
              >
                <MenuItem onClick={() => { setMenuOpen(false); imageRef.current?.click(); }} icon={<PhotoIcon />} label="Attach photo" hint="PNG, JPG" />
                <MenuItem onClick={() => { setMenuOpen(false); docRef.current?.click(); }} icon={<FileIcon />} label="Attach file" hint="PDF, Word, text" />
                {onFileAttach && !!catalog?.resources.length && (
                  <MenuItem onClick={() => { setMenuOpen(false); setResourcesOpen(true); }} icon={<PlugIcon />} label="Add from a plugin" hint={`${catalog.resources.length} available`} />
                )}
                <div className="my-1 border-t border-border/60" />
                {/* Not a toggle like Web search, because it isn't a mode: the
                    model emits an ```image block straight off the prompt, so a
                    switch would be state that does nothing. The real problem is
                    that nobody knows it's there — so seed the ask and let them
                    finish the sentence. Same pattern as the empty-state chips. */}
                {onSeedPrompt && (
                  <MenuItem
                    onClick={() => { setMenuOpen(false); onSeedPrompt('Generate an image of '); }}
                    icon={<SparkleIcon />}
                    label="Generate an image"
                    hint="Describe it"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onToggleWebSearch?.()}
                  className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm text-text hover:bg-bg transition-colors"
                >
                  <span className={webSearchOn ? 'text-brand' : 'text-muted'}><SearchIcon /></span>
                  <span className="flex-1 text-left">Web search</span>
                  {/* Knob springs between ends instead of a linear slide. */}
                  <span className={`w-8 rounded-full relative flex items-center px-0.5 transition-colors ${webSearchOn ? 'bg-brand justify-end' : 'bg-border justify-start'}`} style={{ height: 18 }}>
                    <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} className="w-3.5 h-3.5 rounded-full bg-white" />
                  </span>
                </button>
                <div className="my-1 border-t border-border/60" />
                <div className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Connected</div>
                {connectedServices ? (
                  <div className="px-2.5 pb-1 flex flex-wrap gap-x-3 gap-y-1">
                    {services.map(s => (
                      <span key={s.key} className="flex items-center gap-1.5 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full ${connectedServices[s.key] ? 'bg-green-400' : 'bg-border'}`} />
                        <span className={connectedServices[s.key] ? 'text-text' : 'text-muted'}>{s.label}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="px-2.5 pb-1 text-xs text-muted">Loading…</div>
                )}
                <Link href="/capabilities" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm text-muted hover:text-text hover:bg-bg transition-colors">
                  <PlugIcon />
                  <span className="flex-1 text-left">Manage connections</span>
                  <span>→</span>
                </Link>
              </motion.div>
            )}
            </AnimatePresence>
          </div>

          {slashMenuShown && catalog && (
            <SlashMenu
              prompts={catalog.prompts}
              query={slash ?? ''}
              pickSignal={slashPick}
              onUse={(text) => { setSlashClosedFor(null); onSeedPrompt?.(text); }}
              onClose={() => setSlashClosedFor(input)}
            />
          )}
          {resourcesOpen && catalog && onFileAttach && (
            <ResourcePicker resources={catalog.resources} onAttach={onFileAttach} onClose={() => setResourcesOpen(false)} />
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={
              compareOn
                ? compareSelected.length >= MIN_PICKED
                  ? `Ask ${compareSelected.length} models at once…`
                  : `Pick at least ${MIN_PICKED} models…`
                : openQuestion
                  // The question above is waiting. Typing here is allowed — it
                  // just skips it — but the composer has to admit that, or the
                  // card gets stranded mid-stepper with no acknowledgement.
                  ? 'Answer above, or type to skip the question…'
                  : 'Talk to Modus...'
            }
            rows={1}
            className="flex-1 min-w-0 bg-transparent text-text text-sm placeholder-muted outline-none resize-none max-h-36 overflow-y-auto"
          />

          <AnimatePresence>
            {webSearchOn && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.8, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.8, width: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onToggleWebSearch?.()}
                className="shrink-0 overflow-hidden flex items-center gap-1 text-[11px] font-medium text-brand surface-tint border border-tint rounded-full pl-2 pr-1.5 py-1 whitespace-nowrap"
                title="Web search on, click to turn off"
              >
                <SearchIcon className="w-3 h-3" />
                Search
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-2.5 h-2.5"><path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" /></svg>
              </motion.button>
            )}
          </AnimatePresence>

          <Tooltip label={transcribing ? 'Transcribing...' : recording ? 'Stop recording' : 'Voice input'} side="top" className="shrink-0">
            <motion.button
              type="button"
              onClick={toggleRecording}
              disabled={transcribing}
              aria-label={transcribing ? 'Transcribing' : recording ? 'Stop recording' : 'Voice input'}
              whileTap={{ scale: 0.85 }}
              className={`relative shrink-0 transition-colors pb-0.5 ${recording ? 'text-red-400' : 'text-muted hover:text-text'}`}
            >
              {/* An expanding ring reads as "listening" better than a fade pulse. */}
              {recording && (
                <motion.span
                  className="absolute inset-0 -m-1 rounded-full bg-red-400/25"
                  animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              {transcribing ? (
                <span className="relative block w-5 h-5 p-[3px]">
                  <span className="block w-full h-full border-2 border-current border-t-transparent rounded-full animate-spin" />
                </span>
              ) : (
              <svg className="relative w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
              )}
            </motion.button>
          </Tooltip>

          {isLoading && onStop ? (
          <Tooltip label="Stop" side="top" className="shrink-0">
            {/* There was no way to stop a reply: the send button was a disabled
                spinner until the answer finished or the 45s watchdog fired. */}
            <motion.button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              whileTap={{ scale: 0.88 }}
              className="shrink-0 w-8 h-8 rounded-lg bg-brand flex items-center justify-center hover:bg-brand/90"
            >
              <span className="w-3 h-3 rounded-[3px] bg-white" />
            </motion.button>
          </Tooltip>
          ) : (
          <Tooltip label="Send" side="top" className="shrink-0">
            <motion.button
              type="submit"
              disabled={!canSend}
              whileTap={canSend ? { scale: 0.88 } : undefined}
              animate={canSend ? { scale: 1, opacity: 1 } : { scale: 0.94, opacity: 0.3 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="shrink-0 w-8 h-8 rounded-lg bg-brand flex items-center justify-center hover:bg-brand/90 disabled:cursor-default"
            >
              {/* Swaps to a spinner while streaming instead of just dimming. */}
              {isLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              )}
            </motion.button>
          </Tooltip>
          )}
        </div>

        {(voiceError || attachError) && <p className="text-center text-red-400 text-xs mt-1">{voiceError || attachError}</p>}
        <div className="flex items-center justify-between gap-3 mt-2">
          {plan && onModelChange ? (
            <div className="flex items-center gap-2 min-w-0">
              <ModelSwitcher
                value={modelChoice ?? 'auto'}
                onChange={onModelChange}
                plan={plan}
                compareOn={compareOn}
                onToggleCompare={onToggleCompare}
                compareCount={compareSelected.length}
              />
              {onTogglePreset && (
                <PresetPicker
                  presets={presets}
                  activeIds={activePresetIds ?? new Set()}
                  onToggle={onTogglePreset}
                />
              )}
              {workspacePanel?.workspaceId && (
                <button
                  type="button"
                  onClick={() => workspacePanel.toggleFiles()}
                  className="flex items-center gap-1.5 text-xs text-muted hover:text-text px-2.5 h-[26px] rounded-lg border border-border transition-colors"
                  aria-label="Files"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  Files
                </button>
              )}
            </div>
          ) : <span />}
          {/* Keyboard hint is desktop-only — no Enter/Shift key on mobile, and it
              overflowed the narrow composer row. */}
          <p className={`hidden ${workspacePanel?.isOpen ? '' : 'sm:block'} text-muted text-xs shrink-0`}>Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </form>
  );
}

function MenuItem({ onClick, icon, label, hint }: { onClick: () => void; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm text-text hover:bg-bg transition-colors">
      <span className="text-muted">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-[10px] text-muted/70">{hint}</span>}
    </button>
  );
}

function SparkleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16 2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3Z" /></svg>;
}

function PhotoIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
}
function FileIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;
}
function SearchIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
}
function PlugIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
}
