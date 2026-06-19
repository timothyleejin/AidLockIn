import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/components/app-shell/providers";
import { Sidebar } from "@/components/app-shell/sidebar";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono-claim",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AidLockIn",
  description: "Allocate scarce disaster aid once, fairly, with a globally consistent audit trail.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full">
        <AppStateProvider>
          <div className="flex h-screen overflow-hidden bg-bg">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AppStateProvider>
      </body>
    </html>
  );
}
