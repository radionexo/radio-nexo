import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegistrar from "@/components/public/PwaRegistrar";
import PwaInstallPrompt from "@/components/public/PwaInstallPrompt";

export const viewport: Viewport = {
  themeColor: "#07080b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "NEXO RADIO — Donde Todo Conecta | En Vivo",
  description: "Radio online en vivo. Más que música, somos conexión. Escucha las mejores transmisiones musicales con locutores en vivo.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexo Radio",
  },
  icons: {
    icon: [
      { url: "/favicon_nexo.png", type: "image/png" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon_nexo.png",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark h-full">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon_nexo.png" type="image/png" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Nexo Radio" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full flex flex-col bg-[#090a0d] text-[#f3f4f6] selection:bg-[#e5b45f] selection:text-black">
        <PwaRegistrar />
        {children}
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
