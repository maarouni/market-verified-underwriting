// FredMortgageRateTrial.js
// Standalone trial component — NOT yet wired into the main app.
// Tests fetching the live 30-year mortgage rate from FRED and displays it
// as a "market data" value with a manual override toggle.
//
// To test: drop this file into src/, then temporarily render
// <FredMortgageRateTrial /> from App.js (or a blank test page) and run npm start.
//
// IMPORTANT: This calls the FRED API directly from the browser. FRED's API
// does not currently require a server-side proxy for read-only GET requests
// and supports CORS, but exposing the API key in client-side code means
// anyone can read it from the network tab. That's an acceptable risk for a
// free, rate-limited, read-only data API key, but should not be treated the
// same way as a key for a paid or write-capable service.

import { useState, useEffect } from "react";

const FRED_API_KEY = "30a709ea0e7f3eb954d3b60d096f925f"; // <-- paste your real key here locally; do not commit this file with the real key

const C = {
  navy: "#0F1F3D",
  navyMid: "#1B2A4A",
  navyLt: "#243558",
  gold: "#C9A84C",
  goldLt: "#F0D98C",
  white: "#F5F7FA",
  muted: "#8A9BB5",
  green: "#2ECC8A",
  red: "#E05C5C",
  border: "rgba(201,168,76,0.25)",
};

export default function FredMortgageRateTrial() {
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [rate, setRate] = useState(null);
  const [date, setDate] = useState(null);
  const [error, setError] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [overrideValue, setOverrideValue] = useState("");

  useEffect(() => {
    const url = `https://fred-data-proxy.maarouni.workers.dev/?series_id=MORTGAGE30US`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`FRED request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const obs = data.observations && data.observations[0];
        if (!obs) throw new Error("No observation returned");
        const r = parseFloat(obs.value);
        setRate(r);
        setDate(obs.date);
        setOverrideValue(r.toFixed(3));
        setStatus("ok");
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, []);

  return (
    <div
      style={{
        background: C.navyMid,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "20px",
        maxWidth: 380,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
        30-Year Mortgage Rate
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>
        Source: FRED — series MORTGAGE30US
      </div>

      {status === "loading" && (
        <div style={{ fontSize: 13, color: C.muted }}>Fetching live data...</div>
      )}

      {status === "error" && (
        <div style={{ fontSize: 13, color: C.red }}>
          Failed to fetch: {error}
        </div>
      )}

      {status === "ok" && !overriding && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: C.white }}>
              {rate.toFixed(2)}%
            </span>
            <span
              style={{
                background: "rgba(46,204,138,0.15)",
                color: C.green,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
              }}
            >
              Market data
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>
            As of {date}
          </div>
          <button
            onClick={() => setOverriding(true)}
            style={{
              fontSize: 12,
              background: "transparent",
              border: `1px solid ${C.gold}`,
              color: C.gold,
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer",
            }}
          >
            Override with my own rate
          </button>
        </>
      )}

      {status === "ok" && overriding && (
        <div>
          <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>
            Your assumption (%)
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              step="0.125"
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              style={{
                width: 90,
                background: C.navyLt,
                border: `1px solid ${C.gold}`,
                borderRadius: 5,
                padding: "6px 10px",
                color: C.white,
                fontSize: 13,
              }}
            />
            <button
              onClick={() => setOverriding(false)}
              style={{
                fontSize: 12,
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.muted,
                borderRadius: 6,
                padding: "6px 12px",
                cursor: "pointer",
              }}
            >
              Use market rate instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
