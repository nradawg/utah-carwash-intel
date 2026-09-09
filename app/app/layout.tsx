import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Utah Car Wash Site Intelligence",
  description:
    "Site selection for car wash development across all 29 Utah counties, built on parcel, traffic, demographic and competition data from public sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
