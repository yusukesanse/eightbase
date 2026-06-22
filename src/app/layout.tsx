import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClientLayout } from "@/components/ClientLayout";
import { PreviewBanner } from "@/components/PreviewBanner";
import { DemoBanner } from "@/components/DemoBanner";

export const metadata: Metadata = {
  title: "EIGHT BASE UNGA",
  description: "EIGHT BASE UNGA - Eight Design シェアオフィス",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 min-h-screen flex flex-col">
        <DemoBanner />
        <PreviewBanner />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
