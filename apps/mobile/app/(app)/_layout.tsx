import { useEffect } from 'react';
import { Stack, Redirect, router } from 'expo-router';
import { View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/hooks/useAuth';
import { DrawerProvider } from '@/components/AppDrawer';
import { AppBackground } from '@/components/AppBackground';
import { BrandLoader } from '@/components/ui';
import { SheetsProvider } from '@/components/ui/Sheets';
import { registerPush } from '@/lib/push';

export { AppErrorBoundary as ErrorBoundary } from '@/components/AppErrorBoundary';

export default function AppLayout() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!user) return;
    registerPush(user.uid);

    const open = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { type?: string } | undefined;
      router.navigate(data?.type === 'checkin' ? '/(app)/(tabs)/chat' : '/(app)/(tabs)/briefing');
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    // A tap that LAUNCHED the app from killed arrives before the listener above
    // exists, so it was dropped. Read it once at mount.
    Notifications.getLastNotificationResponseAsync()
      .then(r => { if (r) { open(r); void Notifications.clearLastNotificationResponseAsync().catch(() => {}); } })
      .catch(() => {});
    return () => sub.remove();
  }, [user]);

  if (loading) return <BrandLoader />;
  if (!user) return <Redirect href="/(auth)/welcome" />;

  return (
    <SheetsProvider>
      <DrawerProvider>
        <View className="flex-1 bg-bg">
          <AppBackground />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: 'transparent' },
              animation: 'default',
            }}
          >
            {/* (tabs) group: all main nav screens — stays mounted, instant switching */}
            <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
          </Stack>
        </View>
      </DrawerProvider>
    </SheetsProvider>
  );
}
