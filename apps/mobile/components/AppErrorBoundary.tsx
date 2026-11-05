import { Pressable, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

/**
 * Route-level crash screen. Without one, any render error in a release build
 * (a malformed card from the model, an old Firestore message) took down the
 * whole app. expo-router renders this in place of the broken route and keeps
 * the rest of the app alive; Try again re-mounts the route.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  if (__DEV__) console.error('[modus:error-boundary]', error);
  return (
    <View className="flex-1 bg-bg items-center justify-center px-8">
      <Text className="text-text text-lg font-semibold mb-2">Something went wrong</Text>
      <Text className="text-muted text-sm text-center mb-6">
        This screen hit an error. Your chats and data are safe.
      </Text>
      <Pressable onPress={() => { void retry(); }} className="bg-brand rounded-xl px-6 py-3">
        <Text className="text-white font-semibold">Try again</Text>
      </Pressable>
    </View>
  );
}
