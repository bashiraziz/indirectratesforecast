"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Calculator,
  FileSpreadsheet,
  GitFork,
  Layers,
  Calendar,
  Tags,
  Play,
  Database,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  ChevronDown,
  ChevronUp,
  Activity,
  TrendingUp,
  MessageCircle,
} from "lucide-react";

import { ChatPanel } from "./components/ChatPanel";
import { InlineNotice } from "./components/InlineNotice";
import {
  seedTestData,
  clearTestData,
  seedDemoData,
  clearDemoData,
  getDashboardSummary,
  downloadForecastRun,
  getStorageUsage,
} from "../lib/api";
import type { DashboardSummary, FYSummary, RecentRun } from "../lib/types";
import { authClient } from "@/lib/auth-client";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ElementType }) {
  return (
    <div className="card" style={{ padding: "16px 20px", textAlign: "center", flex: "1 1 0", minWidth: 140 }}>
      <Icon className="w-5 h-5 text-primary" style={{ margin: "0 auto 6px" }} />
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ConfigBadge({ count, label }: { count: number; label: string }) {
  const ok = count > 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 12,
        backgroundColor: ok ? "var(--color-success-bg, #e6f9e6)" : "var(--color-muted)",
        color: ok ? "var(--color-success, #166534)" : "var(--color-muted-foreground)",
      }}
    >
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
      {count} {label}
    </span>
  );
}

