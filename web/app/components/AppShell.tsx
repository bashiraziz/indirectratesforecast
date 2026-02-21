"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Calculator,
  Calendar,
  FileSpreadsheet,
  GitFork,
  Home,
  Layers,
  LayoutDashboard,
  Tags,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const SETTINGS_ITEMS: NavItem[] = [
  { href: "/fiscal-years", label: "Fiscal Years", icon: Calendar },
  { href: "/chart-of-accounts", label: "Chart of Accounts", icon: BookOpen },
  { href: "/pools", label: "Pool Setup", icon: Layers },
  { href: "/cost-structure", label: "Cost Structure", icon: GitFork },
  { href: "/mappings", label: "Mappings", icon: Tags },
];

const REPORTS_ITEMS: NavItem[] = [
  { href: "/forecast", label: "Forecast", icon: LayoutDashboard },
  { href: "/rates", label: "Rates", icon: Calculator },
  { href: "/psr", label: "PSR", icon: BarChart3 },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm no-underline transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}
    >
      <item.icon className="w-4 h-4" />
      {item.label}
    </Link>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
      {label}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-4 py-4 border-b border-sidebar-border">
          <Link href="/" className="no-underline">
            <h1 className="text-sm font-bold tracking-tight m-0 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              <span>IndirectRates</span>
            </h1>
          </Link>
        </div>
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          <NavLink item={{ href: "/", label: "Home", icon: Home }} active={isActive("/")} />

          <SectionHeader label="Settings" />
          {SETTINGS_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}

          <SectionHeader label="Reports" />
          {REPORTS_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border text-xs text-muted-foreground">
          v0.2
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
