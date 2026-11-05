import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { BrandLoader } from '@/components/ui';

function Splash() {
  return <BrandLoader />;
}

export default function Index() {
  const { user, loading } = useAuth();
  // null = not yet checked, true/false = onboarding status for the current user
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) { setOnboarded(null); return; }
    let active = true;
    getDoc(doc(db, 'users', user.uid))
      .then(snap => { if (active) setOnboarded(snap.data()?.onboardingComplete === true); })
      // Offline launch: a failed read is NOT "not onboarded". Sending an existing
      // user back into onboarding is worse than skipping it for a new one, and
      // the dashboard works from cache.
      .catch(() => { if (active) setOnboarded(true); });
    return () => { active = false; };
  }, [user]);

  if (loading) return <Splash />;
  if (!user) return <Redirect href="/(auth)/welcome" />;
  if (onboarded === null) return <Splash />; // waiting on the user-doc check
  return onboarded
    ? <Redirect href={'/(app)/(tabs)/dashboard' as never} />
    : <Redirect href="/onboarding" />;
}
