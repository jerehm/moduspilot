import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useColorScheme } from 'nativewind';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { loadSavedTheme } from '@/lib/theme';
import { FONT_MAP, setDefaultFontFamily } from '@/lib/fonts';
import '../global.css';

export { AppErrorBoundary as ErrorBoundary } from '@/components/AppErrorBoundary';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [loaded, fontError] = useFonts(FONT_MAP);
  // A font that fails to load set no flag, so the layout returned null and the
  // splash never hid. On error, carry on with the system font.
  const fontsLoaded = loaded || !!fontError;

  useEffect(() => {
    if (loaded) setDefaultFontFamily();
  }, [loaded]);

  useEffect(() => {
    if (!fontsLoaded) return;
    loadSavedTheme().finally(() => SplashScreen.hideAsync());
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
