"use client";

import { useState } from "react";
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
} from "lucide-react";

import { ChatPanel } from "./components/ChatPanel";
import { seedTestData, clearTestData } from "../lib/api";

const WORKFLOW_STEPS = [
  {
    icon: Calendar,
    title: "Define Fiscal Years",
    description: "Set up your fiscal year periods with start and end months.",
    href: "/fiscal-years",
  },
  {
    icon: BookOpen,
    title: "Import Chart of Accounts",
    description: "Add your GL accounts — individually or via bulk CSV import. These become available for pool assignment.",
    href: "/chart-of-accounts",
  },
  {
    icon: Layers,
    title: "Configure Pool Setup",
    description: "Create rate groups and pool groups (Fringe, OH, G&A). Use the shuttle UI to assign GL accounts as cost accounts (numerator) and base accounts (denominator).",
    href: "/pools",
  },
  {
    icon: GitFork,
    title: "Review Cost Structure",
    description: "Verify your allocation formulas, cascade flow, and GL account assignments per rate group.",
    href: "/cost-structure",
  },
  {
    icon: Tags,
    title: "Set Up Mappings",
    description: "Define cost category mappings and configure any additional account classifications.",
    href: "/mappings",
  },
  {
    icon: Play,
    title: "Run Forecast",
    description: "Upload GL actuals, choose a scenario, and generate rate projections with the management pack.",
    href: "/forecast",
  },
];

const QUICK_LINKS = [
  { href: "/fiscal-years", label: "Fiscal Years", icon: Calendar },
  { href: "/chart-of-accounts", label: "Chart of Accounts", icon: BookOpen },
  { href: "/pools", label: "Pool Setup", icon: Layers },
  { href: "/cost-structure", label: "Cost Structure", icon: GitFork },
  { href: "/forecast", label: "Forecast", icon: BarChart3 },
  { href: "/rates", label: "Rates", icon: Calculator },
  { href: "/psr", label: "PSR", icon: BarChart3 },
];

export default function HomePage() {
  const [seedMsg, setSeedMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const res = await seedTestData();
      setSeedMsg({
        type: "success",
        text: `Loaded ${res.chart_accounts} accounts, ${res.pool_groups} pool groups, ${res.gl_mappings} GL mappings, ${res.csv_files} CSV files into ${res.fiscal_year}.`,
      });
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
    } catch (e: any) {
      setSeedMsg({ type: "error", text: e.message || "Failed to clear data" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <main className="container" style={{ maxWidth: 900 }}>
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "48px 0 32px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <FileSpreadsheet className="w-12 h-12 text-primary" />
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>IndirectRates</h1>
        <p className="muted" style={{ fontSize: 16, margin: 0 }}>
          Indirect rates forecasting &mdash; Fringe, Overhead, and G&amp;A &mdash; built for auditability.
        </p>
      </div>

      {/* Workflow */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Workflow</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <Link key={i} href={step.href} className="no-underline" style={{ color: "inherit" }}>
              <div
                style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}
                className="hover:bg-accent/30 rounded-md p-2 -m-2 transition-colors"
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                  className="bg-sidebar-accent"
                >
                  <step.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                    {i + 1}. {step.title}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {step.description}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Quick Links</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="no-underline">
              <span className="badge"><link.icon className="w-3 h-3" /> {link.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Sample Data */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>
          <Database className="w-5 h-5 inline-block mr-2" style={{ verticalAlign: "text-bottom" }} />
          Sample Test Data
        </h2>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
          Load a complete FY2025-TEST setup: 20 GL accounts, Fringe/OH/G&amp;A pools, and 6 months of actuals with 3 projects.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={handleSeed}
            disabled={seeding || clearing}
            className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {seeding ? "Loading..." : "Load Sample Data"}
          </button>
          <button
            onClick={handleClear}
            disabled={seeding || clearing}
            className="btn btn-outline"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {clearing ? "Clearing..." : "Clear Sample Data"}
          </button>
        </div>
        {seedMsg && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 13,
              backgroundColor: seedMsg.type === "success" ? "var(--color-success-bg, #e6f9e6)" : "var(--color-error-bg, #fde8e8)",
              color: seedMsg.type === "success" ? "var(--color-success, #166534)" : "var(--color-error, #991b1b)",
              border: `1px solid ${seedMsg.type === "success" ? "var(--color-success-border, #bbf7d0)" : "var(--color-error-border, #fecaca)"}`,
            }}
          >
            {seedMsg.text}
          </div>
        )}
      </section>

      {/* Chat */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Ask the Rate Analyst</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Chat with Gemini about indirect rates, pool structures, and cost forecasting.
        </div>
        <ChatPanel />
      </section>
    </main>
  );
}
