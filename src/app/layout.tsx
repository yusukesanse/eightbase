import type { Metadata } from "next";
import "./globals.css";
import { RichMenu } from "@/components/RichMenu";

export const metadata: Metadata = {
  title: "NUF",
  description: "NUF LINE ミニアプリ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 min-h-screen flex flex-col max-w-md mx-auto">
        <main className="flex-1 pb-20">{children}</main>
        <RichMenu />
      </body>
    </html>
  );
}
