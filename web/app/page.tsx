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
import {
  seedTestData,
  clearTestData,
  seedDemoData,
  clearDemoData,
  getDashboardSummary,
  downloadForecastRun,
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
        <Link href={`/forecast?fy=${fy.id}`}>
          <button className="btn btn-primary" style={{ fontSize: 12, padding: "4px 12px", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Play className="w-3 h-3" /> Forecast
          </button>
        </Link>
        <Link href={`/rates?fy=${fy.id}`}>
          <button className="btn btn-outline" style={{ fontSize: 12, padding: "4px 12px", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Calculator className="w-3 h-3" /> Rates
          </button>
        </Link>
        <Link href={`/psr?fy=${fy.id}`}>
          <button className="btn btn-outline" style={{ fontSize: 12, padding: "4px 12px", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <BarChart3 className="w-3 h-3" /> PSR
          </button>
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

const WORKFLOW_STEPS = [
  { icon: Calendar, title: "Fiscal Years", href: "/fiscal-years" },
  { icon: BookOpen, title: "Chart of Accounts", href: "/chart-of-accounts" },
  { icon: Layers, title: "Pool Setup", href: "/pools" },
  { icon: GitFork, title: "Cost Structure", href: "/cost-structure" },
  { icon: Tags, title: "Mappings", href: "/mappings" },
  { icon: Play, title: "Forecast", href: "/forecast" },
];

export default function HomePage() {
  const { data: session } = authClient.useSession();
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupExpanded, setSetupExpanded] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);

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

  const hasFYs = dashboard && dashboard.fiscal_years.length > 0;
  const totalRuns = dashboard ? dashboard.fiscal_years.reduce((s, f) => s + f.forecast_runs, 0) : 0;
  const totalScenarios = dashboard ? dashboard.fiscal_years.reduce((s, f) => s + f.scenarios, 0) : 0;
  const totalGL = dashboard ? dashboard.fiscal_years.reduce((s, f) => s + f.chart_accounts, 0) : 0;

  return (
    <main className="container" style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={{ textAlign: "center", padding: "40px 0 24px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <FileSpreadsheet className="w-10 h-10 text-primary" />
        </div>
        <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>IndirectRates</h1>
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          Indirect rates forecasting &mdash; Fringe, Overhead, and G&amp;A &mdash; built for auditability.
        </p>
      </div>

      {!session?.user && !loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            marginBottom: 16,
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-primary) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
            fontSize: 13,
          }}
        >
          <span>Guest mode — fiscal year data won&apos;t be saved across sessions.</span>
          <a href="/auth/signin" style={{ marginLeft: "auto", fontWeight: 600, color: "var(--color-primary)" }}>
            Sign in →
          </a>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Loader2 className="w-6 h-6 animate-spin text-primary" style={{ margin: "0 auto" }} />
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Loading dashboard...</div>
        </div>
      )}

      {error && !loading && (
        <div className="card" style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
          <AlertCircle className="w-6 h-6" style={{ margin: "0 auto 8px", color: "var(--color-destructive)" }} />
          <div style={{ fontSize: 14 }}>Could not load dashboard data</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{error}</div>
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={loadDashboard}>Retry</button>
        </div>
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
              <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Get Started</h2>
              <p className="muted" style={{ fontSize: 13, margin: "0 0 16px", maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
                No fiscal years configured yet. Load sample data below or create a fiscal year to begin.
              </p>
              <Link href="/fiscal-years">
                <button className="btn btn-primary">Create Fiscal Year</button>
              </Link>
            </section>
          )}

          {/* Recent Runs */}
          <RecentRunsTable runs={dashboard.recent_runs} />

          {/* Workflow Stepper (compact) */}
          <section className="card" style={{ marginBottom: 16, padding: "12px 20px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>Setup Workflow</h2>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {WORKFLOW_STEPS.map((step, i) => (
                <Link key={i} href={step.href} className="no-underline">
                  <span
                    className="badge"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    <step.icon className="w-3 h-3" />
                    {i + 1}. {step.title}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {/* Seed Data (collapsible) */}
          <section className="card" style={{ marginBottom: 16 }}>
            <button
              onClick={() => setSetupExpanded(!setupExpanded)}
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
                  {seedMsg && (
                    <div style={{
                      marginTop: 8, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                      backgroundColor: seedMsg.type === "success" ? "var(--color-success-bg, #e6f9e6)" : "var(--color-error-bg, #fde8e8)",
                      color: seedMsg.type === "success" ? "var(--color-success, #166534)" : "var(--color-error, #991b1b)",
                      border: `1px solid ${seedMsg.type === "success" ? "var(--color-success-border, #bbf7d0)" : "var(--color-error-border, #fecaca)"}`,
                    }}>
                      {seedMsg.text}
                    </div>
                  )}
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
                  {demoMsg && (
                    <div style={{
                      marginTop: 8, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                      backgroundColor: demoMsg.type === "success" ? "var(--color-success-bg, #e6f9e6)" : "var(--color-error-bg, #fde8e8)",
                      color: demoMsg.type === "success" ? "var(--color-success, #166534)" : "var(--color-error, #991b1b)",
                      border: `1px solid ${demoMsg.type === "success" ? "var(--color-success-border, #bbf7d0)" : "var(--color-error-border, #fecaca)"}`,
                    }}>
                      {demoMsg.text}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
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
