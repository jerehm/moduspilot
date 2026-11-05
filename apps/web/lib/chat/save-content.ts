import type { Message } from 'ai';

/**
 * Firestore caps a document at 1 MB, and a conversation is ONE document. A
 * base64 image saved inline (a phone photo is 2-4 MB) made every later save of
 * that thread throw, for good: the retry banner could never succeed and a new
 * chat stayed empty and vanished from the list. Images above this size are
 * replaced by a short text note in the SAVED copy only; the live turn still
 * sends the real image to the model.
 */
const MAX_INLINE_IMAGE_CHARS = 100_000;

export const IMAGE_PLACEHOLDER = '[image]';

type Part = { type?: string; text?: string; image?: unknown };

export function contentForSave(content: Message['content']): Message['content'] {
  if (!Array.isArray(content)) return content;
  return (content as Part[]).map(p => {
    if (p?.type === 'image') {
      const size = typeof p.image === 'string' ? p.image.length : Infinity;
      if (size > MAX_INLINE_IMAGE_CHARS) return { type: 'text', text: IMAGE_PLACEHOLDER };
    }
    return p;
  }) as unknown as Message['content'];
}

/** Text-only form for surfaces that save a plain string (goals, projects). */
export function plainTextForSave(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Part[])
    .map(p => (p?.type === 'text' ? String(p.text ?? '') : p?.type === 'image' ? IMAGE_PLACEHOLDER : ''))
    .filter(Boolean)
    .join('\n');
}
