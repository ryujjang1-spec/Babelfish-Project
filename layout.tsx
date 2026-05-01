import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "On-demand Realtime Concierge",
  description: "Realtime voice concierge middle AI demo"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
