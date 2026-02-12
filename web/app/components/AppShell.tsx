"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calculator,
  FileSpreadsheet,
  Layers,
  LayoutDashboard,
  Tags,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Forecast", icon: LayoutDashboard },
  { href: "/pools", label: "Pool Setup", icon: Layers },
  { href: "/rates", label: "Rates", icon: Calculator },
  { href: "/psr", label: "PSR", icon: BarChart3 },
  { href: "/mappings", label: "Mappings", icon: Tags },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
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
          })}
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border text-xs text-muted-foreground">
          GovCon MVP v0.2
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
