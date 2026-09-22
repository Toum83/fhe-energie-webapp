import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bilan énergie",
  description: "Production solaire et consommation de la maison, semaine par semaine.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-prod" />
              Bilan énergie
            </Link>
            <span className="text-xs text-faint">FHE × Home Assistant</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
        <footer className="px-4 py-6 text-center text-xs text-faint">
          Données : pinces FHE Drive&amp;Elec, bilans calculés par Home Assistant.
        </footer>
      </body>
    </html>
  );
}
