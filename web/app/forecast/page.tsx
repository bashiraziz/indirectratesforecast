"use client";

import JSZip from "jszip";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import { ChatPanel } from "../components/ChatPanel";

interface FiscalYear {
  id: number;
  name: string;
  start_month: string;
  end_month: string;
}

type InputMode = "upload" | "db";

export default function ForecastPage() {
  const [inputMode, setInputMode] = useState<InputMode>("upload");
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedFyId, setSelectedFyId] = useState<number | null>(null);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [gl, setGl] = useState<File | null>(null);
  const [map, setMap] = useState<File | null>(null);
  const [direct, setDirect] = useState<File | null>(null);
  const [events, setEvents] = useState<File | null>(null);
  const [config, setConfig] = useState<File | null>(null);

  const [scenario, setScenario] = useState("");
  const [forecastMonths, setForecastMonths] = useState(12);
  const [runRateMonths, setRunRateMonths] = useState(3);

  useEffect(() => {
    fetch("/api/fiscal-years")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: FiscalYear[]) => {
        setFiscalYears(data);
        if (data.length > 0) setSelectedFyId(data[0].id);
      })
      .catch(() => {});
  }, []);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [narratives, setNarratives] = useState<{ scenario: string; text: string }[]>([]);
  const [chartUrls, setChartUrls] = useState<string[]>([]);

  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [excelDownloadUrl, setExcelDownloadUrl] = useState<string | null>(null);

  async function runForecast() {
    setRunning(true);
    setError(null);
    setNarratives([]);
    setChartUrls([]);

    try {
      const form = new FormData();
      if (scenario.trim()) form.set("scenario", scenario.trim());
      form.set("forecast_months", String(forecastMonths));
      form.set("run_rate_months", String(runRateMonths));

      if (inputMode === "db") {
        if (!selectedFyId) throw new Error("Select a fiscal year.");
        if (!gl || !direct) throw new Error("Upload GL_Actuals.csv and Direct_Costs_By_Project.csv.");
        form.set("fiscal_year_id", String(selectedFyId));
        form.set("gl_actuals", gl, "GL_Actuals.csv");
        form.set("direct_costs", direct, "Direct_Costs_By_Project.csv");
        if (events) form.set("scenario_events", events, "Scenario_Events.csv");
      } else if (zipFile) {
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
      if (config && inputMode !== "db") {
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

      const excelFile = zip.file("rate_pack.xlsx");

      // Collect all scenario narratives (e.g. Base/narrative.md, Win/narrative.md)
      const narrs: { scenario: string; text: string }[] = [];
      for (const name of Object.keys(zip.files)) {
        const match = name.match(/^(.+)\/narrative\.md$/);
        if (match) {
          const file = zip.file(name);
          if (file) narrs.push({ scenario: match[1], text: await file.async("string") });
        }
      }
      // Fall back to root narrative.md if no per-scenario files found
      if (narrs.length === 0) {
        const rootNarr = zip.file("narrative.md");
        if (rootNarr) narrs.push({ scenario: "", text: await rootNarr.async("string") });
      }
      setNarratives(narrs);

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

  function downloadTemplate(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const templates: Record<string, string> = {
    "GL_Actuals.csv": "Period,Account,Amount\n2025-01,6000,100000.00\n",
    "Account_Map.csv": "Account,Pool,BaseCategory,IsUnallowable,Notes\n6000,Fringe,TL,False,Benefits/Fringe\n",
    "Direct_Costs_By_Project.csv": "Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel\n2025-01,P001,250000,2200,60000,20000,10000\n",
    "Scenario_Events.csv": "Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes\nBase,2025-07,ADJUST,,0,0,0,0,0,0,0,0,No changes\n",
  };

  return (
    <main className="container">
      <h1 style={{ marginTop: 0, marginBottom: 6 }}>Indirect Rate Forecasting Agent</h1>
      <div className="muted" style={{ marginBottom: 16 }}>
        Upload inputs → run → download the pack. (The forecasting engine runs in the Python API; this UI can be hosted on
        Vercel.)
      </div>

      <div className="top-grid">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Ask the Rate Analyst</h2>
          <div className="muted" style={{ marginBottom: 10 }}>
            Chat with Gemini about indirect rates, pool structures, and cost forecasting.
          </div>
          <ChatPanel />
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>1) Upload inputs</h2>

          <div className="field">
            <label>Input mode</label>
            <div style={{ display: "flex", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="radio" name="inputMode" checked={inputMode === "upload"} onChange={() => setInputMode("upload")} />
                Upload CSVs
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="radio" name="inputMode" checked={inputMode === "db"} onChange={() => setInputMode("db")} disabled={fiscalYears.length === 0} />
                Use DB configuration
                {fiscalYears.length === 0 && <span className="muted" style={{ fontSize: 11 }}>(no fiscal years configured)</span>}
              </label>
            </div>
          </div>

          {inputMode === "db" && (
            <div className="field">
              <label>Fiscal year</label>
              <select
                value={selectedFyId ?? ""}
                onChange={(e) => setSelectedFyId(Number(e.target.value))}
                style={{ width: "100%" }}
              >
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.name} ({fy.start_month} – {fy.end_month})
                  </option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 12 }}>
                Account mappings and rate config will be loaded from the database. Set these up on the Pools page.
              </div>
            </div>
          )}

          {inputMode === "upload" && (
            <>
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
                {([
                  ["GL_Actuals.csv", setGl] as const,
                  ["Account_Map.csv", setMap] as const,
                  ["Direct_Costs_By_Project.csv", setDirect] as const,
                  ["Scenario_Events.csv", setEvents] as const,
                ]).map(([name, setter]) => (
                  <div key={name}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label className="muted" style={{ fontSize: 13, margin: 0 }}>{name}</label>
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); downloadTemplate(name, templates[name]); }}
                        style={{ fontSize: 11, opacity: 0.6 }}
                      >
                        download template
                      </a>
                    </div>
                    <input type="file" accept=".csv" onChange={(e) => setter(e.target.files?.[0] || null)} />
                  </div>
                ))}
              </div>

              <div className="field">
                <label>Optional: Upload a rates config YAML</label>
                <input type="file" accept=".yaml,.yml" onChange={(e) => setConfig(e.target.files?.[0] || null)} />
              </div>
            </>
          )}

          {inputMode === "db" && (
            <div className="field">
              <label>Upload data CSVs</label>
              {([
                ["GL_Actuals.csv", setGl] as const,
                ["Direct_Costs_By_Project.csv", setDirect] as const,
              ]).map(([name, setter]) => (
                <div key={name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label className="muted" style={{ fontSize: 13, margin: 0 }}>{name}</label>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); downloadTemplate(name, templates[name]); }}
                      style={{ fontSize: 11, opacity: 0.6 }}
                    >
                      download template
                    </a>
                  </div>
                  <input type="file" accept=".csv" onChange={(e) => setter(e.target.files?.[0] || null)} />
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label className="muted" style={{ fontSize: 13, margin: 0 }}>Scenario_Events.csv (optional)</label>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); downloadTemplate("Scenario_Events.csv", templates["Scenario_Events.csv"]); }}
                    style={{ fontSize: 11, opacity: 0.6 }}
                  >
                    download template
                  </a>
                </div>
                <input type="file" accept=".csv" onChange={(e) => setEvents(e.target.files?.[0] || null)} />
              </div>
            </div>
          )}

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

          {narratives.length > 0 ? (
            narratives.map((n) => (
              <div key={n.scenario} className="narrative">
                <ReactMarkdown>{n.text}</ReactMarkdown>
              </div>
            ))
          ) : (
            <div className="muted">Run a forecast to see the narrative here.</div>
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

    </main>
  );
}
