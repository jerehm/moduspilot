'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

type Stat = { value: string; unit?: string; label: string; body: string };

const STATS: Stat[] = [
  {
    value: '10',
    label: 'Frontier models',
    body: 'Claude, GPT-6, Gemini, Llama and DeepSeek, every one of them, in a single chat.',
  },
  {
    value: '$28',
    unit: '/mo',
    label: 'Replaces ~$110/mo',
    body: 'One bill instead of ChatGPT Plus, Claude Pro, Gemini, Perplexity and Midjourney stacked together.',
  },
  {
    value: '12',
    label: 'Apps connected',
    body: 'Gmail, Calendar, Drive, Notion, Slack, GitHub, iMessage and more, live across web, Mac and iPhone.',
  },
];

export default function StatsSection() {
  return (
    <section className="py-24 sm:py-28 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 lg:gap-16 items-center">
        {/* Left: framed product shot */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-6 bg-[radial-gradient(ellipse_70%_60%_at_50%_50%,rgba(124,58,237,0.12),transparent_70%)]"
          />
          <div className="relative rounded-2xl border border-border overflow-hidden shadow-[0_24px_60px_-24px_rgba(30,20,60,0.30)]">
            <Image
              src="/screenshot-briefing.png"
              alt="Modus morning briefing with today's priorities and tasks in one place"
              width={2560}
              height={1180}
              className="w-full h-auto"
            />
          </div>
        </motion.div>

        {/* Right: big-number stats */}
        <div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-4xl md:text-5xl text-text tracking-tight mb-10"
          >
            The math is simple
          </motion.h2>

          <div className="space-y-8">
            {STATS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: 'easeOut' }}
                className="flex items-baseline gap-5 border-b border-border pb-8 last:border-0 last:pb-0"
              >
                <span className="shrink-0 w-28 text-4xl md:text-5xl font-semibold text-text tabular-nums" style={{ fontFamily: 'var(--font-serif)' }}>
                  {s.value}
                  {s.unit && <span className="text-xl text-muted align-baseline">{s.unit}</span>}
                </span>
                <div>
                  <p className="text-lg text-text font-medium mb-1">{s.label}</p>
                  <p className="text-sm text-muted leading-relaxed">{s.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
