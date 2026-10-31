import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teyvat Daily",
  description: "Seven Genshin prompts a day, scored by how rare your answer is.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-slate-950 font-sans text-slate-100 antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-6">
          <main className="flex-1">{children}</main>
          <footer className="pt-10 text-center text-xs text-slate-500">
            Unofficial fan project. Not affiliated with HoYoverse. Game data via genshin-db.
          </footer>
        </div>
      </body>
    </html>
  );
}
