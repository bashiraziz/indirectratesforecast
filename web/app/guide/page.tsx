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
    sub: [{ label: "Set name, start month, and end month for your contract period." }],
  },
  {
    label: "Upload GL Actuals — pick one option:",
    sub: [
      {
        label: "Option A: GL Ledger page — add/edit individual entries, import CSV, or export",
        href: "/gl-ledger",
        note: "Recommended: entries stored in DB, editable anytime",
      },
      {
        label: "Option B: Data Files page — upload a GL_Actuals.csv blob",
        href: "/data",
        note: "Simpler; file replaced on each upload",
      },
    ],
  },
  {
    label: "Upload Direct Costs by Project",
    href: "/data",
    sub: [{ label: "Upload Direct_Costs_By_Project.csv via Data Files." }],
  },
  {
    label: "Configure Account Map — pick one option:",
    sub: [
      {
        label: "Option A: Pools + Mappings pages — build pool groups, pools, and GL mappings in the UI",
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

export default function GuidePage() {
  return (
    <main className="container" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0, marginBottom: 6 }}>User Guide</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Quick walkthroughs for guest evaluation and full registered workflows.
      </p>

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

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Registered Path</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          <strong>Data source priority:</strong> If GL Ledger entries exist for the fiscal year, they are used as the GL
          actuals source. Otherwise the system falls back to the uploaded GL_Actuals.csv file.
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
                      {sub.href ? (
                        <Link href={sub.href}>{sub.label}</Link>
                      ) : (
                        sub.label
                      )}
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

