'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

const FAQS = [
  {
    q: 'Why pay for MODUS instead of ChatGPT Plus?',
    a: "Because ChatGPT is one model that forgets you. Modus gives you every frontier model (Claude, GPT-6, Gemini, Llama, DeepSeek) in one chat, keeps persistent memory of you across every conversation, and actually connects to your inbox, calendar and files to get things done. One bill instead of five subscriptions.",
  },
  {
    q: 'Do I really get every top AI model in one place?',
    a: "Yes. Claude, GPT-6, Gemini, Llama and DeepSeek live in the same chat. Pick the model you want for any message, leave it on Auto and let Modus route each task to the best one, or ask several at once and get one clear verdict. No API keys, no separate logins.",
  },
  {
    q: 'What can Modus actually do for me?',
    a: "Every morning it sends a briefing: your top priorities, overdue tasks and habits at risk. Through the day you can ask it to draft and send email, reschedule meetings, update goals or log habits. Every action it takes waits on an approval card first, so nothing runs without you.",
  },
  {
    q: 'What apps does it connect to?',
    a: "On the web: Gmail, Google Calendar, Google Drive, Notion, Slack and GitHub. On your Mac and iPhone: iMessage, Apple Notes, Reminders, Contacts, Photos and Apple Health. You can also connect any MCP server. Live across web, Mac and iPhone.",
  },
  {
    q: 'Is there a free version?',
    a: "Yes. Free gives you the open models (Llama, DeepSeek and Gemini Flash) with no card, on a rolling window that refreshes through the day. MODUS is $28/mo for every provider, auto-routed. PILOT is $59/mo and adds the frontier models with manual pick per message. Paid plans are billed when you subscribe. Cancel anytime.",
  },
  {
    q: 'Is my data private?',
    a: "Your data is never sold or used to train AI models. Memory is stored in your own encrypted index, and you can view and delete everything Modus knows about you at any time from Settings → Memory.",
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="rounded-xl overflow-hidden border border-border bg-panel"
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-text/[0.03] transition-colors group"
      >
        <span className="text-sm font-semibold text-text pr-4">{q}</span>
        <span className={`text-muted text-lg shrink-0 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <p className="px-6 py-4 text-sm text-muted leading-relaxed bg-bg/60">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FAQSection() {
  return (
    <section className="py-32 px-6 overflow-hidden">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-text mb-4">Questions</h2>
          <p className="text-muted text-lg">Everything you&apos;d ask before signing up.</p>
        </motion.div>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
