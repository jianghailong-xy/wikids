import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Wikids — Learn at your own pace",
  description: "A friendly home for kids' learning materials.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {/*
          The learning pages keep the site's `max-w-5xl` reading measure. The
          game workspace (docs/design/werewolf/visual-spec.md §3.1/§7) is the
          one place that needs more width: at ≥1200px the match is a three
          column 235/660/290 layout, and §7 explicitly warns against crushing
          those columns into a narrow container. `:has()` lifts the cap only
          for a subtree that renders `.game-shell`, so no other page changes.
        */}
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 [&:has(.game-shell)]:max-w-none">
          {children}
        </main>
      </body>
    </html>
  );
}
