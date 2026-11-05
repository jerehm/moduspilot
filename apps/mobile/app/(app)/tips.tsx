import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/Icon';

interface Tip {
  title: string;
  body: string;
  tag?: string;
}

interface Section {
  heading: string;
  icon: string;
  tips: Tip[];
}

const SECTIONS: Section[] = [
  {
    heading: 'Using MODUS AI',
    icon: '🤖',
    tips: [
      {
        title: 'Approval cards: approve, edit or skip',
        body: 'When MODUS proposes an action (create goal, schedule event, send email), it surfaces an approval card. Approve it as-is, tap Edit to change it, or Skip to ignore it. Nothing executes until you say so.',
        tag: 'Core mechanic',
      },
      {
        title: 'Ask MODUS to create things from chat',
        body: 'Say "add that as a goal", "create a task for X", "add a daily habit for Y", or "schedule that for Thursday at 3pm", MODUS surfaces the right card immediately.',
      },
      {
        title: 'Email reply drafting',
        body: 'Paste an email and say "draft a reply". MODUS asks you to pick a tone (Optimistic, Candid, Strategic) before writing, so the reply sounds like you. Then you approve the send.',
        tag: 'Workflow',
      },
      {
        title: 'Schedule straight from an email',
        body: 'Paste or forward an email and say "put this on my calendar". MODUS pulls out the date and time and surfaces a calendar hold, approve it and the event lands in Google Calendar.',
        tag: 'Cross-tool',
      },
      {
        title: 'Tell MODUS who you are',
        body: 'Settings → Personal context. Write 2 to 5 sentences about your role, how you like to work, and your priorities. MODUS reads this in every conversation.',
        tag: 'Setup tip',
      },
      {
        title: 'Update goal progress with words',
        body: 'Just say "I\'m about 60% done with my launch goal" and MODUS will surface an update card with the slider pre-set.',
      },
    ],
  },
  {
    heading: 'Your Brain: AI model selection',
    icon: '🧠',
    tips: [
      {
        title: 'Switch your AI in Settings → Brain',
        body: 'MODUS runs on multiple AI models. Go to Settings → Brain to pick one. Llama 3.3 is fast and always free. GPT-6.1 Sol, Claude Sonnet and Gemini 3.8 Flash unlock on MODUS plan. GPT-6 Astra and Claude Opus 5.5 unlock on PILOT.',
        tag: 'Feature',
      },
      {
        title: 'All features work on every Brain',
        body: 'Your memory, inbox triage, approval cards, and integrations work identically no matter which Brain you pick. The Brain only changes which AI model answers your chat messages.',
      },
      {
        title: 'Use your own API key',
        body: 'Have your own OpenAI or Anthropic subscription? Settings → Brain → "Use your own subscription". Your key overrides the platform Brain and routes chat directly through your account.',
        tag: 'BYOK',
      },
      {
        title: 'Pick Claude for writing, GPT-6 for general use',
        body: 'Claude Sonnet is exceptional for nuanced writing, editing, and analysis. GPT-6.1 Sol is great for general tasks, images, and code. Gemini 3.8 Flash is the fastest. Try them on MODUS plan and see which fits your workflow.',
        tag: 'Pro tip',
      },
    ],
  },
  {
    heading: 'Proactive: MODUS works on its own',
    icon: '✨',
    tips: [
      {
        title: 'MODUS triages your inbox for you',
        body: 'MODUS scans your connected inbox for emails waiting on a reply, drafts a response in your voice, and pushes it to you. Approve, edit, or skip, nothing sends until you tap. Enable in Settings → Capabilities → Inbox Triage.',
        tag: 'Automatic',
      },
      {
        title: 'Meeting requests become calendar holds',
        body: 'When an email proposes a specific date and time, MODUS recognizes it and surfaces a calendar hold instead of a reply. Approve it and the event is created in Google Calendar.',
        tag: 'Cross-tool',
      },
      {
        title: 'Your morning briefing reads your whole day',
        body: 'At the time you set, MODUS builds a briefing from your goals, tasks, habits, today\'s calendar, and unread inbox, your top 3, anything overdue, and habits at risk. Enable in Settings → Capabilities → Daily Briefing.',
        tag: 'Daily',
      },
      {
        title: 'Relationship follow-up nudges',
        body: 'MODUS notices contacts who emailed you and never got a reply, and flags them so relationships don\'t go cold. Enable in Settings → Capabilities → Relationship Follow-ups.',
      },
      {
        title: 'Pre- and post-meeting briefs',
        body: 'Before a meeting MODUS sends a sharp brief: what it\'s likely about, what to have in mind, and one question to be ready for. After it ends, it asks how it went and can turn action items into tasks.',
      },
    ],
  },
  {
    heading: 'Phone integrations',
    icon: '📱',
    tips: [
      {
        title: 'Health data in your briefing',
        body: 'Enable Health in Settings → Connectors → On This Device. MODUS will show your step count and last night\'s sleep in your morning briefing so you can calibrate how hard to push that day.',
        tag: 'Setup',
      },
      {
        title: 'Share files and Obsidian notes',
        body: 'Go to Settings → Connectors → Files & Notes → Browse. Pick any text or markdown file from iCloud Drive (including your Obsidian vault). MODUS opens a chat with the file contents ready to discuss.',
        tag: 'Files',
      },
      {
        title: 'Contacts for relationship context',
        body: 'Enable Contacts in Settings → Connectors. MODUS uses your contact list to surface relationship nudges and recognize names when drafting emails.',
        tag: 'Setup',
      },
      {
        title: 'Share anything to MODUS from another app',
        body: 'In any app (WhatsApp, Messages, Safari), copy the content you want to share, then open MODUS chat and paste it. MODUS can read, summarize, reply to, or act on any text you bring in.',
        tag: 'Workflow',
      },
      {
        title: 'Attach photos in chat',
        body: 'Tap the image icon in chat to attach a photo from your library. MODUS can describe, analyze, or act on images, useful for receipts, screenshots, whiteboards, or anything visual.',
      },
    ],
  },
  {
    heading: 'Cloud integrations',
    icon: '🔌',
    tips: [
      {
        title: 'Connect Google to unlock Calendar + Gmail',
        body: 'Settings → Connectors → Google. Once connected, MODUS can see your inbox, schedule events in Google Calendar, archive emails, and draft or send replies.',
        tag: 'Setup',
      },
      {
        title: 'Multi-account Gmail',
        body: 'Connect multiple Google accounts. When you approve a send_email card, MODUS lets you pick which account to send from.',
      },
      {
        title: 'Ask MODUS to connect from chat',
        body: 'Haven\'t connected an integration yet? Just ask MODUS to use it ("show me my emails"). It drops a connect card in chat so you don\'t have to dig through settings.',
      },
      {
        title: 'Notion, Slack, GitHub',
        body: 'Settings → Connectors. Connect Notion for pages and databases, Slack for channels and messages, GitHub for repos and issues. MODUS can read and reference all of these in chat.',
      },
    ],
  },
  {
    heading: 'Memory',
    icon: '💾',
    tips: [
      {
        title: 'MODUS builds a profile of you over time',
        body: 'With "Generate memory from chat" enabled (Settings → Memory), MODUS extracts key facts from your conversations, your preferences, recurring goals, communication style, and recalls them in future sessions.',
      },
      {
        title: 'Add memories manually',
        body: 'Settings → Memory → Add. Useful for: "I work across Pacific and Eastern time", "My launch date is June 1", "My co-founder is Alex".',
        tag: 'Pro tip',
      },
    ],
  },
  {
    heading: 'Goals & habits',
    icon: '🎯',
    tips: [
      {
        title: 'Let MODUS build your plan',
        body: 'On any goal, ask MODUS to generate a milestone checklist tailored to your goal and timeframe. Progress % updates automatically as you check milestones off.',
        tag: 'AI',
      },
      {
        title: 'Use goal chats to think, not just track',
        body: 'Each goal has its own MODUS chat with full context. Use it to think out loud: "what\'s blocking me?", "help me plan next steps", "reflect on this week".',
      },
      {
        title: 'Log habits from Briefing',
        body: 'The Briefing tab shows habits at risk of breaking streak. Tap "Log it" next to any habit to mark it done for today without leaving the briefing view.',
      },
    ],
  },
  {
    heading: 'MODUS Voice',
    icon: '🎙️',
    tips: [
      {
        title: 'Listen to your briefing',
        body: 'Tap the speaker icon in the top-right of the Briefing tab to have MODUS read your morning brief aloud. Pick your preferred voice in Settings → Brain → MODUS Voice.',
        tag: 'Audio',
      },
      {
        title: 'Speak instead of type',
        body: 'Tap the mic button in chat to dictate your message. Enable voice input in Settings → Capabilities → Voice Input.',
      },
    ],
  },
];

