import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/marketing/Navbar';
import Footer from '@/components/marketing/Footer';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Modus collects, uses, and protects your data.',
  alternates: { canonical: 'https://moduspilot.com/privacy' },
};

const LAST_UPDATED = 'July 22, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-text">{title}</h2>
      <div className="text-sm text-muted leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="marketing marketing-light-tokens bg-bg text-text min-h-screen">
      <Navbar marketingTheme="light" />
      <div className="pt-24 max-w-2xl mx-auto px-6 py-16 space-y-10">

        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Legal</p>
          <h1 className="text-4xl text-text tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted">Last updated: {LAST_UPDATED}</p>
        </div>

        <Section title="Overview">
          <p>MODUS Pilot ("MODUS", "we", "us") is an AI-powered personal operating system. This policy explains what data we collect, how we use it, and your rights. By using Modus you agree to this policy.</p>
        </Section>

        <Section title="Information We Collect">
          <p><span className="text-text font-medium">Account data:</span> Your name, email address, and profile photo when you sign in via Google or Apple.</p>
          <p><span className="text-text font-medium">Conversation data:</span> Messages you send to Modus and AI responses, stored in your account to provide conversation history and context.</p>
          <p><span className="text-text font-medium">Goals, tasks, and habits:</span> Data you create inside Modus, such as goals, tasks, habits and memories, stored to power the app experience.</p>
          <p><span className="text-text font-medium">Google account data (if connected):</span> When you connect Google, Modus accesses your Gmail, Google Calendar, and Google Drive using OAuth 2.0. We read email and calendar data to populate your daily briefing. We send emails only when you explicitly approve an action. We read Drive files to provide document context in chat. We never store your full email content, only the metadata and snippets needed for briefing generation.</p>
          <p><span className="text-text font-medium">Usage data:</span> Daily message counts, plan status, and basic analytics to operate the service.</p>
        </Section>

        <Section title="How We Use Your Data">
          <p>We use your data exclusively to operate Modus:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Generating your daily briefing from your calendar, email, goals, and tasks</li>
            <li>Providing AI responses with relevant context from your memory and history</li>
            <li>Sending emails and creating calendar events on your behalf when you approve</li>
            <li>Tracking habits, streaks, and goal progress</li>
            <li>Enforcing plan limits and processing payments via Stripe</li>
          </ul>
          <p>We do not sell your data, use it to train AI models, or share it with third parties except as described below.</p>
        </Section>

        <Section title="Google API Data">
          <p>Modus use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
          <p>Specifically:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>We only access Google data that is necessary to provide the Modus service</li>
            <li>We do not use Google data to serve ads</li>
            <li>We do not allow humans to read your Google data unless you explicitly ask for support and grant permission</li>
            <li>We do not transfer Google data to third parties except to operate the service, which means sending the relevant context to the AI provider that answers your message</li>
            <li>We store OAuth tokens encrypted and refresh them automatically</li>
            <li>You can disconnect Google at any time from Settings → Connectors</li>
          </ul>
        </Section>

        <Section title="Data Storage and Security">
          <p>Your data is stored in Google Firebase (Firestore) and Pinecone (vector memory), both in the United States. We use industry-standard security practices including encrypted transport (HTTPS), token-based authentication, and Firestore security rules that prevent any user from accessing another user's data.</p>
          <p>OAuth tokens are stored encrypted server-side and are never exposed to the client.</p>
        </Section>

        <Section title="Data Retention">
          <p>Conversation history is retained for 2 years, or until you delete your account.</p>
          <p>You can delete your account and all associated data at any time from Settings → Account → Delete Account. Deletion is immediate and irreversible.</p>
        </Section>

        <Section title="Third-Party Services">
          <p>Modus uses the following third-party services to operate:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><span className="text-text font-medium">Vercel AI Gateway</span>: Routes each message to the AI provider that will answer it</li>
            <li><span className="text-text font-medium">OpenAI, Anthropic, Google, Meta and DeepSeek</span>: AI inference. The message you send, plus the context Modus attaches to it, goes to whichever of these providers serves the model handling that message, either the one you picked or the one Auto selected</li>
            <li><span className="text-text font-medium">Pinecone</span>: Vector memory storage</li>
            <li><span className="text-text font-medium">Stripe</span>: Payment processing (we never see or store your card details)</li>
            <li><span className="text-text font-medium">Firebase / Google Cloud</span>: Authentication and database</li>
            <li><span className="text-text font-medium">Vercel</span>: Hosting, deployment, and privacy-friendly pageview analytics</li>
            <li><span className="text-text font-medium">Meta Platforms (Meta Pixel and Conversions API)</span>: Ad measurement, so we can tell which ads bring people to Modus. When you visit, sign up or subscribe, Meta receives that event along with your IP address, browser details and your account ID and email, both in hashed (scrambled) form. Your messages are never sent. It stays off if your browser sends Global Privacy Control, and in regions that require consent it only runs after you agree</li>
            <li><span className="text-text font-medium">Sentry</span>: Error monitoring, so crashes get diagnosed and fixed</li>
          </ul>
          <p>These providers process your data to deliver their part of the service. We do not permit any of them to use your data to train their models.</p>
        </Section>

        <Section title="AI Providers and Model Routing">
          <p>Modus is a multi-model product. On Auto, Modus picks the model best suited to your message. You can also pick a model yourself, and on PILOT you can send one message to several frontier models at once and compare their answers side by side.</p>
          <p>Whichever route it takes, your message and its attached context are sent to that provider for the length of that request. Providers are contractually bound not to train on data sent through the API tiers Modus uses. If a model is unavailable, Modus may fail over to another model, and the answer is labelled with the model that actually produced it.</p>
        </Section>

        <Section title="Your Rights">
          <p>You have the right to:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Access all data stored about you</li>
            <li>Delete your account and all data at any time</li>
            <li>Disconnect Google and revoke all OAuth access at any time</li>
            <li>Opt out of data being used to improve Modus (Settings → Privacy)</li>
            <li>Export your data: contact us at the email below</li>
          </ul>
        </Section>

        <Section title="Children">
          <p>Modus is not directed at children under 13. We do not knowingly collect data from children under 13.</p>
        </Section>

        <Section title="Changes to This Policy">
          <p>We may update this policy from time to time. We will notify you of material changes via email or in-app notification. Continued use of Modus after changes constitutes acceptance.</p>
        </Section>

        <Section title="Contact">
          <p>Questions about this policy? Email us at <a href="mailto:jeremiah@moduspilot.com" className="text-brand hover:underline">jeremiah@moduspilot.com</a>.</p>
        </Section>

        <div className="pt-6 border-t border-border flex items-center justify-between text-xs text-muted">
          <span>© {new Date().getFullYear()} MODUS Pilot</span>
          <Link href="/terms" className="hover:text-text transition-colors">Terms of Service →</Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
