import Link from "next/link";

const GUEST_STEPS = [
  "Open Try Demo and stay in upload mode.",
  "Upload either one ZIP or the 4 required CSV files.",
  "Run forecast, review rates/charts, then download ZIP/Excel outputs.",
];

interface RegisteredStep {
  label: string;
  sub?: { label: string; href?: string; note?: string }[];
  href?: string;
}

const REGISTERED_STEPS: RegisteredStep[] = [
  {
    label: "Create a Fiscal Year",
    href: "/fiscal-years",
    sub: [
      { label: "Set name, start month, and end month for your contract period." },
      {
        label: "Five standard cost categories are seeded automatically — see Cost Categories below.",
        note: "Labor, ODC, Subcontractor, Travel, Other Direct",
      },
    ],
  },
  {
    label: "Upload GL Actuals — pick one option:",
    sub: [
      {
        label: "Option A: GL Ledger — add/edit individual entries, import CSV, or export",
        href: "/gl-ledger",
        note: "Recommended: entries stored in DB, editable anytime",
      },
      {
        label: "Option B: Data Files — upload a GL_Actuals.csv blob",
        href: "/data",
        note: "Simpler; file replaced on each upload",
      },
    ],
  },
  {
    label: "Upload Direct Costs by Project — pick one option:",
    sub: [
      {
        label: "Option A: Direct Costs — add/edit individual rows, import CSV, or export",
        href: "/direct-costs",
        note: "Recommended: entries stored in DB, editable anytime",
      },
      {
        label: "Option B: Data Files — upload Direct_Costs_By_Project.csv blob",
        href: "/data",
      },
    ],
  },
  {
    label: "Configure Account Map — pick one option:",
    sub: [
      {
        label: "Option A: Pools + Mappings — build pool groups, pools, and GL mappings in the UI",
        href: "/pools",
        note: "Persistent DB config; recommended for recurring forecasts",
      },
      {
        label: "Option B: Data Files — upload Account_Map.csv blob",
        href: "/data",
      },
    ],
  },
  {
    label: "(Optional) Configure Scenarios",
    href: "/scenarios",
    sub: [{ label: "Add scenario events to model cost changes, new awards, or staffing adjustments." }],
  },
  {
    label: "Run Forecast in DB mode",
    href: "/forecast",
    sub: [{ label: "Select fiscal year, choose scenario and parameters, then run. Output ZIP and history are saved." }],
  },
  {
    label: "Review rates, download ZIP/Excel, and load prior runs from history",
    href: "/forecast",
    sub: [{ label: "Use the Rates and PSR/PST pages to drill into results." }],
  },
];

const DIFFERENCES = [
  { capability: "Upload CSV forecast run", guest: "Yes", registered: "Yes" },
  { capability: "Save fiscal-year setup", guest: "No", registered: "Yes" },
  { capability: "DB configuration pages", guest: "No", registered: "Yes" },
  { capability: "Forecast run history", guest: "No", registered: "Yes" },
  { capability: "Persistent file storage", guest: "No", registered: "Yes" },
  { capability: "Quota tracking", guest: "No", registered: "Yes" },
];

const COST_CATEGORIES = [
  {
    type: "Labor",
    name: "Direct Labor",
    isDirect: true,
    color: "bg-blue-500/10 text-blue-400",
    description:
      "Salaries and wages charged directly to contracts. Drives the Fringe and Overhead allocation bases. Captured as DirectLabor$ and DirectLaborHrs in the Direct Costs file.",
    rateImpact: "Fringe base · Overhead base",
  },
  {
    type: "ODC",
    name: "Other Direct Costs",
    isDirect: true,
    color: "bg-green-500/10 text-green-400",
    description:
      "Materials, equipment, supplies, and any other cost charged directly to a contract that is not labor, subcontract, or travel. Flows into Total Cost Input (TCI), the G&A allocation base.",
    rateImpact: "G&A base (TCI)",
  },
  {
    type: "Subcontractor",
    name: "Subcontractor",
    isDirect: true,
    color: "bg-orange-500/10 text-orange-400",
    description:
      "Costs paid to subcontractors or subrecipients performing work under the prime contract. Per FAR, subcontract costs are often excluded from the Overhead base but included in TCI for G&A.",
    rateImpact: "G&A base (TCI) · excluded from Overhead base",
  },
  {
    type: "Travel",
    name: "Travel",
    isDirect: true,
    color: "bg-purple-500/10 text-purple-400",
    description:
      "Airfare, lodging, per diem, and other travel costs billed directly to a contract. Included in TCI. DCAA requires travel costs to be separately identified and supported.",
    rateImpact: "G&A base (TCI)",
  },
  {
    type: "Other Direct",
    name: "Other Direct Costs",
    isDirect: true,
    color: "bg-gray-500/10 text-gray-400",
    description:
      "Catch-all for any direct cost not fitting the four categories above — e.g., consultant fees, training, or other contract-specific items. Also flows into TCI.",
    rateImpact: "G&A base (TCI)",
  },
];

