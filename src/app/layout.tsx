import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. — Personal AI System",
  description:
    "Just A Rather Very Intelligent System. Voice-controlled multimodal AI assistant with terminal access, filesystem control, live web access, image understanding and generation, and system telemetry.",
  keywords: ["JARVIS", "AI assistant", "multimodal", "voice assistant", "Iron Man", "HUD"],
  authors: [{ name: "JARVIS Mark II" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "J.A.R.V.I.S. — Personal AI System",
    description: "Voice-controlled AI with full machine control",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#04070d] text-zinc-100`}
      >
        {children}
        <Toaster theme="dark" position="top-center" richColors />
      </body>
    </html>
  );
}
