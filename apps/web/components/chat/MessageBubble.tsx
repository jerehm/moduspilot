import type { Message } from 'ai';
import Image from 'next/image';
import { motion } from 'framer-motion';
import ApprovalCard from './ApprovalCard';
import DraftOptionsCard from './DraftOptionsCard';
import OptionsCard from './OptionsCard';
import ImageCard from './ImageCard';
import DocumentCard from './DocumentCard';
import ChartCard from './ChartCard';
import ToolActivity, { toolCallsFor } from './ToolActivity';
import MarkdownMessage from './MarkdownMessage';
import PartBoundary from './PartBoundary';
import AiCheckButton from './AiCheckButton';
import { blockProgress } from '@/lib/chat/block-progress';
import { modelName, modelProvider } from '@/lib/models';
import { ProviderLogo } from '@/components/marketing/BrandLogos';
import { readAttachmentsAnnotation } from '@/lib/chat/annotations';

type BlockType = 'approval' | 'draft_options' | 'options' | 'image' | 'document' | 'chart';
type Part =
  | { type: 'text'; value: string }
  | { type: BlockType; value: string };

function parseBlocks(content: string): Part[] {
  const parts: Part[] = [];
  // draft_options is listed before options for readability; the ``` prefix and the
  // trailing \n make the two unambiguous regardless of alternation order.
  const regex = /```(approval|draft_options|options|image|document|chart)\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: content.slice(last, match.index) });
    parts.push({ type: match[1] as BlockType, value: match[2].trim() });
    last = match.index + match[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) });
  return parts;
}

// Exported because the blank-answer check in ChatWindow MUST read a message the
// same way the bubble that renders it does. It used to inline
// `typeof content === 'string' ? content : ''`, so array-shaped content counted
// as empty and could raise "the model returned an empty response" over a reply
// that had rendered perfectly well.
export function extractTextContent(content: Message['content']): string {
  if (typeof content === 'string') return content;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = content as any[];
  if (Array.isArray(parts)) {
    return parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text as string)
      .join('\n');
  }
  return '';
}

function ModusAvatar() {
  return (
    <div className="w-7 h-7 rounded-full surface-tint border border-tint flex items-center justify-center shrink-0 mt-0.5">
      <Image src="/logo.png" alt="MODUS" width={14} height={14} className="opacity-75 dark:hidden" />
      <Image src="/logo-dark.png" alt="MODUS" width={14} height={14} className="opacity-75 hidden dark:block" />
    </div>
  );
}

// "MODUS routed this to <model>" chip shown above an Auto-routed assistant answer.
//
// `replacedModel` turns it into the honest version of the same chip: when the
// model the user picked couldn't answer and the failover chain used another one,
// it reads "<pick> was unavailable · answered by <model>". The live notice in
// ChatWindow is cleared on the next message, so this chip is what carries that
// fact in history — it is the thing that used to persist the false claim.
function RoutedChip({ modelId, replacedModel, manualPick }: { modelId: string; replacedModel?: string; manualPick?: boolean }) {
  const prefix = replacedModel
    ? `${modelName(replacedModel)} was unavailable · answered by`
    : manualPick
      ? 'Answered by'
      : 'Modus routed this to';
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-1.5 text-xs text-muted"
    >
      <span>{prefix}</span>
      <motion.span
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26, delay: 0.05 }}
        className="inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-md border border-border bg-panel text-text font-medium"
      >
        <ProviderLogo provider={modelProvider(modelId)} className="w-3 h-3" />
        {modelName(modelId)}
      </motion.span>
    </motion.div>
  );
}

// "Searched the web · N results" — shown when the server actually injected web
// results into this answer.
//
// Web search used to leave no trace at all: results arrived with a "cite sources
// naturally" instruction attached, and nothing on the reply said the web had been
// consulted, so a web-sourced answer looked exactly like the model's own
// knowledge. Deliberately reads "Searched the web", not "Web search on" — this
// states what HAPPENED, not what a setting says.
function WebSearchChip({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-1.5 text-xs text-muted"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0" aria-hidden>
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span>Searched the web · {count} {count === 1 ? 'result' : 'results'}</span>
    </motion.div>
  );
}

function MessageBubbleInner({
  message,
  isStreaming = false,
  showAvatar = true,
  routedModel,
  replacedModel,
  manualPick = false,
  webSearchCount = 0,
  attachments,
  followingUserText,
  isLatest = true,
  onAppend,
  onApproved,
}: {
  message: Message;
  isStreaming?: boolean;
  showAvatar?: boolean;
  routedModel?: string;
  /** The model the user picked, when it couldn't answer and routedModel replaced it. */
  replacedModel?: string;
  /** True when routedModel names a model the user manually switched this thread to. */
  manualPick?: boolean;
  /** How many web results the server injected into this answer. 0 = none. */
  webSearchCount?: number;
  /** Files this message carried (live session). Falls back to the saved annotation. */
  attachments?: { name: string; text: string }[];
  /** The user turn right after this one, if any — how a card knows it was answered. */
  followingUserText?: string;
  /** False once a later message exists, which closes any question this one asked. */
  isLatest?: boolean;
  onAppend?: (text: string) => void;
  onApproved?: (text: string) => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    const text = extractTextContent(message.content);
    const hasImage = Array.isArray(message.content) && message.content.some(p => p.type === 'image');
    const files = attachments && attachments.length ? attachments : readAttachmentsAnnotation(message);
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-end"
      >
        <div className="max-w-[72%] space-y-1.5">
          {hasImage && (
            <div className="surface-tint border border-tint rounded-xl px-3 py-2 text-xs text-brand text-right">
              Image attached
            </div>
          )}
          {files.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {files.map((f, i) => (
                <div key={i} className="surface-tint border border-tint rounded-lg px-2.5 py-1.5 text-xs text-brand flex items-center gap-1.5 max-w-full">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span className="truncate">{f.name}</span>
                </div>
              ))}
            </div>
          )}
          {text && (
            <div className="bg-brand text-white rounded-2xl rounded-br-sm px-4 py-2.5">
              <p className="text-sm leading-relaxed">{text}</p>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  const rawText = extractTextContent(message.content);
  const toolCalls = toolCallsFor(message);

  // '```options' is not a substring of '```draft_options' (the backticks sit
  // directly before the tag), so these two never collide.
  const hasSpecialBlock = rawText.includes('```approval') || rawText.includes('```draft_options') || rawText.includes('```options') || rawText.includes('```image') || rawText.includes('```document') || rawText.includes('```chart');
  // Real progress counted off the streaming JSON — never a timer. Returns null
  // percent when the model didn't declare a total, and the bar goes
  // indeterminate rather than showing an invented number.
  const progress = isStreaming && hasSpecialBlock ? blockProgress(rawText) : null;
  const streamingText = hasSpecialBlock
    ? rawText
        .replace(/```(approval|draft_options|options|image|document|chart)[\s\S]*?```/g, '')
        .replace(/```(approval|draft_options|options|image|document|chart)[\s\S]*$/g, '')
        .trimEnd()
    : rawText;

  const parts = isStreaming
    ? [{ type: 'text' as const, value: streamingText }]
    : parseBlocks(rawText);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex justify-start gap-2.5"
    >
      {showAvatar ? <ModusAvatar /> : <div className="w-7 shrink-0" aria-hidden />}
      <div className="max-w-[85%] min-w-0 space-y-3">
        {webSearchCount > 0 && <WebSearchChip count={webSearchCount} />}
        {routedModel && <RoutedChip modelId={routedModel} replacedModel={replacedModel} manualPick={manualPick} />}
        <PartBoundary label="tools" resetKey={toolCalls.length}>
          <ToolActivity calls={toolCalls} />
        </PartBoundary>
        {parts.map((part, i) => (
          <PartBoundary key={i} label={part.type} resetKey={part.value}>
          {          part.type === 'approval' ? (
            // messageId:blockIndex — stable across reloads and tabs because the
            // message id is persisted with the thread, unlike the mount-order
            // counter this replaced.
            <ApprovalCard key={i} raw={part.value} cardId={`${message.id}:${i}`} onApproved={onApproved} />
          ) : part.type === 'draft_options' ? (
            <DraftOptionsCard
              key={i}
              raw={part.value}
              onAppend={onAppend ?? (() => {})}
              locked={!isLatest}
              followingUserText={followingUserText}
            />
          ) : part.type === 'options' ? (
            <OptionsCard
              key={i}
              raw={part.value}
              onAppend={onAppend ?? (() => {})}
              locked={!isLatest}
              followingUserText={followingUserText}
            />
          ) : part.type === 'image' ? (
            <ImageCard key={i} raw={part.value} />
          ) : part.type === 'document' ? (
            <DocumentCard key={i} raw={part.value} />
          ) : part.type === 'chart' ? (
            <ChartCard key={i} raw={part.value} />
          ) : part.value.trim() ? (
            <MarkdownMessage key={i}>{part.value}</MarkdownMessage>
          ) : null}
          </PartBoundary>
        ))}
        {/* AI-text check: only on a finished assistant answer with enough prose
            to score, and never on a card-only message (approval/options/etc). */}
        {!isStreaming && !hasSpecialBlock && rawText.trim().length >= 40 && (
          <AiCheckButton text={rawText.trim()} />
        )}
        {progress && (
          <div className="px-4 py-3 border border-border bg-panel rounded-xl min-w-[240px]">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="flex items-center gap-2 text-xs text-muted">
                <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
                {progress.label}
                {progress.detail && <span className="text-muted/60">· {progress.detail}</span>}
              </span>
              {progress.percent !== null && (
                <span className="text-xs font-medium text-brand tabular-nums">{progress.percent}%</span>
              )}
            </div>
            <div className="h-1 w-full rounded-full bg-text/[0.08] overflow-hidden">
              {progress.percent !== null ? (
                <motion.div
                  className="h-full rounded-full bg-brand"
                  initial={false}
                  animate={{ width: `${progress.percent}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                />
              ) : (
                // No declared total: a looping sweep, which promises nothing.
                <motion.div
                  className="h-full w-1/3 rounded-full bg-brand/70"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

type MessageBubbleProps = Parameters<typeof MessageBubbleInner>[0];

/** One bad message renders a notice in its place instead of taking down the thread. */
export default function MessageBubble(props: MessageBubbleProps) {
  return (
    <PartBoundary label="message" resetKey={props.message.content}>
      <MessageBubbleInner {...props} />
    </PartBoundary>
  );
}