export default function GuidePage() {
  return (
    <main className="container" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0, marginBottom: 6 }}>User Guide</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Quick walkthroughs for guest evaluation and full registered workflows.
      </p>

      {/* Guest path */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Guest Path (Try Demo)</h2>
        <ol style={{ marginTop: 0, marginBottom: 10, paddingLeft: 20 }}>
          {GUEST_STEPS.map((s) => (
            <li key={s} style={{ marginBottom: 6 }}>{s}</li>
          ))}
        </ol>
        <Link href="/try-demo">
          <button className="btn btn-primary">Open Try Demo</button>
        </Link>
      </section>

      {/* Registered path */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Registered Path</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          <strong>Data source priority:</strong> If GL Ledger or Direct Cost entries exist in the DB for
          the fiscal year, they are used first. Otherwise the system falls back to uploaded CSV file blobs.
        </p>
        <ol style={{ marginTop: 0, marginBottom: 10, paddingLeft: 20 }}>
          {REGISTERED_STEPS.map((step, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              {step.href ? (
                <Link href={step.href} style={{ fontWeight: 500 }}>
                  {step.label}
                </Link>
              ) : (
                <span style={{ fontWeight: 500 }}>{step.label}</span>
              )}
              {step.sub && (
                <ul style={{ marginTop: 4, paddingLeft: 18, listStyleType: "disc" }}>
                  {step.sub.map((sub, j) => (
                    <li key={j} style={{ marginBottom: 4, fontSize: 13 }}>
                      {sub.href ? <Link href={sub.href}>{sub.label}</Link> : sub.label}
                      {sub.note && (
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                          — {sub.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/auth/signin">
            <button className="btn btn-primary">Sign In</button>
          </Link>
          <Link href="/">
            <button className="btn btn-outline">Back To Home</button>
          </Link>
        </div>
      </section>

      {/* Cost Categories */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Cost Categories</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
          Cost categories classify where every dollar goes — the bridge between raw GL account numbers
          and the economic meaning of each cost. DCAA requires this classification to determine what is
          direct vs. indirect and what feeds into each rate pool base.
        </p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          <strong>These five categories are seeded automatically</strong> on every new fiscal year.
          You can add GL accounts to each via the{" "}
          <Link href="/cost-structure">Cost Structure</Link> page, and view the cascade formulas that
          show how each category flows into the rate calculation.
        </p>

        {/* Category cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {COST_CATEGORIES.map((cat) => (
            <div
              key={cat.type}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "12px 14px",
                display: "grid",
                gridTemplateColumns: "160px 1fr auto",
                gap: 12,
                alignItems: "start",
              }}
            >
              <div>
                <span
                  className={cat.color}
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 4,
                    marginBottom: 4,
                  }}
                >
                  {cat.type}
                </span>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{cat.name}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Direct cost</div>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                {cat.description}
              </p>
              <div
                style={{
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  color: "var(--color-muted-foreground)",
                  textAlign: "right",
                  minWidth: 160,
                }}
              >
                {cat.rateImpact}
              </div>
            </div>
          ))}
        </div>

        {/* Cascade formula */}
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "var(--color-accent)",
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Rate Cascade (DCAA-Correct Order)</div>
          <div style={{ fontFamily: "monospace", lineHeight: 2 }}>
            <div>
              <strong>Fringe Rate</strong> = Fringe Pool $ /{" "}
              <span style={{ color: "var(--color-primary)" }}>Direct Labor $</span>
            </div>
            <div>
              <strong>Overhead Rate</strong> = Overhead Pool $ /{" "}
              <span style={{ color: "var(--color-primary)" }}>
                Direct Labor $ + Fringe on DL
              </span>
            </div>
            <div>
              <strong>G&A Rate</strong> = G&A Pool $ /{" "}
              <span style={{ color: "var(--color-primary)" }}>
                Total Cost Input (DL + Subk + ODC + Travel + Overhead)
              </span>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            Each tier is applied in cascade order — earlier tiers are included in later tier bases.
            View and configure this in{" "}
            <Link href="/cost-structure">Cost Structure</Link>.
          </p>
        </div>
      </section>

      {/* Guest vs Registered */}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Guest vs Registered</h2>
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
              {DIFFERENCES.map((r) => (
                <tr key={r.capability}>
                  <td>{r.capability}</td>
                  <td>{r.guest}</td>
                  <td>{r.registered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Visual Walkthrough Assets</h2>
        <p className="muted" style={{ marginBottom: 8 }}>
          Add short GIFs/videos under `web/public/guide/` and link them here for step-by-step visuals.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          <code style={{ fontSize: 12 }}>web/public/guide/try-demo-upload.gif</code>
          <code style={{ fontSize: 12 }}>web/public/guide/registered-setup.gif</code>
          <code style={{ fontSize: 12 }}>web/public/guide/run-comparison.gif</code>
        </div>
      </section>
    </main>
  );
}
