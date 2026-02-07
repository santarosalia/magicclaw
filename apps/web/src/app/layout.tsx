import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MagicClaw',
  description: 'AI agent with MCP tool management',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
