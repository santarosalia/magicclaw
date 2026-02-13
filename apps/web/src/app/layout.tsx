import type { Metadata } from "next";
import "./globals.css";
import { AgentSocketProvider } from "@/lib/agent-socket-context";
import { LlmStatusProvider } from "@/lib/llm-status-context";
import { GlobalConnectionStatus } from "@/components/GlobalConnectionStatus";

export const metadata: Metadata = {
  title: "MagicClaw",
  description: "AI agent with MCP tool management",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AgentSocketProvider>
          <LlmStatusProvider>
            <GlobalConnectionStatus />
            {children}
          </LlmStatusProvider>
        </AgentSocketProvider>
      </body>
    </html>
  );
}
