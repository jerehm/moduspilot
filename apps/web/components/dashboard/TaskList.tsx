'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/providers/AuthProvider';
import { SkeletonList, SkeletonRow } from '@/components/ui/Skeleton';

interface Task {
  id: string;
  title: string;
  description?: string;
  done: boolean;
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-yellow-400',
  low: 'bg-muted',
};

export default function TaskList() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const q = query(
      collection(db, 'users', user.uid, 'tasks'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setTasks(snap.docs
        // Soft-deleted tasks keep their doc with deleted: true; every other
        // task surface hides them, so the dashboard must too.
        .filter(d => d.data().deleted !== true)
        .map(d => ({
          id: d.id,
          title: d.data().title ?? 'Untitled',
          description: d.data().description,
          done: d.data().done ?? false,
          dueDate: d.data().dueDate,
          priority: d.data().priority,
        }))
        .filter(t => !t.done)
      );
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

  async function markDone(taskId: string) {
    if (!user) return;
    setCompleting(s => new Set(s).add(taskId));
    await new Promise(r => setTimeout(r, 600));
    await updateDoc(doc(db, 'users', user.uid, 'tasks', taskId), {
      done: true,
      completedAt: serverTimestamp(),
    });
    setCompleting(s => { const n = new Set(s); n.delete(taskId); return n; });
  }

  return (
    <div className="h-full flex flex-col">
      {loading ? (
        <SkeletonList count={4} className="flex-1 space-y-3 pr-1">
          <SkeletonRow />
        </SkeletonList>
      ) : tasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted text-xs text-center">No tasks yet.</p>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {tasks.map(t => {
              const done = completing.has(t.id);
              return (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="flex items-start gap-2.5 group overflow-hidden"
                >
                  <button
                    onClick={() => markDone(t.id)}
                    className={`mt-0.5 w-4 h-4 shrink-0 rounded border transition-all duration-200 flex items-center justify-center ${
                      done ? 'bg-brand border-brand' : 'border-border group-hover:border-brand'
                    }`}
                  >
                    {done && (
                      <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.priority && (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] ?? 'bg-muted'}`} />
                      )}
                      <span className={`text-sm truncate transition-all duration-300 ${done ? 'line-through text-muted/50' : 'text-text'}`}>
                        {t.title}
                      </span>
                    </div>
                    {t.dueDate && (
                      <span className="text-xs text-muted">{t.dueDate}</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
