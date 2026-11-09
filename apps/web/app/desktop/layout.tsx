import type { Metadata } from 'next';

// Handoff pages between the browser and MODUS Desktop. Nothing here to index.
export const metadata: Metadata = {
  title: 'Sign in to MODUS Desktop',
  robots: { index: false, follow: false },
};

export default function DesktopAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
