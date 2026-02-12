import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import AppShell from "./components/AppShell";

export const metadata: Metadata = {
  title: "Indirect Rate Forecasting Agent",
  description: "GovCon-oriented indirect rate forecasting MVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
      <Script
        src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js"
        strategy="afterInteractive"
      />
    </html>
  );
}
