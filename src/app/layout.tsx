import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Trakt Sync",
  description: "Sync your Netflix history to Trakt",
};

import ReloadHandler from "./components/ReloadHandler";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <ReloadHandler />
        {children}
      </body>
    </html>
  );
}
