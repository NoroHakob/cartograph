import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeInitScript } from "@/components/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cartograph",
  description: "Dependency maps of public GitHub repositories, drawn from the code itself.",
};

// Clerk's components read the same colour tokens as the app, so they follow
// the theme control without a separate dark theme.
const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorBackground: "var(--surface)",
    colorForeground: "var(--fg)",
    colorMuted: "var(--surface-muted)",
    colorMutedForeground: "var(--fg-muted)",
    colorPrimary: "var(--accent)",
    colorPrimaryForeground: "var(--accent-fg)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--fg)",
    colorNeutral: "var(--fg)",
    colorBorder: "var(--border)",
    colorDanger: "var(--danger)",
    colorRing: "var(--ring)",
    fontFamily: "inherit",
    borderRadius: "0.5rem",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="system"
      // The inline script below rewrites data-theme before React hydrates.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
