import { AppShell } from "@/components/shell/app-shell";

// The proxy has already confirmed the signed-in user's active organization is
// the one in the URL before this renders.
export default function OrgLayout({ children }: LayoutProps<"/o/[slug]">) {
  return <AppShell>{children}</AppShell>;
}
