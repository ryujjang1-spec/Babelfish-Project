import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Babelfish_온디멘드 컨시어지",
  description: "고객 요청을 이해하고 제휴 네트워크와 연결해 실행까지 돕는 Babelfish AI 컨시어지"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
