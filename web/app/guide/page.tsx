import Link from "next/link";

const GUEST_STEPS = [
  "Open Try Demo and stay in upload mode.",
  "Upload either one ZIP or the 4 required CSV files.",
  "Run forecast, review rates/charts, then download ZIP/Excel outputs.",
];

const REGISTERED_STEPS = [
  "Sign in to create a tenant-scoped workspace.",
  "Configure Fiscal Years, COA, Pools, Mappings, Scenarios.",
  "Run forecasts from DB config or uploads and track run history.",
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
        <ol style={{ marginTop: 0, marginBottom: 10, paddingLeft: 20 }}>
          {REGISTERED_STEPS.map((s) => (
            <li key={s} style={{ marginBottom: 6 }}>{s}</li>
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