export default function TipsScreen() {
  const [open, setOpen] = useState<string | null>(SECTIONS[0].heading);

  return (
    <SafeAreaView className="flex-1" edges={['top']}>
      <ScreenHeader title="Tips & Tricks" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-muted text-sm mb-4">
          Everything you can do in MODUS, and how to get the most out of it.
        </Text>

        <View className="gap-3">
          {SECTIONS.map(section => (
            <Accordion
              key={section.heading}
              section={section}
              isOpen={open === section.heading}
              onToggle={() => setOpen(open === section.heading ? null : section.heading)}
            />
          ))}
        </View>

        <View className="bg-brand/5 border border-brand/20 rounded-xl px-5 py-4 mt-4">
          <Text className="text-text font-semibold mb-1">Still figuring something out?</Text>
          <Text className="text-muted text-xs leading-5">
            Ask MODUS directly in chat, it knows everything about itself and can walk you through any feature.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Accordion({ section, isOpen, onToggle }: { section: Section; isOpen: boolean; onToggle: () => void }) {
  const rotate = useSharedValue(isOpen ? 1 : 0);
  rotate.value = withTiming(isOpen ? 1 : 0, { duration: 180 });
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate.value * 180}deg` }] }));

  return (
    <View className="bg-surface border border-border rounded-xl overflow-hidden">
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        className="flex-row items-center gap-3 px-4 py-4"
      >
        <Text className="text-base">{section.icon}</Text>
        <Text className="text-text font-semibold text-[15px] flex-1">{section.heading}</Text>
        <View className="bg-border rounded-full px-2 py-0.5">
          <Text className="text-muted text-[10px] font-semibold">{section.tips.length}</Text>
        </View>
        <Animated.View style={chevronStyle}>
          <Icon name="keyboard-arrow-down" tone="muted" size={20} />
        </Animated.View>
      </TouchableOpacity>

      {isOpen && (
        <View className="border-t border-border">
          {section.tips.map((tip, i) => (
            <View key={tip.title} className={`px-4 py-4 ${i > 0 ? 'border-t border-border/60' : ''}`}>
              <View className="flex-row items-center gap-2 mb-1 flex-wrap">
                <Text className="text-text font-medium text-sm">{tip.title}</Text>
                {tip.tag && (
                  <View className="bg-brand/10 rounded-full px-2 py-0.5">
                    <Text className="text-brand text-[10px] font-semibold">{tip.tag}</Text>
                  </View>
                )}
              </View>
              <Text className="text-muted text-xs leading-5">{tip.body}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
