import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bilan énergie",
  description: "Production solaire et consommation de la maison, semaine par semaine.",
  applicationName: "Bilan énergie",
  // Web app plein écran sur iPhone, comme les autres apps du projet : barre d'état translucide
  // (texte blanc) posée sur un bandeau supérieur foncé et uni. Sous la barre d'état il n'y a
  // donc que de l'aplat sombre : rien de clair ni de dégradé à voir flouter par iOS.
  appleWebApp: { capable: true, title: "Énergie", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // viewport-fit=cover : indispensable pour que env(safe-area-inset-*) soit renseigné.
  viewportFit: "cover",
  themeColor: "#171715",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-dvh flex-col overflow-hidden">
        <header
          className="shrink-0 text-white"
          style={{ paddingTop: "env(safe-area-inset-top)", backgroundColor: "#171715" }}
        >
          <div
            className="mx-auto flex w-full max-w-3xl items-center justify-between py-3"
            style={{
              paddingLeft: "max(1.25rem, env(safe-area-inset-left))",
              paddingRight: "max(1.25rem, env(safe-area-inset-right))",
            }}
          >
            <Link href="/" className="press flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-[10px] text-white shadow-sm"
                style={{ background: "linear-gradient(145deg, var(--hero-from), var(--hero-to))" }}
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" />
                </svg>
              </span>
              <span className="text-[1.05rem] font-semibold tracking-tight">Bilan énergie</span>
            </Link>
            <Link href="/appareils" className="press rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/85">
              Appareils
            </Link>
          </div>
        </header>
        {/*
          Le contenu défile dans ce conteneur, pas dans la page : aucun élément fixed/sticky ni
          défilement du document, donc iOS n'applique pas son effet de flou en bord d'écran
          sous la barre d'état.
        */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <main
          className="mx-auto w-full max-w-3xl flex-1 pt-5"
          style={{
            paddingLeft: "max(1.25rem, env(safe-area-inset-left))",
            paddingRight: "max(1.25rem, env(safe-area-inset-right))",
          }}
        >
          {children}
        </main>
        <footer
          className="px-5 pt-8 text-center text-xs text-faint"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}
        >
          Données : pinces FHE Drive&amp;Elec, bilans calculés par Home Assistant.
        </footer>
        </div>
      </body>
    </html>
  );
}