function FYCard({ fy }: { fy: FYSummary }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{fy.name}</h3>
          <div className="muted" style={{ fontSize: 12 }}>{fy.start_month} to {fy.end_month}</div>
        </div>
        {fy.forecast_runs > 0 && (
          <span className="badge" style={{ fontSize: 11 }}>
            <Activity className="w-3 h-3" /> {fy.forecast_runs} run{fy.forecast_runs !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <ConfigBadge count={fy.pool_groups} label="pools" />
        <ConfigBadge count={fy.gl_mappings} label="GL maps" />
        <ConfigBadge count={fy.chart_accounts} label="accounts" />
        <ConfigBadge count={fy.scenarios} label="scenarios" />
      </div>

      {(fy.reference_rates.budget > 0 || fy.reference_rates.provisional > 0 || fy.revenue_entries > 0) && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          {fy.reference_rates.budget > 0 && <span style={{ marginRight: 12 }}>Budget rates: {fy.reference_rates.budget}</span>}
          {fy.reference_rates.provisional > 0 && <span style={{ marginRight: 12 }}>Provisional: {fy.reference_rates.provisional}</span>}
          {fy.revenue_entries > 0 && <span>Revenue entries: {fy.revenue_entries}</span>}
        </div>
      )}

      {fy.latest_run && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Last forecast: {formatDate(fy.latest_run)}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={`/forecast?fy=${fy.id}`} className="btn btn-primary no-underline inline-flex items-center gap-1" style={{ fontSize: 12, padding: "4px 12px" }}>
          <Play className="w-3 h-3" /> Forecast
        </Link>
        <Link href={`/rates?fy=${fy.id}`} className="btn btn-outline no-underline inline-flex items-center gap-1" style={{ fontSize: 12, padding: "4px 12px" }}>
          <Calculator className="w-3 h-3" /> Rates
        </Link>
        <Link href={`/psr?fy=${fy.id}`} className="btn btn-outline no-underline inline-flex items-center gap-1" style={{ fontSize: 12, padding: "4px 12px" }}>
          <BarChart3 className="w-3 h-3" /> PSR
        </Link>
      </div>
    </div>
  );
}

function RecentRunsTable({ runs }: { runs: RecentRun[] }) {
  const [downloading, setDownloading] = useState<number | null>(null);

  const handleDownload = async (runId: number) => {
    setDownloading(runId);
    try {
      const blob = await downloadForecastRun(runId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `forecast_run_${runId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail
    } finally {
      setDownloading(null);
    }
  };

  if (runs.length === 0) return null;

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>
        <TrendingUp className="w-4 h-4 inline-block mr-2" style={{ verticalAlign: "text-bottom" }} />
        Recent Forecast Runs
      </h2>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th>Fiscal Year</th>
              <th>Scenario</th>
              <th>Months</th>
              <th>Date</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.fiscal_year_name || "-"}</td>
                <td>{run.scenario || "Base"}</td>
                <td>{run.forecast_months}</td>
                <td>{formatDate(run.created_at)}</td>
                <td>{formatBytes(run.zip_size)}</td>
                <td>
                  <button
                    className="btn btn-outline"
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    onClick={() => handleDownload(run.id)}
                    disabled={downloading === run.id}
                  >
                    {downloading === run.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type SetupStep = {
  icon: React.ElementType;
  title: string;
  href: string;
  description: string;
  done: boolean;
};

type WalkthroughStep = {
  title: string;
  detail: string;
  href: string;
  cta: string;
};

type AccessRow = {
  feature: string;
  guest: string;
  registered: string;
};

export default function HomePage() {
  const { data: session } = authClient.useSession();
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const [storageUsage, setStorageUsage] = useState<{ used_mb: number; max_mb: number; pct_used: number } | null>(null);

  const [howToExpanded, setHowToExpanded] = useState(false);

  useEffect(() => {
    const savedHowTo = localStorage.getItem("home-howto-expanded");
    if (savedHowTo !== null) setHowToExpanded(savedHowTo === "true");
    const savedSetup = localStorage.getItem("home-setup-expanded");
    if (savedSetup !== null) setSetupExpanded(savedSetup === "true");
  }, []);

  function toggleHowTo() {
    const next = !howToExpanded;
    setHowToExpanded(next);
    try { localStorage.setItem("home-howto-expanded", String(next)); } catch {}
  }

  function toggleSetup() {
    const next = !setupExpanded;
    setSetupExpanded(next);
    try { localStorage.setItem("home-setup-expanded", String(next)); } catch {}
  }

  const [seedMsg, setSeedMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [demoMsg, setDemoMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [clearingDemo, setClearingDemo] = useState(false);

  const loadDashboard = async () => {
    try {
      const data = await getDashboardSummary();
      setDashboard(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (!session?.user) {
        setStorageUsage(null);
        return;
      }
      try {
        const usage = await getStorageUsage();
        if (!cancelled) {
          setStorageUsage({
            used_mb: usage.used_mb,
            max_mb: usage.max_mb,
            pct_used: usage.pct_used,
          });
        }
      } catch {
        if (!cancelled) setStorageUsage(null);
      }
    }
    loadStorage();
    return () => {
      cancelled = true;
    };
  }, [session?.user]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const res = await seedTestData();
      setSeedMsg({
        type: "success",
        text: `Loaded ${res.chart_accounts} accounts, ${res.pool_groups} pool groups, ${res.gl_mappings} GL mappings into ${res.fiscal_year}.`,
      });
      loadDashboard();
    } catch (e: any) {
      setSeedMsg({ type: "error", text: e.message || "Failed to seed data" });
    } finally {
      setSeeding(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setSeedMsg(null);
    try {
      const res = await clearTestData();
      setSeedMsg({
        type: "success",
        text: res.deleted_fy
          ? `Cleared FY2025-TEST and ${res.csv_files_removed} CSV files.`
          : "No test data found to clear.",
      });
      loadDashboard();
    } catch (e: any) {
      setSeedMsg({ type: "error", text: e.message || "Failed to clear data" });
    } finally {
      setClearing(false);
    }
  };

  const handleSeedDemo = async () => {
    setSeedingDemo(true);
    setDemoMsg(null);
    try {
      const res = await seedDemoData();
      setDemoMsg({
        type: "success",
        text: `Loaded ${res.fiscal_years} fiscal years (${res.fiscal_year_names.join(", ")}), ${res.chart_accounts} GL accounts, ${res.scenarios} scenarios.`,
      });
      loadDashboard();
    } catch (e: any) {
      setDemoMsg({ type: "error", text: e.message || "Failed to seed demo data" });
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleClearDemo = async () => {
    setClearingDemo(true);
    setDemoMsg(null);
    try {
      const res = await clearDemoData();
      setDemoMsg({
        type: "success",
        text: res.deleted_fiscal_years > 0
          ? `Cleared ${res.deleted_fiscal_years} demo fiscal years and ${res.csv_files_removed} CSV files.`
          : "No demo data found to clear.",
      });
      loadDashboard();
    } catch (e: any) {
      setDemoMsg({ type: "error", text: e.message || "Failed to clear demo data" });
    } finally {
      setClearingDemo(false);
    }
  };

  const hasFYs = Boolean(dashboard && dashboard.fiscal_years.length > 0);
  const hasAccounts = Boolean(dashboard?.fiscal_years.some((f) => f.chart_accounts > 0));
  const hasPools = Boolean(dashboard?.fiscal_years.some((f) => f.pool_groups > 0 && f.gl_mappings > 0));
  const hasScenarios = Boolean(dashboard?.fiscal_years.some((f) => f.scenarios > 0));
  const hasInputs = Boolean(
    dashboard?.fiscal_years.some(
      (f) => f.reference_rates.budget > 0 || f.reference_rates.provisional > 0 || f.revenue_entries > 0
    )
  );
  const hasRuns = Boolean(dashboard?.recent_runs.length);
  const setupSteps: SetupStep[] = [
    {
      icon: Calendar,
      title: "Create fiscal year",
      href: "/fiscal-years",
      description: "Start with fiscal-year dates and label.",
      done: hasFYs,
    },
    {
      icon: BookOpen,
      title: "Load chart of accounts",
      href: "/chart-of-accounts",
      description: "Import or add GL accounts.",
      done: hasAccounts,
    },
    {
      icon: Layers,
      title: "Build pool mappings",
      href: "/mappings",
      description: "Define pools and map GL accounts.",
      done: hasPools,
    },
    {
      icon: Tags,
      title: "Add rates or revenue",
      href: "/rates",
      description: "Upload budget/provisional rates and revenue.",
      done: hasInputs,
    },
    {
      icon: GitFork,
      title: "Create scenarios",
      href: "/scenarios",
      description: "Add baseline and what-if assumptions.",
      done: hasScenarios,
    },
    {
      icon: Play,
      title: "Run forecast",
      href: "/forecast",
      description: "Generate the output pack and review trends.",
      done: hasRuns,
    },
  ];
  const completedSetupSteps = setupSteps.filter((s) => s.done).length;
  const isAuthError = Boolean(error && /auth|unauthoriz/i.test(error));
  const totalRuns = dashboard ? dashboard.fiscal_years.reduce((s, f) => s + f.forecast_runs, 0) : 0;
  const totalScenarios = dashboard ? dashboard.fiscal_years.reduce((s, f) => s + f.scenarios, 0) : 0;
  const totalGL = dashboard ? dashboard.fiscal_years.reduce((s, f) => s + f.chart_accounts, 0) : 0;
  const guestWalkthrough: WalkthroughStep[] = [
    {
      title: "Open Try Demo",
      detail: "Use upload-only mode to kick the tires without an account.",
      href: "/try-demo",
      cta: "Open Try Demo",
    },
    {
      title: "Upload required CSV inputs",
      detail: "Upload one ZIP or 4 CSVs. Use templates in the Forecast page.",
      href: "/try-demo",
      cta: "Upload Inputs",
    },
    {
      title: "Run forecast and download output",
      detail: "Run once, review tables/charts, then download ZIP/Excel output.",
      href: "/try-demo",
      cta: "Run Forecast",
    },
  ];
  const registeredWalkthrough: WalkthroughStep[] = [
    {
      title: "Sign in and create a fiscal year",
      detail: "Create your workspace so data is scoped and persisted.",
      href: "/auth/signin",
      cta: "Sign In",
    },
    {
      title: "Configure COA, pools, mappings, scenarios",
      detail: "Use setup pages to build reusable DB-backed configuration.",
      href: "/fiscal-years",
      cta: "Start Setup",
    },
    {
      title: "Run forecasts from DB or uploads",
      detail: "Track run history and reuse files and setups across sessions.",
      href: "/forecast",
      cta: "Open Forecast",
    },
  ];
  const accessRows: AccessRow[] = [
    { feature: "Upload CSV forecast runs", guest: "Yes (Try Demo)", registered: "Yes" },
    { feature: "Save fiscal years and setup", guest: "No", registered: "Yes" },
    { feature: "Use DB configuration pages", guest: "No", registered: "Yes" },
    { feature: "Seed sample and demo datasets", guest: "No", registered: "Yes" },
    { feature: "Forecast run history", guest: "No", registered: "Yes" },
    { feature: "File storage and quota tracking", guest: "No persistent storage", registered: "Yes (per-account quota)" },
    { feature: "Tenant-isolated data", guest: "Not applicable", registered: "Yes" },
  ];

  return (
    <main className="container" style={{ maxWidth: 960 }}>
      {/* Block 1 — Primary CTA */}
      <div style={{ textAlign: "center", padding: "48px 0 28px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <FileSpreadsheet className="w-11 h-11 text-primary" />
        </div>
        <h1 style={{ margin: "0 0 10px", fontSize: 32, fontWeight: 700, letterSpacing: "-0.5px", lineHeight: 1.15 }}>
          Forecast indirect rates.<br />Stay audit-ready.
        </h1>
        <p style={{ fontSize: 15, margin: "0 auto", maxWidth: 480, lineHeight: 1.6, color: "var(--color-muted-foreground)" }}>
          Monthly Fringe, Overhead, and G&amp;A projections with scenario modeling.
          Every rate backed by pool&nbsp;÷&nbsp;base math — transparent, traceable, and audit-ready.
        </p>
      </div>

      {!loading && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 28 }}>
          {!session?.user ? (
            <>
              <Link href="/try-demo" className="btn btn-primary no-underline">Try Demo</Link>
              <Link href="/auth/signin" className="btn btn-outline no-underline">Sign In</Link>
            </>
          ) : !hasFYs ? (
            <>
              <Link href="/fiscal-years" className="btn btn-primary no-underline">Create Fiscal Year</Link>
              <button onClick={handleSeedDemo} className="btn btn-outline" disabled={seedingDemo}>
                {seedingDemo && <Loader2 className="w-3 h-3 animate-spin inline-block mr-1" />}
                Load Demo
              </button>
            </>
          ) : (
            <>
              <Link href="/forecast" className="btn btn-primary no-underline">Go to Forecast</Link>
              <Link href="/rates" className="btn btn-outline no-underline">View Rates</Link>
            </>
          )}
        </div>
      )}

      {/* Block 2 — Status / Stats */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Loader2 className="w-6 h-6 animate-spin text-primary" style={{ margin: "0 auto" }} />
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Loading dashboard...</div>
        </div>
      )}

      {error && !loading && !(!session?.user && isAuthError) && (
        <div className="card" style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
          <AlertCircle className="w-6 h-6" style={{ margin: "0 auto 8px", color: "var(--color-destructive)" }} />
          <div style={{ fontSize: 14 }}>Could not load dashboard data</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{error}</div>
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={loadDashboard}>Retry</button>
        </div>
      )}

      {!session?.user && isAuthError && !loading && (
        <section className="card" style={{ padding: 24, textAlign: "center", marginBottom: 16 }}>
          <AlertCircle className="w-6 h-6" style={{ margin: "0 auto 8px", color: "var(--color-primary)" }} />
          <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Sign in required</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            This deployment requires authentication before dashboard data can be loaded.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/try-demo" className="btn btn-outline no-underline">Try Demo</Link>
            <Link href="/auth/signin" className="btn btn-primary no-underline">Continue to sign in</Link>
          </div>
        </section>
      )}

      {session?.user && storageUsage && (
        <section className="card" style={{ marginBottom: 16, padding: "14px 18px" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15 }}>Storage Quota</h2>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {storageUsage.used_mb.toFixed(1)} MB used of {storageUsage.max_mb.toFixed(0)} MB ({storageUsage.pct_used.toFixed(1)}%)
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "var(--color-muted)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, storageUsage.pct_used)}%`,
                height: "100%",
                background:
                  storageUsage.pct_used >= 90
                    ? "var(--color-destructive)"
                    : storageUsage.pct_used >= 70
                      ? "#f59e0b"
                      : "var(--color-primary)",
              }}
            />
          </div>
        </section>
      )}

      {!loading && dashboard && (
        <>
          {/* Summary Stats */}
          {hasFYs && (
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <StatCard label="Fiscal Years" value={dashboard.fiscal_years.length} icon={Calendar} />
              <StatCard label="Forecast Runs" value={totalRuns} icon={TrendingUp} />
              <StatCard label="Scenarios" value={totalScenarios} icon={GitFork} />
              <StatCard label="GL Accounts" value={totalGL} icon={BookOpen} />
            </div>
          )}

          {/* FY Cards */}
          {hasFYs ? (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Fiscal Years</h2>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {dashboard.fiscal_years.map((fy) => (
                  <FYCard key={fy.id} fy={fy} />
                ))}
              </div>
            </section>
          ) : (
            <section className="card" style={{ marginBottom: 16, padding: 32, textAlign: "center" }}>
              <Database className="w-8 h-8 text-primary" style={{ margin: "0 auto 12px" }} />
              <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Nothing here yet</h2>
              <p className="muted" style={{ fontSize: 13, margin: "0 0 16px", maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
                Create a fiscal year to start forecasting, or load the demo dataset to explore the app right away.
              </p>
              <Link href="/fiscal-years" className="btn btn-primary no-underline">Create Fiscal Year</Link>
            </section>
          )}

          {/* Recent Runs */}
          <RecentRunsTable runs={dashboard.recent_runs} />

          {/* Setup Checklist */}
          <section className="card" style={{ marginBottom: 16, padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Setup Checklist</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {completedSetupSteps}/{setupSteps.length} done
              </span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {setupSteps.map((step) => (
                <Link key={step.title} href={step.href} className="no-underline">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      background: step.done
                        ? "color-mix(in srgb, var(--color-primary) 8%, transparent)"
                        : "transparent",
                    }}
                  >
                    {step.done ? (
                      <CheckCircle2 className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
                    ) : (
                      <step.icon className="w-4 h-4 muted" />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{step.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{step.description}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Block 3 — Resources & Dev Tools */}
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "center", padding: "16px 4px 4px" }}>
        Resources &amp; Dev Tools
      </div>

      {/* How To Use IndirectRates */}
      <section className="card" style={{ marginBottom: 16, padding: "16px 20px" }}>
        <button
          onClick={toggleHowTo}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: "inherit",
            fontSize: 16,
            fontWeight: 600,
            textAlign: "left",
          }}
        >
          <span>How To Use IndirectRates</span>
          {howToExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {howToExpanded && (
          <>
            <div className="muted" style={{ fontSize: 12, margin: "4px 0 12px" }}>
              Choose the path that fits your goal: quick evaluation or full saved workspace.
            </div>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                marginBottom: 12,
              }}
            >
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Guest Walkthrough (Try Demo)</h3>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {guestWalkthrough.map((step) => (
                    <li key={step.title} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{step.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{step.detail}</div>
                      <Link href={step.href} className="btn btn-outline no-underline" style={{ fontSize: 11, padding: "2px 8px" }}>{step.cta}</Link>
                    </li>
                  ))}
                </ol>
              </div>

              <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Registered Walkthrough</h3>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {registeredWalkthrough.map((step) => (
                    <li key={step.title} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{step.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{step.detail}</div>
                      <Link href={step.href} className="btn btn-outline no-underline" style={{ fontSize: 11, padding: "2px 8px" }}>{step.cta}</Link>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Guest vs Registered Access</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Guest</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRows.map((row) => (
                    <tr key={row.feature}>
                      <td>{row.feature}</td>
                      <td>{row.guest}</td>
                      <td>{row.registered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Sample & Demo Data */}
      {session?.user && (
        <section className="card" style={{ marginBottom: 16 }}>
          <button
            onClick={toggleSetup}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "inherit",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Database className="w-5 h-5" />
              Sample &amp; Demo Data
            </span>
            {setupExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {setupExpanded && (
            <div style={{ marginTop: 16 }}>
              {/* Test Data */}
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Test Data</h3>
                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                  FY2025-TEST: 20 GL accounts, Fringe/OH/G&amp;A pools, 6 months of actuals.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={handleSeed} disabled={seeding || clearing} className="btn btn-primary" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                    {seeding ? "Loading..." : "Load Test Data"}
                  </button>
                  <button onClick={handleClear} disabled={seeding || clearing} className="btn btn-outline" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    {clearing ? "Clearing..." : "Clear"}
                  </button>
                </div>
                <InlineNotice msg={seedMsg} />
              </div>

              {/* Demo Data */}
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Enterprise Demo Data</h3>
                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                  4 fiscal years, 30 projects, ~60 GL accounts, 48 months of actuals, budget &amp; provisional rates.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={handleSeedDemo} disabled={seedingDemo || clearingDemo} className="btn btn-primary" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {seedingDemo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                    {seedingDemo ? "Loading..." : "Load Demo Data"}
                  </button>
                  <button onClick={handleClearDemo} disabled={seedingDemo || clearingDemo} className="btn btn-outline" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {clearingDemo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    {clearingDemo ? "Clearing..." : "Clear"}
                  </button>
                </div>
                <InlineNotice msg={demoMsg} />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Chat */}
      <section className="card" ref={chatRef}>
        <h2 style={{ marginTop: 0 }}>Ask the Rate Analyst</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Chat with Gemini about indirect rates, pool structures, and cost forecasting.
        </div>
        <ChatPanel />
      </section>

      {/* Floating chat button */}
      <button
        onClick={() => chatRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
        title="Ask the Rate Analyst"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
          backgroundColor: "var(--color-primary)",
          color: "var(--color-primary-foreground)",
          zIndex: 50,
        }}
      >
        <MessageCircle className="w-5 h-5" />
      </button>
    </main>
  );
}
