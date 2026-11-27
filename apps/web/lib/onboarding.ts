import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Text only. The emoji read as clip-art next to a serif headline.
export const ROLE_OPTIONS = ['Founder / builder', 'Executive / manager', 'Professional', 'Student', 'Other'];

/** Vector-indexes the seeded memories. Supplementary: they are already saved, so failures are ignored. */
export function indexOnboardingMemories(getToken: () => Promise<string>, memories: string[]): void {
  if (memories.length === 0) return;
  void getToken().then(token => Promise.all(memories.map(text => fetch('/api/memory/upsert', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text }),
  })))).catch(() => {});
}

export async function seedOnboardingAccount(uid: string, { name, role, age, gender }: { name: string; role: string; age: string; gender: string }): Promise<string[]> {
  const ref = doc(db, 'users', uid);
  const roleLabel = role.trim() || 'Other';
  const saidGender = gender && gender !== 'Prefer not to say' ? gender : '';
  const personalContext = [name.trim() && `My name is ${name.trim()}.`, `I am a ${roleLabel}.`, age && `I am ${age} years old.`, saidGender && `I am ${saidGender.toLowerCase()}.`].filter(Boolean).join(' ');
  const memories = [name.trim() && `My name is ${name.trim()}.`, `I am a ${roleLabel}.`].filter(Boolean) as string[];
  // Completion and deterministic seeds commit together. Retries and two tabs
  // cannot mark an incomplete setup done or create duplicate starter records.
  const created = await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref);
    if (existing.data()?.onboardingComplete === true) return false;
    transaction.set(ref, {
      displayName: name.trim() || null,
      onboardingComplete: true,
      onboardingAnswers: { role: roleLabel, age: age || null, gender: gender || null },
      settings: {
        personalContext, responseStyle: 'normal',
        capabilities: { voiceInput: false, vectorMemory: true },
        generateMemoryFromChat: true, helpImprove: false, dataRetention: true, customStyle: '',
      },
    }, { merge: true });
    transaction.set(doc(db, 'users', uid, 'habits', 'onboarding-daily-review'), {
      name: 'Daily Review', description: 'Check in with Modus each day. Review your goals, plan your day and stay on track.',
      frequency: 'daily', target: 1, color: '#7c3aed', icon: '', completedDates: [], source: 'onboarding', createdAt: serverTimestamp(),
    });
    memories.forEach((content, i) => transaction.set(doc(db, 'users', uid, 'memories', `onboarding-${i}`), {
      content, source: 'onboarding', createdAt: serverTimestamp(),
    }));
    return true;
  });
  return created ? memories : [];
}
