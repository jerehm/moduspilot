'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { isValidElement, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { normalizeMathDelimiters } from '@/lib/chat/math-delimiters';
import { defaultUrlTransform } from 'react-markdown';
import { useWorkspacePanel } from '@/components/workspace/workspace-context';

// Renders MODUS's chat text as real markdown: GFM tables, task-list
// checkboxes, fenced code with syntax highlighting (rehype-highlight adds
// hljs-* classes; colors come from the .chat-md pre code theme in globals.css).
// Every element is themed to match the chat surface. Safe on streaming text —
// react-markdown renders whatever parses so far.
// workspace:path links point at a file in the chat's workspace. react-markdown
// strips unknown schemes by default, so this one is let through explicitly and
// every other URL keeps the default sanitizing.
const urlTransform = (url: string) => (url.startsWith('workspace:') ? url : defaultUrlTransform(url));

const MermaidBlock = dynamic(() => import('./MermaidBlock'), { ssr: false });

/** Plain text of a rendered code element (highlight.js wraps tokens in spans). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = Array.isArray(children) ? children[0] : children;
  const className = isValidElement(code) ? String((code.props as { className?: string }).className ?? '') : '';
  const lang = className.match(/language-([\w+-]+)/)?.[1];
  const text = textOf(children).replace(/\n$/, '');
  if (lang === 'mermaid') return <MermaidBlock source={text} />;
  return (
    <div className="my-2 rounded-lg border border-border bg-[#0d0d14] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-white/10 text-[11px] text-white/50">
        <span>{lang ?? 'code'}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
          className="hover:text-white transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">{children}</pre>
    </div>
  );
}

export default function MarkdownMessage({ children }: { children: string }) {
  const ws = useWorkspacePanel();
  return (
    <div className="chat-md text-sm leading-relaxed text-text">
      <ReactMarkdown
        // singleDollarTextMath off: "$24/mo or $59" is a price here. Inline math
        // uses $$x$$ on one line (normalizeMathDelimiters maps \(x\) to it).
        remarkPlugins={[remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: false }]]}
        urlTransform={urlTransform}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: 'ignore' }],
          [rehypeHighlight, { detect: true, ignoreMissing: true, plainText: ['mermaid'] }],
        ]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="text-base font-bold text-text mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-bold text-text mt-4 mb-2 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-text mt-3 mb-1.5 first:mt-0">{children}</h3>,
          ul: ({ className, children }) =>
            (className ?? '').includes('contains-task-list')
              ? <ul className="my-2 space-y-1.5 list-none pl-0">{children}</ul>
              : <ul className="my-2 space-y-1 list-disc pl-5 marker:text-brand/60">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 space-y-1 list-decimal pl-5 marker:text-muted">{children}</ol>,
          li: ({ className, children }) =>
            (className ?? '').includes('task-list-item')
              ? <li className="flex items-start gap-2 leading-relaxed">{children}</li>
              : <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => {
            if (href?.startsWith('workspace:')) {
              const path = decodeURIComponent(href.slice('workspace:'.length)).replace(/^\/+/, '');
              // Outside a chat (or for guests) there is no panel to open; show plain text.
              if (!ws?.workspaceId || !path) return <span className="font-medium text-text">{children}</span>;
              return (
                <button type="button" onClick={() => ws.openFile(path)} className="text-brand underline underline-offset-2 hover:text-brand-light">{children}</button>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:text-brand-light">{children}</a>;
          },
          strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-brand/40 pl-3 text-muted italic">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          // Inline code vs. fenced block. rehype-highlight only touches block
          // code (adds a `language-*`/`hljs` class); inline code has no class.
          code: ({ className, children, ...props }) => {
            const isBlock = /\bhljs\b|\blanguage-/.test(className ?? '');
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>;
            }
            return (
              <code className="rounded surface-tint border border-tint px-1 py-0.5 text-[0.85em] font-mono text-brand-light">{children}</code>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-[13px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="surface-tint">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 font-semibold text-muted border-b border-border whitespace-nowrap">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-text/90 border-b border-border/40 align-top">{children}</td>,
          input: ({ checked, type }) =>
            type === 'checkbox' ? (
              <span className={`inline-flex w-4 h-4 translate-y-0.5 items-center justify-center rounded border shrink-0 ${checked ? 'surface-tint-strong border-brand/50' : 'border-border bg-panel'}`}>
                {checked && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5 text-brand">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                  </svg>
                )}
              </span>
            ) : null,
        }}
      >
        {normalizeMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
