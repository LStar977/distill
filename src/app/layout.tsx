import type { Metadata } from "next";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { listRuns } from "@/lib/runs";
import { TopNav } from "@/components/top-nav";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "Distill",
  description:
    "Thousands of reviews in. A ranked list of product opportunities out. Every one citing its sources.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const runs = await listRuns();
  const latest = runs[0] ?? null;
  return (
    <html lang="en" className="h-full">
      <body className="flex h-full flex-col overflow-hidden">
        <ToastProvider>
          <TopNav latestRunId={latest?.id ?? null} latestRunNumber={latest?.number ?? null} demo={!process.env.ANTHROPIC_API_KEY} />
          <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
