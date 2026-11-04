import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/marketing/Navbar';
import Footer from '@/components/marketing/Footer';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms and conditions for using MODUS Pilot.',
  alternates: { canonical: 'https://moduspilot.com/terms' },
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

export default function TermsPage() {
  return (
    <div className="marketing marketing-light-tokens bg-bg text-text min-h-screen">
      <Navbar marketingTheme="light" />
      <div className="pt-24 max-w-2xl mx-auto px-6 py-16 space-y-10">

        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Legal</p>
          <h1 className="text-4xl text-text tracking-tight mb-2">Terms of Service</h1>
          <p className="text-sm text-muted">Last updated: {LAST_UPDATED}</p>
        </div>

        <Section title="Agreement">
          <p>By accessing or using MODUS Pilot (&quot;MODUS&quot;, &quot;the Service&quot;), you agree to these Terms of Service. If you do not agree, do not use the Service. These terms form a binding agreement between you and MODUS Pilot.</p>
        </Section>

        <Section title="The Service">
          <p>Modus is an AI-powered personal operating system that helps you manage goals, tasks, habits, email, and calendar through a conversational interface. Modus acts on your behalf only when you explicitly approve actions via approval cards.</p>
          <p>The Service is provided &quot;as is.&quot; We are continuously improving Modus and features may change, be added, or be removed at any time.</p>
        </Section>

        <Section title="Your Account">
          <p>You must be at least 13 years old to use Modus. You are responsible for maintaining the security of your account credentials. You are responsible for all activity that occurs under your account.</p>
          <p>You may not use Modus for any unlawful purpose, to harm others, to generate spam, or to circumvent any security measures.</p>
        </Section>

        <Section title="Subscription and Payment">
          <p>Modus offers a Free plan with usage limits and paid MODUS and PILOT subscriptions. Paid subscriptions require a payment method and are billed when you subscribe at the selected billing cadence. Existing trials retain their original end date. Extra limits are available as a separate paid subscription.</p>
          <p>Current plans: MODUS at $28/mo billed monthly, or $280/yr billed annually. PILOT at $59/mo billed monthly, or $588/yr billed annually. Annual plans are charged once up front for the full year.</p>
          <p>Payments are processed by Stripe. By subscribing you authorize us to charge your payment method on a recurring basis at the cadence you chose, until you cancel. You may cancel at any time from Settings → Billing. Cancellation takes effect at the end of your current billing period, and we do not refund partial months or partial years.</p>
          <p>Founding member seats, where offered, are billed at the price stated at the time you claim the seat, and that price is honoured for as long as the subscription stays active.</p>
          <p>We reserve the right to change pricing with 30 days notice to existing subscribers.</p>
        </Section>

        <Section title="Google Integration">
          <p>If you connect your Google account, you authorize Modus to access your Gmail, Google Calendar, and Google Drive as described in our Privacy Policy. Modus will only take actions (e.g. sending emails) when you explicitly approve them. You can disconnect Google at any time from Settings → Connectors.</p>
        </Section>

        <Section title="AI Limitations">
          <p>Modus routes your messages to large language models from several providers, including OpenAI, Anthropic, Google, Meta and DeepSeek, either automatically or to the model you pick. AI outputs may be inaccurate, incomplete, or inappropriate. You are responsible for reviewing and approving any actions before they are executed. Do not rely on Modus for medical, legal, financial, or safety-critical decisions.</p>
          <p>Which models are available depends on your plan, and the model line-up changes as providers release and retire models. We may substitute a model of equivalent or better capability without notice.</p>
        </Section>

        <Section title="Apps and Platforms">
          <p>Modus is available on the web and as a macOS desktop app. A Windows desktop app and an iPhone app are in beta. Beta software may be unstable and features may be incomplete. Desktop and mobile apps update themselves automatically, and these terms apply to every platform equally.</p>
        </Section>

        <Section title="Your Data">
          <p>You own your data. By using Modus you grant us a limited license to store, process, and use your data solely to provide the Service. See our Privacy Policy for full details on how we handle your data.</p>
          <p>You can delete your account and all associated data at any time from Settings → Account.</p>
        </Section>

        <Section title="Acceptable Use">
          <p>You agree not to:</p>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li>Use Modus to generate illegal, harmful, or abusive content</li>
            <li>Attempt to reverse engineer, scrape, or exploit the Service</li>
            <li>Share your account credentials with others</li>
            <li>Use Modus to send spam or unsolicited communications</li>
            <li>Attempt to circumvent rate limits or payment requirements</li>
          </ul>
          <p>Violation of these terms may result in immediate account termination.</p>
        </Section>

        <Section title="Termination">
          <p>You may cancel your account at any time. We may suspend or terminate your account if you violate these terms, with or without notice. Upon termination, your data will be deleted per our Privacy Policy.</p>
        </Section>

        <Section title="Limitation of Liability">
          <p>To the maximum extent permitted by law, MODUS Pilot shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service. Our total liability to you for any claim shall not exceed the amount you paid us in the 3 months preceding the claim.</p>
        </Section>

        <Section title="Disclaimer of Warranties">
          <p>The Service is provided &quot;as is&quot; without warranties of any kind, express or implied. We do not warrant that the Service will be uninterrupted, error-free, or that any defects will be corrected.</p>
        </Section>

        <Section title="Changes to Terms">
          <p>We may update these terms from time to time. We will notify you of material changes via email or in-app notification. Continued use of Modus after changes constitutes acceptance of the new terms.</p>
        </Section>

        <Section title="Governing Law">
          <p>These terms are governed by the laws of the State of California, United States, without regard to conflict of law principles.</p>
        </Section>

        <Section title="Contact">
          <p>Questions about these terms? Email us at <a href="mailto:jeremiah@moduspilot.com" className="text-brand hover:underline">jeremiah@moduspilot.com</a>.</p>
        </Section>

        <div className="pt-6 border-t border-border flex items-center justify-between text-xs text-muted">
          <span>© {new Date().getFullYear()} MODUS Pilot</span>
          <Link href="/privacy" className="hover:text-text transition-colors">Privacy Policy →</Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
