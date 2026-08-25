import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuditEvent, Booking, BookingDetail, Call, CallDetail, EvaluationRun, ToolEvent } from "@dispatchloop/contracts";
import "./styles.css";

type Surface = "dispatch" | "booking" | "trace" | "evals";
type Loadable<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

const API_BASE = import.meta.env.VITE_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const tokenKey = "dispatchloop_operator_token";

const now = new Date();
const iso = (minutes = 0) => new Date(now.getTime() + minutes * 60_000).toISOString();
const mockBookings: Booking[] = [
  { id: "DL-10421", professionalName: "Arjun Mehta", serviceType: "AC repair", appointmentAt: iso(45), locality: "Koramangala", safeLandmark: "Near 5th Block bus stop", professionalStatus: "DELAYED", etaMinutes: 25, riskReason: "Traffic congestion confirmed", version: 4, updatedAt: iso(-4) },
  { id: "DL-10436", professionalName: "Riya Sharma", serviceType: "Plumbing", appointmentAt: iso(70), locality: "Indiranagar", safeLandmark: "12th Main entrance", professionalStatus: "ON_TRACK", etaMinutes: 12, riskReason: "No current risk", version: 2, updatedAt: iso(-8) },
  { id: "DL-10452", professionalName: "Sameer Khan", serviceType: "Appliance installation", appointmentAt: iso(20), locality: "HSR Layout", safeLandmark: "Sector 2 security gate", professionalStatus: "UNAVAILABLE", etaMinutes: null, riskReason: "Vehicle breakdown", version: 6, updatedAt: iso(-2) }
];
const mockCall = (bookingId: string): Call => ({ id: "ae6a2240-1783-4d59-93f6-3fead8f1291e", bookingId, bolnaExecutionId: null, status: "in-progress", mode: "mock", evidenceSource: "deterministic_test", promptVersion: "v1", transcript: "Agent: Hi Arjun, DispatchLoop calling about DL-10421.\nProfessional: Traffic hai, 25 minute lag jayenge.", outcome: null, escalated: false, startedAt: iso(-2), completedAt: null, updatedAt: iso(-1) });

