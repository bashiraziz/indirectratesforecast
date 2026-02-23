"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Calculator,
  Calendar,
  ChevronDown,
  ChevronsDownUp,
  Database,
  FileSpreadsheet,
  GitBranch,
  GitFork,
  Home,
  Layers,
  LayoutDashboard,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Tags,
} from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { authClient } from "@/lib/auth-client";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const SECTION_KEYS = ["settings", "reports"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTIONS: { key: SectionKey; label: string; items: NavItem[] }[] = [
  {
    key: "settings",
    label: "Settings",
    items: [
      { href: "/fiscal-years", label: "Fiscal Years", icon: Calendar },
      { href: "/chart-of-accounts", label: "Chart of Accounts", icon: BookOpen },
      { href: "/pools", label: "Pool Setup", icon: Layers },
      { href: "/cost-structure", label: "Cost Structure", icon: GitFork },
      { href: "/mappings", label: "Mappings", icon: Tags },
      { href: "/scenarios", label: "Scenarios", icon: GitBranch },
      { href: "/data", label: "Data Files", icon: Database },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    items: [
      { href: "/forecast", label: "Forecast", icon: LayoutDashboard },
      { href: "/rates", label: "Rates", icon: Calculator },
      { href: "/psr", label: "PSR", icon: BarChart3 },
      { href: "/pst", label: "PST", icon: FileSpreadsheet },
    ],
  },
];

const STORAGE_KEY = "nav-sections";

function loadSectionState(): Record<SectionKey, boolean> {
  const defaults: Record<SectionKey, boolean> = { settings: true, reports: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

function saveSectionState(state: Record<SectionKey, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm no-underline transition-colors ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}
    >
      <item.icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function NavSection({
  label,
  items,
  open,
  onToggle,
  sidebarCollapsed,
  isActive,
}: {
  label: string;
  items: NavItem[];
  open: boolean;
  onToggle: () => void;
  sidebarCollapsed: boolean;
  isActive: (href: string) => boolean;
}) {
  if (sidebarCollapsed) {
    return (
      <>
        <div className="my-2 mx-2 border-t border-sidebar-border" />
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed />
        ))}
      </>
    );
  }

  return (
    <>
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 pt-4 pb-1 bg-transparent! border-none! text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none hover:text-sidebar-foreground/60 transition-colors cursor-pointer"
      >
        {label}
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open &&
        items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={false} />
        ))}
    </>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [sectionState, setSectionState] = useState<Record<SectionKey, boolean>>({ settings: true, reports: true });
  const [mounted, setMounted] = useState(false);
  const { data: session } = authClient.useSession();

  useEffect(() => {
    setSectionState(loadSectionState());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) saveSectionState(sectionState);
  }, [sectionState, mounted]);

  const toggleSection = useCallback((key: SectionKey) => {
    setSectionState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const allCollapsed = SECTION_KEYS.every((k) => !sectionState[k]);

  function collapseAll() {
    const next = allCollapsed
      ? Object.fromEntries(SECTION_KEYS.map((k) => [k, true])) as Record<SectionKey, boolean>
      : Object.fromEntries(SECTION_KEYS.map((k) => [k, false])) as Record<SectionKey, boolean>;
    setSectionState(next);
  }

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center h-12 px-4">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="bg-transparent! border-none! p-1.5 rounded-md hover:bg-accent transition-colors mr-3"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-muted-foreground" />
            ) : (
              <PanelLeftClose className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          <Link href="/" className="no-underline flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <span className="text-sm font-bold tracking-tight">IndirectRates</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">v0.3</span>
            <ThemeToggle />
            {session?.user ? (
              <>
                <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-32">
                  {session.user.email}
                </span>
                <button
                  onClick={() => authClient.signOut()}
                  title="Sign out"
                  className="p-1.5 rounded-md hover:bg-accent transition-colors bg-transparent! border-none!"
                >
                  <LogOut className="w-4 h-4 text-muted-foreground" />
                </button>
              </>
            ) : (
              <Link
                href="/auth/signin"
                title="Sign in"
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors no-underline"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col overflow-y-auto transition-[width] duration-200 ${
            collapsed ? "w-14" : "w-52"
          }`}
        >
          <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
            <NavLink item={{ href: "/", label: "Home", icon: Home }} active={isActive("/")} collapsed={collapsed} />

            {!collapsed && (
              <button
                onClick={collapseAll}
                className="flex items-center gap-2 w-full px-3 py-1.5 mt-1 rounded-md text-[11px] bg-transparent! border-none! text-sidebar-foreground/40 hover:text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors cursor-pointer"
                title={allCollapsed ? "Expand all sections" : "Collapse all sections"}
              >
                <ChevronsDownUp className="w-3.5 h-3.5" />
                {allCollapsed ? "Expand all" : "Collapse all"}
              </button>
            )}

            {SECTIONS.map((section) => (
              <NavSection
                key={section.key}
                label={section.label}
                items={section.items}
                open={sectionState[section.key]}
                onToggle={() => toggleSection(section.key)}
                sidebarCollapsed={collapsed}
                isActive={isActive}
              />
            ))}
          </nav>

        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
