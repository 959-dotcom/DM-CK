import type { Metadata } from "next";
import { Bebas_Neue, Manrope } from "next/font/google";
import "./globals.css";

const display = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Spinlytics — Domain Checker",
  description:
    "ติดตามสถานะโดเมนบน AIS / TRUE / DTAC / 3BB / NT แบบเรียลไทม์",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body
        className={`${display.variable} ${body.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