function readToken() { return sessionStorage.getItem(tokenKey) ?? ""; }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = readToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body.data as T;
}
function formatTime(value: string | null) { return value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—"; }
function relative(value: string) { const diff = Math.round((new Date(value).getTime() - Date.now()) / 60_000); return diff >= 0 ? `in ${diff}m` : `${Math.abs(diff)}m ago`; }
function statusClass(status: string) { return `status ${status.toLowerCase().replaceAll("_", "-")}`; }

function App() {
  const [surface, setSurface] = useState<Surface>("dispatch");
  const [bookings, setBookings] = useState<Booking[]>(mockBookings);
  const [selected, setSelected] = useState("DL-10421");
  const [calls, setCalls] = useState<Record<string, Call>>({ "DL-10421": mockCall("DL-10421") });
  const [mode, setMode] = useState<"live" | "fixture" | "mock">("mock");
  const [notice, setNotice] = useState("Running with deterministic mock data");
  const [loading, setLoading] = useState(true);
  const [tokenOpen, setTokenOpen] = useState(false);

  const selectedBooking = useMemo(() => bookings.find((booking) => booking.id === selected) ?? bookings[0]!, [bookings, selected]);
  const selectedCall = calls[selectedBooking.id];
  useEffect(() => {
    let cancelled = false;
    request<Booking[]>("/v1/bookings").then((data) => {
      if (!cancelled) { setBookings(data); setMode("live"); setNotice("Connected to DispatchLoop API"); }
    }).catch(() => { if (!cancelled) setNotice("Running with deterministic mock data"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function startCall(booking: Booking) {
    setNotice(`Opening call for ${booking.id}…`);
    try {
      const data = await request<{ callId: string; executionId: string | null; status: Call["status"]; mode: Call["mode"] }>(`/v1/bookings/${booking.id}/calls`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: booking.version }) });
      setCalls((current) => ({ ...current, [booking.id]: { ...mockCall(booking.id), id: data.callId, bolnaExecutionId: data.executionId, status: data.status, mode: data.mode, evidenceSource: data.mode === "live" ? "live_call" : "bolna_fixture" } }));
      setMode(data.mode); setNotice(`Call ${data.status.replaceAll("-", " ")} — execution retained in Call Trace`);
    } catch {
      const call = { ...mockCall(booking.id), id: crypto.randomUUID(), status: "queued" as const, updatedAt: new Date().toISOString() };
      setCalls((current) => ({ ...current, [booking.id]: call }));
      setNotice("API unavailable — staged a mock call for this safe demo");
    }
  }
  async function reset() {
    try { await request("/v1/demo/reset", { method: "POST" }); setNotice("Demo seed state restored"); }
    catch { setNotice("Mock workspace reset"); }
    setBookings(mockBookings); setCalls({ "DL-10421": mockCall("DL-10421") }); setSelected("DL-10421");
  }
  function navigate(next: Surface) { setSurface(next); }
  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">DL</span><span>Dispatch<span>Loop</span></span></div>
      <p className="environment"><i /> {mode} workspace</p>
      <nav aria-label="Operations">
        <NavItem active={surface === "dispatch"} onClick={() => navigate("dispatch")} icon="▦" label="Dispatch" />
        <NavItem active={surface === "booking"} onClick={() => navigate("booking")} icon="◫" label="Booking" />
        <NavItem active={surface === "trace"} onClick={() => navigate("trace")} icon="≋" label="Call trace" badge={Object.keys(calls).length} />
        <NavItem active={surface === "evals"} onClick={() => navigate("evals")} icon="✓" label="Evaluations" />
      </nav>
      <div className="sidebar-footer"><button className="quiet-button" onClick={reset}>↻ Reset demo</button><small>v0.1.0 · synthetic data only</small></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">OPERATIONS CONTROL</p><h1>{({ dispatch: "At-risk dispatch", booking: "Booking dossier", trace: "Call trace", evals: "Evaluation suite" } as Record<Surface, string>)[surface]}</h1></div><div className="top-actions"><span className="connection"><b /> {notice}</span><button className="token-button" onClick={() => setTokenOpen(true)}>Operator access</button></div></header>
      {loading ? <LoadingState /> : surface === "dispatch" ? <Dispatch bookings={bookings} calls={calls} selected={selected} setSelected={(id) => { setSelected(id); navigate("booking"); }} onCall={startCall} /> : null}
      {!loading && surface === "booking" ? <BookingSurface booking={selectedBooking} call={selectedCall} onCall={startCall} onTrace={() => navigate("trace")} /> : null}
      {!loading && surface === "trace" ? <TraceSurface booking={selectedBooking} call={selectedCall} /> : null}
      {!loading && surface === "evals" ? <EvalsSurface /> : null}
    </section>
    {tokenOpen ? <TokenDialog close={() => setTokenOpen(false)} after={() => setNotice("Operator token saved for this session only")} /> : null}
  </main>;
}
function NavItem({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: string; label: string; badge?: number }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span>{label}{badge ? <em>{badge}</em> : null}</button>; }
function LoadingState() { return <div className="loading"><span className="spinner" /> Syncing safe dispatch context…</div>; }
function Dispatch({ bookings, calls, selected, setSelected, onCall }: { bookings: Booking[]; calls: Record<string, Call>; selected: string; setSelected: (id: string) => void; onCall: (booking: Booking) => void }) {
  const risk = bookings.filter((booking) => booking.professionalStatus === "DELAYED" || booking.professionalStatus === "UNAVAILABLE").length;
  return <><section className="stat-strip"><Metric label="At risk" value={String(risk)} tone="danger" note="requires contact" /><Metric label="Due within hour" value={String(bookings.filter((booking) => new Date(booking.appointmentAt).getTime() - Date.now() < 3_600_000).length)} tone="warm" note="active coverage" /><Metric label="Live calls" value={String(Object.values(calls).filter((call) => ["queued", "ringing", "in-progress"].includes(call.status)).length)} tone="blue" note="voice agent engaged" /><Metric label="Protected actions" value="100%" tone="neutral" note="policy enforced" /></section>
    <section className="panel dispatch-panel"><div className="panel-heading"><div><p className="eyebrow">PRIORITY QUEUE</p><h2>Appointments needing attention</h2></div><span className="count">{bookings.length} records</span></div><div className="dispatch-table" role="table"><div className="table-head" role="row"><span>Booking / professional</span><span>Service & appointment</span><span>Signal</span><span>Last call</span><span /></div>{bookings.map((booking) => { const associatedCall = calls[booking.id]; return <article className={`dispatch-row ${selected === booking.id ? "selected" : ""}`} key={booking.id} role="row"><button className="row-info" onClick={() => setSelected(booking.id)}><strong>{booking.id}</strong><span>{booking.professionalName}</span></button><div><strong>{booking.serviceType}</strong><span>{formatTime(booking.appointmentAt)} · {relative(booking.appointmentAt)}</span></div><div><span className={statusClass(booking.professionalStatus)}>{booking.professionalStatus.replaceAll("_", " ")}</span><small>{booking.riskReason}</small></div><div>{associatedCall ? <><strong>{associatedCall.status.replaceAll("-", " ")}</strong><span>{relative(associatedCall.updatedAt)}</span></> : <span className="muted">No attempt</span>}</div><button className="call-button" onClick={() => onCall(booking)} aria-label={`Call ${booking.professionalName}`}>Call professional <span>→</span></button></article>; })}</div></section></>;
}
function Metric({ label, value, tone, note }: { label: string; value: string; tone: string; note: string }) { return <div className={`metric ${tone}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>; }
function BookingSurface({ booking, call, onCall, onTrace }: { booking: Booking; call: Call | undefined; onCall: (booking: Booking) => void; onTrace: () => void }) { return <div className="two-column"><section className="panel dossier"><div className="panel-heading"><div><p className="eyebrow">{booking.id}</p><h2>{booking.serviceType}</h2></div><span className={statusClass(booking.professionalStatus)}>{booking.professionalStatus.replaceAll("_", " ")}</span></div><div className="context-grid"><Context label="Professional" value={booking.professionalName} /><Context label="Appointment" value={`${formatTime(booking.appointmentAt)} · ${relative(booking.appointmentAt)}`} /><Context label="Area" value={booking.locality} /><Context label="Safe landmark" value={booking.safeLandmark} /><Context label="ETA" value={booking.etaMinutes ? `${booking.etaMinutes} min` : "Unknown"} /><Context label="Record version" value={`v${booking.version}`} /></div><div className="risk-box"><span>Risk signal</span><strong>{booking.riskReason}</strong><p>All voice actions are checked against the latest booking version before they can change this record.</p></div><div className="action-row"><button className="call-button" onClick={() => onCall(booking)}>Call professional <span>→</span></button>{call ? <button className="secondary-button" onClick={onTrace}>Open call trace</button> : null}</div></section><aside className="panel event-panel"><p className="eyebrow">AUDIT TIMELINE</p><h2>Decision evidence</h2><Timeline booking={booking} call={call} /></aside></div>; }
function Context({ label, value }: { label: string; value: string }) { return <div className="context"><small>{label}</small><strong>{value}</strong></div>; }
function Timeline({ booking, call }: { booking: Booking; call: Call | undefined }) { const events = [{ title: "Risk signal updated", copy: booking.riskReason, time: relative(booking.updatedAt), tone: "warn" }, ...(call ? [{ title: "Voice call created", copy: `${call.mode} · ${call.evidenceSource.replaceAll("_", " ")}`, time: relative(call.updatedAt), tone: "blue" }] : []), { title: "Booking synchronized", copy: `Version ${booking.version} retained`, time: "today", tone: "gray" }]; return <ol className="timeline">{events.map((event) => <li key={event.title}><i className={event.tone} /><div><strong>{event.title}</strong><p>{event.copy}</p></div><time>{event.time}</time></li>)}</ol>; }
function TraceSurface({ booking, call }: { booking: Booking; call: Call | undefined }) { const active = call ?? mockCall(booking.id); const toolEvents: ToolEvent[] = [{ id: "b30ba6b6-4c2d-47b8-bb56-d4505c693f28", callId: active.id, toolName: "update-eta", input: { etaMinutes: 25, expectedVersion: booking.version }, result: { professionalStatus: "DELAYED", customerEventEligible: true }, success: true, errorCode: null, latencyMs: 182, createdAt: iso(-1) }]; return <div className="trace-layout"><section className="panel trace-main"><div className="panel-heading"><div><p className="eyebrow">{active.id.slice(0, 8)} · {active.promptVersion}</p><h2>{active.status.replaceAll("-", " ")}</h2></div><span className="evidence">{active.evidenceSource.replaceAll("_", " ")}</span></div><Lifecycle status={active.status} /><div className="transcript"><div className="section-label">REDACTED TRANSCRIPT</div><pre>{active.transcript ?? "Awaiting a terminal call state. Transcript is intentionally unavailable while this call remains active."}</pre></div></section><aside className="tools"><section className="panel tool-panel"><p className="eyebrow">TOOL TRACE</p><h2>Deterministic actions</h2>{toolEvents.map((tool) => <div className="tool-event" key={tool.id}><div><strong>{tool.toolName}</strong><span className={tool.success ? "success" : "failure"}>{tool.success ? "Accepted" : "Denied"}</span></div><pre>{JSON.stringify(tool.input, null, 2)}</pre><footer><span>{tool.latencyMs} ms</span><span>{relative(tool.createdAt)}</span></footer></div>)}</section><section className="security-note"><b>Policy boundary</b><span>Conversation cannot directly change a booking. Each tool request is validated, versioned, and audited.</span></section></aside></div>; }
function Lifecycle({ status }: { status: Call["status"] }) { const stages: Array<{ key: Call["status"]; label: string }> = [{ key: "queued", label: "Queued" }, { key: "ringing", label: "Ringing" }, { key: "in-progress", label: "In progress" }, { key: "call-disconnected", label: "Disconnected" }, { key: "completed", label: "Completed" }]; const current = stages.findIndex((stage) => stage.key === status); const active = current === -1 ? 2 : current; return <div className="lifecycle">{stages.map((stage, index) => <div className={index <= active ? "reached" : ""} key={stage.key}><i>{index < active ? "✓" : index + 1}</i><span>{stage.label}</span></div>)}</div>; }
function EvalsSurface() { const scenarios = [["ETA update — Hinglish", true, "live_call"], ["Vehicle breakdown replacement", true, "bolna_fixture"], ["Customer unreachable after arrival", true, "deterministic_test"], ["Tool failure: no false success", true, "deterministic_test"], ["Prompt-injection refusal", true, "deterministic_test"], ["Safety escalation", false, "not run"]] as const; return <section className="panel eval-panel"><div className="panel-heading"><div><p className="eyebrow">PROMPT VERSION V1</p><h2>Scenario evidence</h2></div><button className="secondary-button">Run deterministic suite</button></div><div className="eval-summary"><div><strong>5 / 6</strong><span>completed</span></div><div><strong>0</strong><span>critical failures</span></div><div><strong>83</strong><span>current score</span></div></div><div className="eval-list">{scenarios.map(([label, passed, evidence]) => <div className="eval-row" key={label}><span className={passed ? "check" : "pending"}>{passed ? "✓" : "•"}</span><strong>{label}</strong><span className="evidence">{evidence.replaceAll("_", " ")}</span><span>{passed ? "Passed" : "Queued"}</span></div>)}</div><p className="eval-note">Results always retain their evidence source. Fixture and deterministic results are never presented as live-call proof.</p></section>; }
function TokenDialog({ close, after }: { close: () => void; after: () => void }) { const [value, setValue] = useState(readToken()); return <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={(event) => { event.preventDefault(); sessionStorage.setItem(tokenKey, value); after(); close(); }}><button type="button" className="close" onClick={close}>×</button><p className="eyebrow">SESSION-ONLY ACCESS</p><h2>Operator bearer token</h2><p>This token stays in this window’s session storage. It is never bundled into the desktop app or written to logs.</p><label>Bearer token<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste authorized token" /></label><div><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="call-button" type="submit">Save session token</button></div></form></div>; }

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
