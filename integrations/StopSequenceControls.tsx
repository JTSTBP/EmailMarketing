// Frontend handoff example. Mount beside each POC in the actual CRM source repository.
// Uses the CRM's existing JWT and same-origin backend; no outreach service secret in browser.
import React, { useEffect, useState } from "react";
type Summary = {
  enrollmentId: string;
  pocId: string;
  status: string;
  sent: number;
  lastSentAt?: string;
  nextAt?: string;
  replyId?: string;
  stopReason?: string;
  updatedAt?: string;
};
export function StopSequenceControls({
  leadId,
  pocId,
  crmToken,
  outreachOrigin,
}: {
  leadId: string;
  pocId: string;
  crmToken: string;
  outreachOrigin: string;
}) {
  const [rows, setRows] = useState<Summary[]>([]),
    [request, setRequest] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch(
      `/api/outreach/leads/${encodeURIComponent(leadId)}/status`,
      { headers: { "x-auth-token": crmToken } },
    );
    if (!response.ok) throw new Error("Could not refresh sequence status");
    setRows(
      (await response.json()).sequences.filter(
        (r: Summary) => r.pocId === pocId,
      ),
    );
  }
  useEffect(() => {
    void refresh().catch(() => setRequest("Status unavailable"));
    const timer = setInterval(
      () => void refresh().catch(() => setRequest("Status refresh failed")),
      10000,
    );
    return () => clearInterval(timer);
  }, [leadId, pocId, crmToken]);
  async function stop(all = false) {
    setBusy(true);
    setRequest("Pending — waiting for the email application");
    try {
      const response = await fetch(
        `/api/outreach/leads/${encodeURIComponent(leadId)}/stop`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-auth-token": crmToken,
          },
          body: JSON.stringify(all ? {} : { pocId }),
        },
      );
      const result = await response.json();
      if (!response.ok || result.status !== "Stopped")
        throw new Error(result.message || "Stop was not confirmed");
      setRequest(
        "Stopped — acknowledged by the email application. CRM details may take a moment to synchronize.",
      );
      await refresh().catch(() => {});
    } catch (error) {
      setRequest(
        `Pending / failed — ${(error as Error).message}. Refresh and retry.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Email sequence controls">
      <button disabled={busy} onClick={() => void stop()}>
        Stop Email Sequence
      </button>
      <button disabled={busy} onClick={() => void stop(true)}>
        Stop All Company Sequences
      </button>
      <p role="status">{request}</p>
      <small>An email already submitted to Microsoft cannot be recalled.</small>
      {rows.map((r) => (
        <div key={r.enrollmentId}>
          <strong>{r.status}</strong> · {r.sent}/5 submitted
          <p>
            Last: {r.lastSentAt || "—"} · Next: {r.nextAt || "—"}
          </p>
          {r.replyId && <span>Reply received</span>}
          {r.stopReason && <p>Reason: {r.stopReason}</p>}
          <a
            href={`${outreachOrigin}/?enrollment=${encodeURIComponent(r.enrollmentId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Email history
          </a>
          <small>Last CRM update: {r.updatedAt || "—"}</small>
        </div>
      ))}
    </section>
  );
}
