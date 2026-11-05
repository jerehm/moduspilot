import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from '@/components/Icon';
import { AppBackground } from '@/components/AppBackground';
import { GradientText } from '@/components/ui/GradientText';
import { GradientButton, Logo } from '@/components/ui';
import { GRADIENTS } from '@/lib/theme';

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'mail-outline', title: 'Email, drafted & sent', desc: 'MODUS writes it, you approve in one tap.' },
  { icon: 'calendar-today', title: 'Calendar, managed', desc: 'Schedule and block time automatically.' },
  { icon: 'flag', title: 'Goals you hit', desc: 'Daily check-ins and accountability built in.' },
  { icon: 'psychology', title: 'Memory that sticks', desc: 'Never repeat yourself again.' },
];

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-bg">
      <AppBackground />
      <SafeAreaView className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingVertical: 24, justifyContent: 'space-between' }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View className="items-center mt-6">
            <Logo width={80} style={{ marginBottom: 14 }} />
            <GradientText className="text-5xl font-black tracking-widest" style={{ paddingVertical: 2 }}>MODUS</GradientText>
            <Text className="text-muted text-[10px] tracking-[0.3em] uppercase font-semibold mb-6 mt-1">pilot</Text>
            <Text className="text-3xl font-display font-bold text-text text-center leading-tight">
              Your AI chief{'\n'}of staff.
            </Text>
            <Text className="text-muted text-sm text-center mt-3 leading-relaxed px-2">
              Email, calendar, goals, habits, memory, MODUS runs all of it so you can focus on what matters.
            </Text>
          </View>

          {/* Feature grid */}
          <View className="flex-row flex-wrap justify-between mt-8" style={{ gap: 12 }}>
            {FEATURES.map(f => (
              <View
                key={f.title}
                className="bg-surface border border-border rounded-xl p-4"
                style={{ width: '47%' }}
              >
                <LinearGradient
                  colors={GRADIENTS.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}
                >
                  <Icon name={f.icon} color="#fff" size={20} />
                </LinearGradient>
                <Text className="text-text text-xs font-bold leading-snug">{f.title}</Text>
                <Text className="text-muted text-xs leading-snug mt-1">{f.desc}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <View className="mt-8">
            <GradientButton label="Get started" icon="arrow-forward" size="lg" onPress={() => router.push('/onboarding')} />
            <Text className="text-muted text-xs text-center mt-3">
              3-day free trial · Card required · Cancel anytime
            </Text>

            <TouchableOpacity
              onPress={() => router.push('/(auth)/login')}
              activeOpacity={0.7}
              className="mt-5 py-2"
            >
              <Text className="text-muted text-sm text-center">
                Already have an account?{' '}
                <Text className="text-brand-light font-semibold">Sign in</Text>
              </Text>
            </TouchableOpacity>

            <Text className="text-muted/70 text-[11px] text-center mt-4 px-4 leading-4">
              By continuing you agree to our{' '}
              <Text className="text-muted">Terms</Text> and{' '}
              <Text className="text-muted">Privacy Policy</Text>
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
