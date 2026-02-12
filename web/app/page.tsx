"use client";

import JSZip from "jszip";
import { useState } from "react";

import { ChatKitPanel } from "./components/ChatKitPanel";

export default function Page() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [gl, setGl] = useState<File | null>(null);
  const [map, setMap] = useState<File | null>(null);
  const [direct, setDirect] = useState<File | null>(null);
  const [events, setEvents] = useState<File | null>(null);
  const [config, setConfig] = useState<File | null>(null);

  const [scenario, setScenario] = useState("");
  const [forecastMonths, setForecastMonths] = useState(12);
  const [runRateMonths, setRunRateMonths] = useState(3);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [narrative, setNarrative] = useState<string>("");
  const [assumptions, setAssumptions] = useState<string>("");
  const [chartUrls, setChartUrls] = useState<string[]>([]);

  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [excelDownloadUrl, setExcelDownloadUrl] = useState<string | null>(null);

  async function runForecast() {
    setRunning(true);
    setError(null);
    setNarrative("");
    setAssumptions("");
    setChartUrls([]);

    try {
      const form = new FormData();
      if (scenario.trim()) form.set("scenario", scenario.trim());
      form.set("forecast_months", String(forecastMonths));
      form.set("run_rate_months", String(runRateMonths));

      if (zipFile) {
        form.set("inputs_zip", zipFile, zipFile.name);
      } else {
        if (!gl || !map || !direct || !events) {
          throw new Error("Upload either a ZIP, or all 4 required CSV files.");
        }
        form.set("gl_actuals", gl, "GL_Actuals.csv");
        form.set("account_map", map, "Account_Map.csv");
        form.set("direct_costs", direct, "Direct_Costs_By_Project.csv");
        form.set("scenario_events", events, "Scenario_Events.csv");
      }
      if (config) {
        form.set("config_yaml", config, config.name);
      }

      const resp = await fetch("/api/forecast", { method: "POST", body: form });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Forecast failed: HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      if (zipDownloadUrl) URL.revokeObjectURL(zipDownloadUrl);
      const newZipUrl = URL.createObjectURL(blob);
      setZipDownloadUrl(newZipUrl);

      const zip = await JSZip.loadAsync(blob);

      const narrativeFile = zip.file("narrative.md");
      const assumptionsFile = zip.file("assumptions.json");
      const excelFile = zip.file("rate_pack.xlsx");

      if (narrativeFile) setNarrative(await narrativeFile.async("string"));
      if (assumptionsFile) setAssumptions(await assumptionsFile.async("string"));

      if (excelFile) {
        const excelBlob = await excelFile.async("blob");
        if (excelDownloadUrl) URL.revokeObjectURL(excelDownloadUrl);
        setExcelDownloadUrl(URL.createObjectURL(excelBlob));
      } else {
        setExcelDownloadUrl(null);
      }

      // Charts: charts/*.png
      const charts: string[] = [];
      await Promise.all(
        Object.keys(zip.files).map(async (name) => {
          if (!name.startsWith("charts/") || !name.endsWith(".png")) return;
          const file = zip.file(name);
          if (!file) return;
          const imgBlob = await file.async("blob");
          charts.push(URL.createObjectURL(imgBlob));
        })
      );
      charts.sort();
      setChartUrls(charts);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="container">
      <h1 style={{ marginTop: 0, marginBottom: 6 }}>Indirect Rate Forecasting Agent</h1>
      <div className="muted" style={{ marginBottom: 16 }}>
        Upload inputs → run → download the pack. (The forecasting engine runs in the Python API; this UI can be hosted on
        Vercel.)
      </div>

      <div className="row">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>1) Upload inputs</h2>

          <div className="field">
            <label>Option A: Upload a ZIP containing the 4 CSVs</label>
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] || null)}
            />
            <div className="muted">ZIP should include: GL_Actuals.csv, Account_Map.csv, Direct_Costs_By_Project.csv, Scenario_Events.csv</div>
          </div>

          <div className="field">
            <label>Option B: Upload each CSV</label>
            <input type="file" accept=".csv" onChange={(e) => setGl(e.target.files?.[0] || null)} />
            <input type="file" accept=".csv" onChange={(e) => setMap(e.target.files?.[0] || null)} />
            <input type="file" accept=".csv" onChange={(e) => setDirect(e.target.files?.[0] || null)} />
            <input type="file" accept=".csv" onChange={(e) => setEvents(e.target.files?.[0] || null)} />
          </div>

          <div className="field">
            <label>Optional: Upload a rates config YAML</label>
            <input type="file" accept=".yaml,.yml" onChange={(e) => setConfig(e.target.files?.[0] || null)} />
          </div>

          <h2>2) Run</h2>
          <div className="field">
            <label>Scenario (blank runs all scenarios found)</label>
            <input value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="Base / Win / Lose" />
          </div>
          <div className="field">
            <label>Forecast months</label>
            <input
              type="number"
              min={1}
              max={36}
              value={forecastMonths}
              onChange={(e) => setForecastMonths(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Run-rate months</label>
            <input
              type="number"
              min={1}
              max={12}
              value={runRateMonths}
              onChange={(e) => setRunRateMonths(Number(e.target.value))}
            />
          </div>

          <button onClick={runForecast} disabled={running}>
            {running ? "Running..." : "Run forecast"}
          </button>

          {error && (
            <div style={{ marginTop: 12 }} className="error">
              {error}
            </div>
          )}

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {zipDownloadUrl && (
              <a href={zipDownloadUrl} download="rate_pack_output.zip">
                <button style={{ width: "100%" }} disabled={running}>
                  Download output ZIP
                </button>
              </a>
            )}
            {excelDownloadUrl && (
              <a href={excelDownloadUrl} download="rate_pack.xlsx">
                <button style={{ width: "100%" }} disabled={running}>
                  Download rate_pack.xlsx
                </button>
              </a>
            )}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Results preview</h2>
          <div className="muted" style={{ marginBottom: 10 }}>
            Narrative + assumptions are read from the generated ZIP so you can quickly sanity-check the run.
          </div>

          {narrative ? (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13, lineHeight: 1.35 }}>{narrative}</pre>
          ) : (
            <div className="muted">Run a forecast to see the narrative here.</div>
          )}

          {assumptions && (
            <>
              <h3>Assumptions (json)</h3>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12, lineHeight: 1.35, opacity: 0.95 }}>
                {assumptions}
              </pre>
            </>
          )}
        </section>
      </div>

      <div style={{ height: 16 }} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Charts</h2>
        {chartUrls.length ? (
          <div className="charts">
            {chartUrls.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={u} src={u} alt="Rate chart" style={{ width: "100%", borderRadius: 10 }} />
            ))}
          </div>
        ) : (
          <div className="muted">Charts will appear here after a run.</div>
        )}
      </section>

      <div style={{ height: 16 }} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Ask questions (OpenAI)</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Hosted ChatKit. Set `OPENAI_API_KEY` and `CHATKIT_WORKFLOW_ID` on the server (Vercel env vars).
        </div>
        <ChatKitPanel />
      </section>
    </main>
  );
}
