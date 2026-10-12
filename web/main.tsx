import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  Users,
  Send,
  Layers,
  Inbox,
  Clock,
  Settings,
  BookOpen,
  Activity,
  Search,
  Plus,
  Check,
  CheckCircle2,
  ChevronRight,
  Mail,
  Pause,
  Play,
  Square,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Link,
  ExternalLink,
  X,
  AlertCircle,
  Menu,
  Globe,
  FileText,
  History,
  Building2,
  MoreHorizontal,
} from "lucide-react";
import type {
  State,
  Enrollment,
  Contact,
  Draft,
  Timing,
  Campaign,
} from "../src/types";
import "./style.css";
type View =
  | "Overview"
  | "CRM contacts"
  | "Campaigns"
  | "Draft studio"
  | "Replies"
  | "Email history"
  | "Mailboxes"
  | "Proof library"
  | "Activity & sync";
type Data = State & {
  manualSends?: import("../src/store").ManualSendRecord[];
  user: { name: string; role: string };
  mode: string;
  localMicrosoftTest?: boolean;
  liveSending: boolean;
  emergencyStop: boolean;
  threadingVerified: boolean;
};
async function api(url: string, body?: unknown, method?: string) {
  const r = await fetch(`/api${url}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-JT-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
const fmt = (d?: string) =>
  d
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(d))
    : "—";
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      {["Active", "healthy", "synced", "submitted"].includes(status) && (
        <span className="dot" />
      )}
      {status}
    </span>
  );
}
function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Mail size={26} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function App() {
  const [data, setData] = useState<Data | null>(null),
    [view, setView] = useState<View>(
      new URLSearchParams(location.search).has("enrollment")
        ? "Draft studio"
        : "Overview",
    ),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [current, setCurrent] = useState(
      new URLSearchParams(location.search).get("enrollment") || "",
    ),
    [campaign, setCampaign] = useState("demo-campaign"),
    [modal, setModal] = useState<"campaign" | "proof" | null>(null),
    [mobile, setMobile] = useState(false),
    [industry, setIndustry] = useState("All industries"),
    [login, setLogin] = useState(false);
  const refresh = async () => {
    try {
      setData(await api("/state"));
      setLogin(false);
    } catch (e) {
      if ((e as Error).message.includes("Sign in")) setLogin(true);
      else setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 12000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const run = async (fn: () => Promise<any>, success = "Changes saved") => {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      await refresh();
      setNotice(success);
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nav = (v: View) => {
    setView(v);
    setSearch("");
    setMobile(false);
  };
  const open = (e: Enrollment) => {
    setCurrent(e.id);
    nav("Draft studio");
  };
  const act = (e: Enrollment, action: string) =>
    run(
      () => api(`/enrollments/${e.id}/action`, { action }),
      action === "stop"
        ? "Sequence stopped. Already submitted emails cannot be recalled."
        : "Sequence updated",
    );
  if (login)
    return (
      <main className="login">
        <div className="brand">
          <span className="brand-icon">
            jt<span>↗</span>
          </span>
          <b>Jobs Territory</b>
        </div>
        <h1>Welcome to Outreach.</h1>
        <p>Sign in with your existing CRM account.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                api("/login", {
                  email: f.get("email"),
                  password: f.get("password"),
                  loginType: f.get("loginType"),
                }),
              "Signed in",
            );
          }}
        >
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
          <label>
            Account type
            <select name="loginType">
              <option value="agent">Executive / Manager</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            Sign in <ArrowRight size={16} />
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );
  if (!data)
    return (
      <div className="loading">
        <span className="brand-icon">jt↗</span>
        <h2>Opening your outreach workspace…</h2>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const enrollments = data.enrollments;
  const active = enrollments.filter((e) => e.status === "Active").length;
  const submissions = data.jobs.filter((j) => j.state === "submitted");
  const replies = data.incoming.filter((i) =>
    ["reply", "automatic"].includes(i.kind),
  );
  const currentEnrollment =
    enrollments.find((e) => e.id === current) || enrollments[0];
  const filteredContacts = data.contacts.filter(
    (c) =>
      (industry === "All industries" || industry === c.industry) &&
      `${c.name} ${c.company} ${c.email} ${c.assignedExecutive}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const chooseEnroll = () =>
    run(async () => {
      const rows = await api("/enroll", {
        campaignId: campaign,
        contacts: data.contacts
          .filter((c) => selected.includes(c.id))
          .map((c) => ({ leadId: c.leadId, pocId: c.pocId })),
      });
      setSelected([]);
      setCurrent(rows[0].id);
      nav("Draft studio");
    }, "Contacts added as drafts. Nothing has been sent.");
  const groups = [
    {
      label: "WORKSPACE",
      items: [
        ["Overview", LayoutDashboard],
        ["CRM contacts", Users],
        ["Campaigns", Layers],
        ["Draft studio", Sparkles],
      ],
    },
    {
      label: "CONVERSATIONS",
      items: [
        ["Replies", Inbox],
        ["Email history", Clock],
      ],
    },
    {
      label: "MANAGE",
      items: [
        ["Mailboxes", Mail],
        ["Proof library", BookOpen],
        ["Activity & sync", Activity],
      ],
    },
  ];
  return (
    <div className="app">
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a className="brand" onClick={() => nav("Overview")}>
          <span className="brand-icon">
            jt<span>↗</span>
          </span>
          <span>
            Jobs Territory<small>OUTREACH WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">JT</span>
          <div>
            Jobs Territory<small>Recruitment partnerships</small>
          </div>
          <span className="chevrons">⌄</span>
        </div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map(([label, Icon]: any) => (
                <button
                  key={label}
                  className={view === label ? "nav-item selected" : "nav-item"}
                  onClick={() => nav(label)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {label === "Draft studio" &&
                    enrollments.filter(
                      (e) => e.status === "Draft" || e.status === "Ready",
                    ).length > 0 && (
                      <small className="nav-count">
                        {
                          enrollments.filter(
                            (e) => e.status === "Draft" || e.status === "Ready",
                          ).length
                        }
                      </small>
                    )}
                  {label === "Replies" && replies.length > 0 && (
                    <small className="nav-count">{replies.length}</small>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="safety">
            <ShieldCheck size={18} />
            <div>
              You're in control<small>Every sequence starts with review.</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">{initials(data.user.name)}</span>
            <div>
              {data.user.name}
              <small>{data.user.role}</small>
            </div>
            {data.mode === "live" ? (
              <button
                title="Sign out"
                className="icon-button"
                onClick={() => void run(() => api("/logout", {}))}
              >
                <ArrowRight size={17} />
              </button>
            ) : (
              <span className="demo-tag">DEMO</span>
            )}
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-button"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{view}</b>
          </div>
          <div className="top-right">
            <span className="connection">
              <span className="dot" />
              {data.mode === "mock" ? "Mock CRM connected" : "CRM connected"}
            </span>
            <span className="top-divider" />
            <span className="timezone">Asia / Kolkata</span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <div className={`environment ${data.emergencyStop ? "emergency" : ""}`}>
          <span>
            <ShieldCheck size={15} />
            {data.emergencyStop ? (
              <>
                <b>Emergency stop is active.</b> All active sequences were
                paused. Resume individually after review.
              </>
            ) : data.mode === "mock" ? (
              <>
                <b>Local demo</b>
                <span className="env-separator">·</span>Fictional contacts. Mock
                emails only. No real messages are sent.
              </>
            ) : (
              <>
                <b>
                  {data.liveSending
                    ? "Live sending enabled"
                    : "Production sending disabled"}
                </b>
                <span className="env-separator">·</span>Start each sequence
                explicitly after review.
              </>
            )}
          </span>
          {data.user.role === "Admin" && (
            <button
              onClick={() =>
                void run(
                  () => api("/emergency", { enabled: !data.emergencyStop }),
                  data.emergencyStop
                    ? "Emergency stop cleared. Sequences remain paused."
                    : "Emergency stop activated",
                )
              }
            >
              {data.emergencyStop ? "Clear emergency stop" : "Emergency stop"}{" "}
              <Square size={11} />
            </button>
          )}
        </div>
        <main className="content">
          <div className="page-heading">
            <div className="eyebrow">
              {view === "Overview"
                ? "THOUGHTFUL OUTREACH. REAL CONVERSATIONS."
                : view === "Draft studio"
                  ? "PERSONALIZE, REVIEW, THEN SEND."
                  : "JOBS TERRITORY / OUTREACH"}
            </div>
            <div className="heading-row">
              <div>
                <h1>
                  {view === "Overview"
                    ? "Make the next connection."
                    : view === "CRM contacts"
                      ? "Your next conversation starts here."
                      : view === "Draft studio"
                        ? "A personal touch, at every step."
                        : view === "Proof library"
                          ? "Credibility you can stand behind."
                          : view}
                </h1>
                <p>
                  {
                    {
                      Overview:
                        "A clear view of your outreach, from the first hello to the next opportunity.",
                      "CRM contacts":
                        "Choose the people you want to reach. Your CRM stays the source of truth.",
                      Campaigns: "Thoughtful sequences, on your schedule.",
                      "Draft studio":
                        "Five emails. One coherent conversation. You approve every word.",
                      Replies:
                        "Every matched response automatically stops the remaining sequence.",
                      "Email history":
                        "An honest record of provider submissions and outcomes.",
                      Mailboxes: "Keep sending and reply monitoring healthy.",
                      "Proof library":
                        "Only approved testimonials and case studies belong in your outreach.",
                      "Activity & sync":
                        "A traceable record of actions, errors and CRM updates.",
                    }[view]
                  }
                </p>
              </div>
              {["Overview", "Campaigns"].includes(view) && (
                <button
                  className="primary"
                  onClick={() => setModal("campaign")}
                >
                  <Plus size={17} /> New campaign
                </button>
              )}
              {view === "CRM contacts" && (
                <button
                  className="primary"
                  disabled={!selected.length || busy}
                  onClick={() => void chooseEnroll()}
                >
                  Add {selected.length || ""} to campaign{" "}
                  <ArrowRight size={17} />
                </button>
              )}
              {view === "Proof library" && data.user.role === "Admin" && (
                <button className="primary" onClick={() => setModal("proof")}>
                  <Plus size={17} /> Add approved proof
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          {view === "Overview" && (
            <>
              <div className="stats">
                {[
                  [Users, "Active contacts", active, "In an active sequence"],
                  [
                    Send,
                    "Emails submitted",
                    submissions.length,
                    "Accepted by the provider",
                  ],
                  [
                    Inbox,
                    "Replies received",
                    replies.length,
                    "Includes automatic responses",
                  ],
                  [
                    CheckCircle2,
                    "Completed sequences",
                    enrollments.filter((e) => e.status === "Completed").length,
                    "All five emails submitted",
                  ],
                ].map(([Icon, label, value, sub]: any) => (
                  <div className="stat" key={label}>
                    <div className="stat-top">
                      <span>{label}</span>
                      <Icon size={18} />
                    </div>
                    <strong>
                      {value}
                      <span className="stat-line" />
                    </strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel queue-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Your outreach queue{" "}
                        <span className="count">{enrollments.length}</span>
                      </h2>
                      <p>The right message, at the right moment.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => nav("Draft studio")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>CONTACT</th>
                          <th>PROGRESS</th>
                          <th>STATUS</th>
                          <th>NEXT SEND</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {enrollments.slice(0, 6).map((e) => (
                          <tr key={e.id}>
                            <td>
                              <button
                                className="person-link"
                                onClick={() => open(e)}
                              >
                                <span className="avatar pale">
                                  {initials(e.contact.name)}
                                </span>
                                <span>
                                  {e.contact.name}
                                  <small>{e.contact.company}</small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <span className="mini-progress">
                                {[0, 1, 2, 3, 4].map((i) => (
                                  <i
                                    key={i}
                                    className={i < e.sent ? "done" : ""}
                                  />
                                ))}
                              </span>
                              <small>{e.sent} of 5 emails</small>
                            </td>
                            <td>
                              <Badge status={e.status} />
                            </td>
                            <td className="muted">
                              {e.blockedReason
                                ? "On hold"
                                : e.nextAt
                                  ? fmt(e.nextAt)
                                  : "Awaiting review"}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Review ${e.contact.name}`}
                                onClick={() => open(e)}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!enrollments.length && (
                    <Empty
                      title="Good outreach starts with the right people."
                      body="Choose a few CRM contacts, research their context and build a personal five-email sequence."
                      action={
                        <button
                          className="primary"
                          onClick={() => nav("CRM contacts")}
                        >
                          Choose contacts <ArrowRight size={16} />
                        </button>
                      }
                    />
                  )}
                  <div className="panel-footer">
                    <ShieldCheck size={15} />
                    <span>New contacts are never enrolled automatically.</span>
                  </div>
                </section>
                <section className="journey-card">
                  <div className="journey-label">
                    <Sparkles size={15} /> THE FIVE-EMAIL APPROACH
                  </div>
                  <h2>
                    A conversation.
                    <br />
                    Not just a campaign.
                  </h2>
                  <p>Make every follow-up earn its place in their inbox.</p>
                  <div className="journey">
                    {[
                      "A personal introduction",
                      "Relevant hiring support",
                      "A reason to trust",
                      "A wider perspective",
                      "A thoughtful close",
                    ].map((x, i) => (
                      <div key={x}>
                        <span className={i === 0 ? "first" : ""}>
                          {i === 0 ? <Mail size={15} /> : i + 1}
                        </span>
                        <b>{x}</b>
                        <small>DAY {[0, 3, 7, 12, 18][i]}</small>
                      </div>
                    ))}
                  </div>
                  <div className="journey-footer">
                    <CheckCircle2 size={15} /> Any matched reply ends the
                    sequence.
                  </div>
                </section>
              </div>
              <div className="lower-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Campaigns at a glance</h2>
                      <p>Focused on relationships, built for consistency.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => nav("Campaigns")}
                    >
                      Manage <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {data.campaigns.map((c) => (
                    <div className="campaign-summary" key={c.id}>
                      <div className="campaign-icon">
                        <Layers size={20} />
                      </div>
                      <div>
                        <b>{c.name}</b>
                        <small>
                          {
                            enrollments.filter((e) => e.sequenceId === c.id)
                              .length
                          }{" "}
                          contacts · {c.timing.days.join(" / ")} day sequence
                        </small>
                      </div>
                      <Badge status={c.status} />
                    </div>
                  ))}
                </section>
                <section className="panel health-panel">
                  <div className="panel-heading">
                    <h2>Workspace health</h2>
                    <ShieldCheck size={19} />
                  </div>
                  <div className="health-row">
                    <span>Reply monitoring</span>
                    <Badge
                      status={
                        data.mailboxes.every((m) => m.health === "healthy")
                          ? "healthy"
                          : "unhealthy"
                      }
                    />
                  </div>
                  <div className="health-row">
                    <span>Pending CRM updates</span>
                    <b>
                      {data.events.filter((e) => e.state !== "synced").length}
                    </b>
                  </div>
                  <div className="health-row">
                    <span>Stopped / bounced / failed</span>
                    <b>
                      {enrollments.filter((e) => e.status === "Stopped").length}{" "}
                      /{" "}
                      {data.incoming.filter((x) => x.kind === "bounce").length}{" "}
                      /{" "}
                      {enrollments.filter((e) => e.status === "Failed").length}
                    </b>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => nav("Mailboxes")}
                  >
                    Mailbox settings <ArrowRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "CRM contacts" && (
            <section className="panel">
              <div className="toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search CRM contacts"
                    placeholder="Search people, companies or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                >
                  <option>All industries</option>
                  {Array.from(
                    new Set(data.contacts.map((c) => c.industry)),
                  ).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  aria-label="Target campaign"
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                >
                  <option value="" disabled>
                    Choose campaign
                  </option>
                  {data.campaigns
                    .filter((c) => c.status !== "Stopped")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select displayed contacts"
                          checked={
                            filteredContacts.length > 0 &&
                            filteredContacts.every((c) =>
                              selected.includes(c.id),
                            )
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? filteredContacts.map((c) => c.id)
                                : [],
                            )
                          }
                        />
                      </th>
                      <th>CONTACT / COMPANY</th>
                      <th>ROLE & INDUSTRY</th>
                      <th>OWNER</th>
                      <th>SEQUENCE</th>
                      <th>CONTROLS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((c) => {
                      const es = enrollments.filter(
                        (e) => e.leadId === c.leadId && e.pocId === c.pocId,
                      );
                      const latest = es.at(-1);
                      return (
                        <tr key={c.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${c.name}`}
                              checked={selected.includes(c.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, c.id]
                                    : selected.filter((id) => id !== c.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <div className="person-link">
                              <span className="avatar pale">
                                {initials(c.name)}
                              </span>
                              <span>
                                <b>{c.name}</b>
                                <small>{c.company}</small>
                                <small>{c.email}</small>
                              </span>
                            </div>
                          </td>
                          <td>
                            {c.designation}
                            <small>{c.industry}</small>
                          </td>
                          <td>{c.assignedExecutive || "Unassigned"}</td>
                          <td>
                            {latest ? (
                              <>
                                <Badge status={latest.status} />
                                <small>
                                  {latest.sent}/5 · Last:{" "}
                                  {fmt(latest.lastSentAt)}
                                </small>
                                <small>Next: {fmt(latest.nextAt)}</small>
                                {latest.replyId && (
                                  <small>Reply received</small>
                                )}
                                {latest.stopReason && (
                                  <small>
                                    {latest.stopReason.replaceAll("_", " ")}
                                  </small>
                                )}
                              </>
                            ) : (
                              <span className="muted">Not enrolled</span>
                            )}
                          </td>
                          <td>
                            <div className="table-actions">
                              {latest && (
                                <>
                                  <button
                                    className="text-button"
                                    onClick={() => open(latest)}
                                  >
                                    Email history <ArrowUpRight size={13} />
                                  </button>
                                  <button
                                    className="text-button danger"
                                    disabled={busy}
                                    onClick={() => void act(latest, "stop")}
                                  >
                                    Stop Email Sequence
                                  </button>
                                </>
                              )}
                              <button
                                className="text-button muted"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () => api(`/company/${c.leadId}/stop`, {}),
                                    "All company sequences stopped",
                                  )
                                }
                              >
                                Stop All Company Sequences
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!filteredContacts.length && (
                <Empty
                  title="No contacts found"
                  body="Try a different name or industry filter."
                />
              )}
              <div className="panel-footer">
                <ShieldCheck size={15} /> Stops take effect before dispatch.
                Emails already submitted cannot be recalled.
              </div>
            </section>
          )}
          {view === "Campaigns" && (
            <div className="campaign-grid">
              {data.campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  data={data}
                  busy={busy}
                  run={run}
                  onSelect={() => {
                    setCampaign(c.id);
                    nav("CRM contacts");
                  }}
                />
              ))}
            </div>
          )}
          {view === "Draft studio" &&
            (!currentEnrollment ? (
              <section className="panel">
                <Empty
                  title="Your draft studio is ready."
                  body="Select CRM contacts to create recipient-specific sequences. Generation and review never send an email."
                  action={
                    <button
                      className="primary"
                      onClick={() => nav("CRM contacts")}
                    >
                      Choose contacts <ArrowRight size={16} />
                    </button>
                  }
                />
              </section>
            ) : (
              <>
                <div className="studio-toolbar">
                  <select
                    aria-label="Select recipient"
                    value={currentEnrollment.id}
                    onChange={(e) => setCurrent(e.target.value)}
                  >
                    {enrollments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.contact.name} · {e.contact.company}
                      </option>
                    ))}
                  </select>
                  <Badge status={currentEnrollment.status} />
                  <span className="muted">
                    {currentEnrollment.sent} of 5 submitted
                  </span>
                  <div className="spacer" />
                  {currentEnrollment.status === "Active" ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void act(currentEnrollment, "pause")}
                    >
                      <Pause size={15} /> Pause
                    </button>
                  ) : ["Paused", "Stopped", "Replied", "Failed"].includes(currentEnrollment.status) ? (
                    <button
                      className="primary"
                      disabled={busy || currentEnrollment.sent >= 5}
                      onClick={() => void act(currentEnrollment, currentEnrollment.status === "Paused" ? "start" : "restart")}
                    >
                      <Play size={15} /> Resume
                    </button>
                  ) : currentEnrollment.status !== "Completed" ? (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        currentEnrollment.status !== "Ready"
                      }
                      onClick={() => void act(currentEnrollment, "start")}
                    >
                      <Play size={15} />{" "}
                      Start sequence
                    </button>
                  ) : null}
                  {["Active", "Draft", "Ready"].includes(currentEnrollment.status) && (
                  <button
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => void act(currentEnrollment, "stop")}
                  >
                    <Square size={14} /> Stop
                  </button>
                  )}
                </div>
                {currentEnrollment.blockedReason && (
                  <div className="warning">
                    <AlertCircle size={17} />
                    {currentEnrollment.blockedReason}
                  </div>
                )}
                {currentEnrollment.stopReason && (
                  <div className="warning">
                    <AlertCircle size={17} />
                    Stopped: {currentEnrollment.stopReason.replaceAll("_", " ")}
                    .{" "}
                    <span>Use Resume to explicitly restart the remaining steps after review.</span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void act(currentEnrollment, "reviewRecipient")
                      }
                    >
                      Review current CRM address
                    </button>
                  </div>
                )}
                <div className="studio-grid">
                  <div>
                    <div className="panel recipient">
                      <span className="avatar large">
                        {initials(currentEnrollment.contact.name)}
                      </span>
                      <div>
                        <h2>{currentEnrollment.contact.name}</h2>
                        <p>
                          {currentEnrollment.contact.designation} ·{" "}
                          {currentEnrollment.contact.company}
                        </p>
                        <small>{currentEnrollment.contact.email}</small>
                      </div>
                      <div className="spacer" />
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          !["Draft", "Ready", "Paused"].includes(
                            currentEnrollment.status,
                          )
                        }
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                `/enrollments/${currentEnrollment.id}/generate`,
                                {},
                              ),
                            "Five drafts generated. Review before starting.",
                          )
                        }
                      >
                        <Sparkles size={16} />
                        {currentEnrollment.drafts.length
                          ? "Regenerate all"
                          : "Generate five emails"}
                      </button>
                    </div>
                    {currentEnrollment.drafts.length > 0 ? (
                      <>
                        <div className="section-caption">
                          <span>YOUR FIVE-EMAIL SEQUENCE</span>
                          <button
                            className="text-button"
                            disabled={
                              busy ||
                              !["Draft", "Ready", "Paused"].includes(
                                currentEnrollment.status,
                              )
                            }
                            onClick={() =>
                              void act(currentEnrollment, "approve")
                            }
                          >
                            <Check size={15} /> Mark all reviewed
                          </button>
                        </div>
                        {currentEnrollment.drafts.map((d) => (
                          <DraftCard
                            key={`${currentEnrollment.id}-${d.step}-${d.version}`}
                            draft={d}
                            enrollment={currentEnrollment}
                            busy={busy}
                            run={run}
                          />
                        ))}
                      </>
                    ) : (
                      <div className="panel">
                        <Empty
                          title="Start with context. Then find the words."
                          body="Add verified research on the right, or generate a general partnership sequence using CRM context. No hiring claims will be assumed."
                        />
                      </div>
                    )}
                    <div className="footnote">
                      <ShieldCheck size={15} /> Generation and approval never
                      send. Use Start sequence after review.
                    </div>
                  </div>
                  <aside className="research-column">
                    <ResearchPanel
                      enrollment={currentEnrollment}
                      busy={busy}
                      run={run}
                    />
                    <section className="panel compact">
                      <h3>Sending plan</h3>
                      <div className="detail-row">
                        <span>Timezone</span>
                        <b>{currentEnrollment.timing.timezone}</b>
                      </div>
                      <div className="detail-row">
                        <span>Hours</span>
                        <b>
                          {currentEnrollment.timing.startHour}:00–
                          {currentEnrollment.timing.endHour}:00
                        </b>
                      </div>
                      <div className="detail-row">
                        <span>Weekends</span>
                        <b>
                          {currentEnrollment.timing.skipWeekends
                            ? "Excluded"
                            : "Included"}
                        </b>
                      </div>
                      <div className="detail-row vertical">
                        <span>Actual next send</span>
                        <b>{fmt(currentEnrollment.nextAt)}</b>
                      </div>
                      <p className="footnote">
                        Each contact keeps the timing and drafts approved for
                        their sequence.
                      </p>
                    </section>
                    <section className="panel compact">
                      <h3>Generation usage</h3>
                      {data.usage.filter(u=>u.enrollmentId===currentEnrollment.id).slice(-3).map(u=><div className="detail-row vertical" key={u.id}><b>{u.model}</b><span>{u.inputTokens??'Unavailable'} input / {u.outputTokens??'Unavailable'} output tokens</span><small>{u.estimatedCost===null?'Estimated cost unavailable':`Estimated $${u.estimatedCost.toFixed(6)} USD`}</small></div>)}
                      {!data.usage.some(u=>u.enrollmentId===currentEnrollment.id)&&<p>No requests yet.</p>}
                    </section>
                    {data.mode === "mock" && (
                      <section className="panel compact demo-tools">
                        <h3>Try the local workflow</h3>
                        <p>
                          Advance to the next scheduled step with the mock
                          provider.
                        </p>
                        <button
                          className="secondary"
                          disabled={
                            busy || currentEnrollment.status !== "Active"
                          }
                          onClick={() =>
                            void run(
                              () =>
                                api("/mock/run", {
                                  enrollmentId: currentEnrollment.id,
                                }),
                              "Mock worker ran at the next scheduled send time",
                            )
                          }
                        >
                          <Play size={14} /> Run next mock step
                        </button>
                        <label>
                          Simulate an incoming response
                          <select id="mock-reply-kind">
                            <option value="reply">Reply</option>
                            <option value="automatic">Out of office</option>
                            <option value="bounce">Bounce</option>
                            <option value="unsubscribe">Unsubscribe</option>
                            <option value="unrelated">Unrelated email</option>
                          </select>
                        </label>
                        <button
                          className="secondary"
                          disabled={busy || !currentEnrollment.sent}
                          onClick={() =>
                            void run(
                              () =>
                                api("/mock/incoming", {
                                  enrollmentId: currentEnrollment.id,
                                  kind: (
                                    document.getElementById(
                                      "mock-reply-kind",
                                    ) as HTMLSelectElement
                                  ).value,
                                }),
                              "Mock incoming message processed",
                            )
                          }
                        >
                          Simulate response
                        </button>
                      </section>
                    )}
                  </aside>
                </div>
              </>
            ))}
          {view === "Replies" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Conversations, with context</h2>
                  <p>
                    Matching uses conversation and message identifiers.
                    Automatic replies also stop follow-ups.
                  </p>
                </div>
                <span className="count">{data.incoming.length}</span>
                {data.localMicrosoftTest && <button className="button" disabled={busy} onClick={() => void run(async () => { await api("/local-test/sync-replies", {}); })}>Check test replies</button>}
              </div>
              {data.incoming.length ? (
                data.incoming.map((m) => (
                  <article className="reply-card" key={m.id}>
                    <div className="reply-heading">
                      <span className="avatar pale">
                        {m.from.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <b>{m.from}</b>
                        <small>{fmt(m.receivedAt)}</small>
                      </div>
                      <Badge status={m.kind} />
                    </div>
                    <h3>{m.subject}</h3>
                    <p className="email-body">{m.body}</p>
                    <div className="reply-actions">
                      <span className="muted">
                        {m.manualTestId && !m.enrollmentId ? "Reply to a manual test email." : "Matched sequence stopped automatically"}
                      </span>
                      {m.enrollmentId && (
                        <>
                          <button
                            className="text-button"
                            onClick={() =>
                              open(
                                enrollments.find(
                                  (e) => e.id === m.enrollmentId,
                                )!,
                              )
                            }
                          >
                            View sequence <ArrowRight size={15} />
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() =>
                              void act(
                                enrollments.find(
                                  (e) => e.id === m.enrollmentId,
                                )!,
                                "unsubscribe",
                              )
                            }
                          >
                            Mark unsubscribe & suppress
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  title="Space for your next conversation."
                  body="Replies will appear here after they match a submitted sequence message."
                />
              )}
            </section>
          )}
          {view === "Email history" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Submission history</h2>
                  <p>
                    Provider acceptance is recorded separately from delivery. No
                    open tracking is used.
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>RECIPIENT</th>
                      <th>STEP</th>
                      <th>OUTCOME</th>
                      <th>SUBMITTED / DUE</th>
                      <th>PROVIDER REFERENCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.manualSends || []).map((m) => (
                      <tr key={`manual-${m.id}`}>
                        <td>{m.recipient}<small>{data.mailboxes.find(b => b.id === m.mailboxId)?.email}</small></td>
                        <td>Manual test<details className="sent-content"><summary>View email content</summary><b>{m.subject}</b><p className="email-body">{m.body}</p></details></td>
                        <td>{m.state === "accepted" ? "Accepted by Microsoft" : m.state === "needs_review" ? "Needs review — submission uncertain" : m.state}</td>
                        <td>{fmt(m.acceptedAt || m.createdAt)}</td>
                        <td><small className="mono">{m.providerId || "Not submitted"}</small></td>
                      </tr>
                    ))}
                    {data.jobs.map((j) => (
                      <tr key={j.id}>
                        <td>
                          {
                            enrollments.find((e) => e.id === j.enrollmentId)
                              ?.contact.name
                          }
                        </td>
                        <td>Email {j.step + 1}{j.content&&<details className="sent-content"><summary>View submitted content</summary><b>{j.content.subject}</b><p className="email-body">{j.content.body}</p></details>}</td>
                        <td>
                          <Badge status={j.state} />
                          {j.error && (
                            <small className="danger">{j.error}</small>
                          )}
                        </td>
                        <td>{fmt(j.submittedAt || j.dueAt)}</td>
                        <td>
                          <small className="mono">
                            {j.providerId || "Not submitted"}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.jobs.length && !data.manualSends?.length && (
                <Empty
                  title="No submissions yet"
                  body="After a reviewed sequence is started, its durable send jobs appear here."
                />
              )}
            </section>
          )}
          {view === "Mailboxes" && (
            <>
              <div className="mailbox-grid">
                {data.mailboxes.map((m) => (
                  <section className="panel compact" key={m.id}>
                    <div className="mailbox-top">
                      <div className="microsoft-logo">
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <Badge status={m.health} />
                    </div>
                    <h2>{m.name}</h2>
                    <p>{m.email}</p>
                    <span className="subtle-label">
                      {m.provider === "mock"
                        ? "MOCK PROVIDER"
                        : "MICROSOFT 365 · GRAPH OAUTH"}
                    </span>
                    <div className="detail-row">
                      <span>Last inbox reconciliation</span>
                      <b>{fmt(m.lastSyncAt)}</b>
                    </div>
                    <div className="detail-row">
                      <span>Threading</span>
                      <b>
                        {m.provider === "mock"
                          ? "Mock only"
                          : data.threadingVerified
                            ? "Tenant verified"
                            : "Live test required"}
                      </b>
                    </div>
                    {m.error && <div className="warning">{m.error}</div>}
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(() =>
                          api(
                            `/mailboxes/${m.id}`,
                            { dailyLimit: Number(f.get("limit")) },
                            "PATCH",
                          ),
                        );
                      }}
                    >
                      <label>
                        Daily submission limit
                        <input
                          type="number"
                          name="limit"
                          min="1"
                          max="500"
                          defaultValue={m.dailyLimit}
                        />
                      </label>
                      <button className="secondary" disabled={busy}>
                        Save limit
                      </button>
                    </form>
                    <p className="footnote">
                      Calendar day: Asia/Kolkata. Microsoft’s own limits also
                      apply. Uncertain submissions reserve a slot.
                    </p>
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                `/mailboxes/${m.id}`,
                                { sync: true },
                                "PATCH",
                              ),
                            "Reconciliation requested",
                          )
                        }
                      >
                        <RefreshCw size={14} /> Reconcile inbox
                      </button>
                      {data.mode === "mock" && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api(
                                `/mailboxes/${m.id}`,
                                {
                                  health:
                                    m.health === "healthy"
                                      ? "unhealthy"
                                      : "healthy",
                                },
                                "PATCH",
                              ),
                            )
                          }
                        >
                          {m.health === "healthy"
                            ? "Simulate sync failure"
                            : "Restore mock inbox"}
                        </button>
                      )}
                    </div>
                  </section>
                ))}
                <button
                  className="connect-card"
                  disabled={busy || (data.mode === "mock" && !data.localMicrosoftTest)}
                  onClick={() =>
                    void run(async () => {
                      if (data.localMicrosoftTest && window.location.hostname !== "localhost") {
                        window.location.assign(`http://localhost:5173${window.location.pathname}${window.location.search}${window.location.hash}`);
                        return;
                      }
                      const r = await api("/mailboxes/connect", {});
                      window.location.assign(r.url);
                    })
                  }
                >
                  <Plus size={30} />
                  <h3>Connect Microsoft 365</h3>
                  <p>
                    {data.localMicrosoftTest ? "Test Microsoft sign-in locally. Real sending and inbox monitoring are disabled." : data.mode === "mock"
                      ? "Available after configuring live mode and your Microsoft tenant."
                      : "Securely connect a mailbox with Microsoft OAuth."}
                  </p>
                </button>
              </div>
              <section className="panel compact usage">
                <h2>AI usage & estimated cost</h2>
                <p>
                  API usage is independent of a ChatGPT subscription. Costs
                  appear only when provider usage and configured model pricing
                  are available.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PROVIDER / MODEL</th>
                        <th>INPUT TOKENS</th>
                        <th>OUTPUT TOKENS</th>
                        <th>ESTIMATED USD</th>
                        <th>RESULT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.usage.map((u) => (
                        <tr key={u.id}>
                          <td>
                            {u.provider}
                            <small>{u.model}</small>
                          </td>
                          <td>{u.inputTokens ?? "Unavailable"}</td>
                          <td>{u.outputTokens ?? "Unavailable"}</td>
                          <td>
                            {u.estimatedCost === null
                              ? "Unavailable"
                              : `$${u.estimatedCost.toFixed(6)}`}
                          </td>
                          <td>
                            <Badge
                              status={u.valid ? "Validated" : "Rejected"}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.usage.length && (
                  <p className="muted">No generation requests recorded.</p>
                )}
              </section>
            </>
          )}
          {view === "Proof library" && (
            <>
              {!data.cases.length ? (
                <section className="panel">
                  <Empty
                    title="Start with proof you have permission to share."
                    body="Add a real client, the roles supported and approved results. Until then, drafts use general recruitment support without invented achievements."
                  />
                </section>
              ) : (
                <div className="campaign-grid">
                  {data.cases.map((c) => (
                    <section className="panel compact" key={c.id}>
                      <div className="panel-title">
                        <BookOpen size={19} />
                        <Badge
                          status={c.permission ? "Approved" : "Restricted"}
                        />
                      </div>
                      <h2>{c.client}</h2>
                      <p>
                        {c.industry} · {c.roles}
                      </p>
                      <blockquote>{c.result}</blockquote>
                      {data.user.role === "Admin" && (
                        <button
                          className="secondary"
                          onClick={() =>
                            void run(() =>
                              api("/cases", {
                                ...c,
                                permission: !c.permission,
                              }),
                            )
                          }
                        >
                          {c.permission ? "Revoke permission" : "Approve use"}
                        </button>
                      )}
                    </section>
                  ))}
                </div>
              )}
              <div className="footnote">
                <ShieldCheck size={16} /> Changes to the proof library do not
                silently rewrite approved sequence drafts.
              </div>
            </>
          )}
          {view === "Activity & sync" && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>CRM synchronization</h2>
                    <p>
                      Failed and pending updates stay visible until the CRM
                      acknowledges them.
                    </p>
                  </div>
                  {data.user.role === "Admin" && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api("/sync/retry", {}),
                          "CRM reconciliation queued",
                        )
                      }
                    >
                      <RefreshCw size={15} /> Reconcile & retry
                    </button>
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>EVENT</th>
                        <th>CONTACT</th>
                        <th>STATE</th>
                        <th>ATTEMPTS</th>
                        <th>RECORDED</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events
                        .slice(-30)
                        .reverse()
                        .map((e) => (
                          <tr key={e.id}>
                            <td>{e.type}</td>
                            <td>
                              {
                                enrollments.find((x) => x.id === e.enrollmentId)
                                  ?.contact.name
                              }
                            </td>
                            <td>
                              <Badge status={e.state} />
                              {e.error && <small>{e.error}</small>}
                            </td>
                            <td>{e.attempts}</td>
                            <td>{fmt(e.at)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!data.events.length && (
                  <p className="compact muted">
                    No synchronization events yet.
                  </p>
                )}
              </section>
              <section className="panel audit">
                <div className="panel-heading">
                  <h2>Audit trail</h2>
                  <span className="count">{data.audits.length}</span>
                </div>
                {data.audits.map((a) => (
                  <div className="audit-row" key={a.id}>
                    <span className="audit-dot" />
                    <b>{a.action.replaceAll(".", " · ")}</b>
                    <span>
                      {a.detail?.replaceAll("_", " ") || "Recorded action"}
                    </span>
                    <small>{fmt(a.at)}</small>
                  </div>
                ))}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>Jobs Territory Outreach</span>
            <span>Good conversations start with consideration.</span>
            <span>Local workspace · v0.1</span>
          </footer>
        </main>
      </div>
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "campaign" ? "New campaign" : "Add approved proof"
            }
            className="modal"
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">
              {modal === "campaign"
                ? "A NEW CONVERSATION"
                : "APPROVED EVIDENCE"}
            </div>
            <h2>
              {modal === "campaign"
                ? "Create a campaign"
                : "Add to your proof library"}
            </h2>
            <p>
              {modal === "campaign"
                ? "Set the rhythm. Choose contacts when you are ready."
                : "Use exact, approved wording. Permission is required for AI use."}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  if (modal === "campaign") {
                    const c = await api("/campaigns", {
                      name: f.get("name"),
                      mailboxId: f.get("mailboxId"),
                      timing: {
                        days: [0, 3, 7, 12, 18],
                        timezone: "Asia/Kolkata",
                        startHour: 9,
                        endHour: 18,
                        skipWeekends: true,
                      },
                    });
                    setCampaign(c.id);
                    nav("Campaigns");
                  } else
                    await api("/cases", {
                      client: f.get("client"),
                      industry: f.get("industry"),
                      roles: f.get("roles"),
                      result: f.get("result"),
                      permission: f.get("permission") === "on",
                    });
                  setModal(null);
                });
              }}
            >
              {modal === "campaign" ? (
                <>
                  <label>
                    Campaign name
                    <input
                      name="name"
                      placeholder="e.g. Technology partnerships · October"
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Sender mailbox
                    <select name="mailboxId" required>
                      {data.mailboxes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · {m.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="schedule-preview">
                    DAY 0 <span>→</span> DAY 3 <span>→</span> DAY 7{" "}
                    <span>→</span> DAY 12 <span>→</span> DAY 18
                  </div>
                  <p className="footnote">
                    09:00–18:00 Asia/Kolkata · Weekends excluded. Timing is
                    editable.
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Client name
                    <input name="client" required />
                  </label>
                  <label>
                    Industry
                    <input name="industry" required />
                  </label>
                  <label>
                    Roles supported
                    <input name="roles" required />
                  </label>
                  <label>
                    Approved result or testimonial
                    <textarea name="result" required rows={4} />
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" name="permission" /> We have
                    permission to use this wording in outreach.
                  </label>
                </>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : modal === "campaign"
                    ? "Create campaign"
                    : "Save evidence"}
                <ArrowRight size={16} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
type Run = (fn: () => Promise<any>, success?: string) => Promise<any>;
function CampaignCard({
  campaign: c,
  data,
  busy,
  run,
  onSelect,
}: {
  campaign: Campaign;
  data: Data;
  busy: boolean;
  run: Run;
  onSelect: () => void;
}) {
  const [edit, setEdit] = useState(false);
  return (
    <section className="panel campaign-card">
      <div className="panel-title">
        <div className="campaign-icon">
          <Layers size={21} />
        </div>
        <Badge status={c.status} />
      </div>
      <h2>{c.name}</h2>
      <p>
        {data.enrollments.filter((e) => e.sequenceId === c.id).length} enrolled
        contacts · 5 emails per contact
      </p>
      <div className="campaign-days">
        {c.timing.days.map((d, i) => (
          <div key={i}>
            <span>{i + 1}</span>
            <small>Day {d}</small>
          </div>
        ))}
      </div>
      <div className="detail-row">
        <span>Sending window</span>
        <b>
          {c.timing.startHour}:00–{c.timing.endHour}:00
        </b>
      </div>
      <div className="detail-row">
        <span>Timezone</span>
        <b>{c.timing.timezone}</b>
      </div>
      <div className="detail-row">
        <span>Sender</span>
        <b>{data.mailboxes.find((m) => m.id === c.mailboxId)?.name}</b>
      </div>
      <div className="button-row">
        <button
          className="primary"
          onClick={onSelect}
          disabled={c.status === "Stopped"}
        >
          <Users size={15} /> Select contacts
        </button>
        <button className="secondary" onClick={() => setEdit(!edit)}>
          <Settings size={15} /> Timing
        </button>
      </div>
      {edit && (
        <form
          className="timing-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                api(
                  `/campaigns/${c.id}`,
                  {
                    mailboxId: f.get("mailboxId"),
                    timing: {
                      days: String(f.get("days")).split(",").map(Number),
                      timezone: f.get("timezone"),
                      startHour: Number(f.get("startHour")),
                      endHour: Number(f.get("endHour")),
                      skipWeekends: f.get("skipWeekends") === "on",
                    },
                  },
                  "PATCH",
                ),
              "Campaign timing saved for future enrollments",
            );
          }}
        >
          <label>
            Five day offsets, separated by commas
            <input
              name="days"
              defaultValue={c.timing.days.join(", ")}
              required
            />
          </label>
          <label>
            Timezone
            <input name="timezone" defaultValue={c.timing.timezone} required />
          </label>
          <div className="form-columns">
            <label>
              From hour
              <input
                name="startHour"
                type="number"
                min="0"
                max="23"
                defaultValue={c.timing.startHour}
              />
            </label>
            <label>
              To hour
              <input
                name="endHour"
                type="number"
                min="1"
                max="24"
                defaultValue={c.timing.endHour}
              />
            </label>
          </div>
          <label>
            Sender
            <select name="mailboxId" defaultValue={c.mailboxId}>
              {data.mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              name="skipWeekends"
              type="checkbox"
              defaultChecked={c.timing.skipWeekends}
            />{" "}
            Exclude weekends
          </label>
          <p className="footnote">
            Applies to future enrollments. Existing contacts keep their approved
            schedule.
          </p>
          <button className="secondary" disabled={busy}>
            Save timing
          </button>
        </form>
      )}
      <div className="campaign-controls">
        <button
          className="text-button"
          disabled={busy || c.status === "Stopped"}
          onClick={() =>
            void run(
              () =>
                api(
                  `/campaigns/${c.id}`,
                  { action: c.status === "Paused" ? "activate" : "pause" },
                  "PATCH",
                ),
              c.status === "Paused"
                ? "Campaign activated. Resume contacts individually."
                : "Campaign paused",
            )
          }
        >
          {c.status === "Paused" ? <Play size={14} /> : <Pause size={14} />}{" "}
          {c.status === "Paused" ? "Activate campaign" : "Pause campaign"}
        </button>
        <button
          className="text-button danger"
          disabled={busy || c.status === "Stopped"}
          onClick={() =>
            void run(
              () => api(`/campaigns/${c.id}`, { action: "stop" }, "PATCH"),
              "Campaign stopped",
            )
          }
        >
          Stop campaign
        </button>
      </div>
    </section>
  );
}
function DraftCard({
  draft: d,
  enrollment: e,
  busy,
  run,
}: {
  draft: Draft & { html?: string; plannedAt?: string };
  enrollment: Enrollment;
  busy: boolean;
  run: Run;
}) {
  const [edit, setEdit] = useState(false),
    [html, setHtml] = useState(false),
    [history, setHistory] = useState(false),
    [subject, setSubject] = useState(d.subject),
    [body, setBody] = useState(d.body);
  const locked =
    !["Draft", "Ready", "Paused"].includes(e.status) || d.step < e.sent;
  return (
    <section className="panel draft-card">
      <div className="draft-top">
        <span className="step-number">{d.step + 1}</span>
        <div>
          <h3>
            {
              [
                "Personalized introduction",
                "Relevant hiring support",
                "Credibility & process",
                "Market context",
                "Close the loop",
              ][d.step]
            }
          </h3>
          <small>
            Day {e.timing.days[d.step]} · {fmt(d.plannedAt)}
            {!e.startAt ? " (if started now)" : ""}
          </small>
        </div>
        <div className="spacer" />
        <Badge
          status={
            d.step < e.sent ? "submitted" : d.approved ? "Approved" : "Draft"
          }
        />
      </div>
      <div className="draft-body">
        {edit ? (
          <>
            <label>
              Subject
              <input
                value={subject}
                onChange={(ev) => setSubject(ev.target.value)}
              />
            </label>
            <label>
              Message
              <textarea
                rows={12}
                value={body}
                onChange={(ev) => setBody(ev.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/enrollments/${e.id}/drafts/${d.step}`,
                      { subject, body, version: d.version, approve: false },
                      "PATCH",
                    );
                    setEdit(false);
                  })
                }
              >
                Save draft
              </button>
              <button className="secondary" onClick={() => setEdit(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="subject">
              <span>Subject</span>
              <b>{d.subject}</b>
            </div>
            {html ? (
              <iframe
                title={`Sanitized HTML preview email ${d.step + 1}`}
                sandbox=""
                srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:14px/1.8 system-ui;color:#394640;padding:12px}p{margin:0 0 18px}</style></head><body>${d.html || ""}</body></html>`}
              />
            ) : (
              <div className="email-body">{d.body}</div>
            )}
          </>
        )}
        <div className="draft-meta">
          <span>{body.trim().split(/\s+/).length} / 179 words</span>
          <button className="text-button" onClick={() => setHtml(!html)}>
            {html ? "Plain text" : "HTML preview"}
          </button>
        </div>
      </div>
      <div className="evidence-strip">
        <div>
          <Link size={13} />
          <span>
            {d.personalization.join(" · ") || "General partnership outreach"}
          </span>
        </div>
        {d.evidenceIds.map((uid) => {
          const ev = e.research.evidence.find((r) => r.id === uid);
          return ev ? (
            <a key={uid} href={ev.url} target="_blank" rel="noreferrer">
              {ev.kind} source <ExternalLink size={12} />
            </a>
          ) : (
            <span key={uid}>Evidence unavailable: re-review required</span>
          );
        })}
        <small>Proof used: {d.caseStudyId || "No client testimonial"}</small>
        <small>{d.limitations.join(" ")}</small>
      </div>
      <div className="draft-actions">
        <button
          className="text-button"
          disabled={locked}
          onClick={() => setEdit(!edit)}
        >
          <FileText size={14} /> Edit
        </button>
        <button
          className="text-button"
          disabled={busy || locked}
          onClick={() =>
            void run(
              () => api(`/enrollments/${e.id}/generate`, { step: d.step }),
              "This email was regenerated; other drafts were preserved",
            )
          }
        >
          <Sparkles size={14} /> Regenerate
        </button>
        <button className="text-button" onClick={() => setHistory(!history)}>
          <History size={14} /> v{d.version}
        </button>
        <div className="spacer" />
        <button
          className="text-button"
          disabled={busy || locked || edit}
          onClick={() =>
            void run(() =>
              api(
                `/enrollments/${e.id}/drafts/${d.step}`,
                {
                  subject: d.subject,
                  body: d.body,
                  version: d.version,
                  approve: !d.approved,
                },
                "PATCH",
              ),
            )
          }
        >
          <Check size={15} />
          {d.approved ? "Reviewed" : "Mark reviewed"}
        </button>
      </div>
      {history && (
        <div className="versions">
          {d.history.length ? (
            d.history.map((h) => (
              <details key={h.version}>
                <summary>
                  Version {h.version} · {fmt(h.at)}
                </summary>
                <h4>{h.subject}</h4>
                <p className="email-body">{h.body}</p>
              </details>
            ))
          ) : (
            <p>First version. Earlier drafts will appear here after edits.</p>
          )}
        </div>
      )}
    </section>
  );
}
function ResearchPanel({
  enrollment: e,
  busy,
  run,
}: {
  enrollment: Enrollment;
  busy: boolean;
  run: Run;
}) {
  const [adding, setAdding] = useState(false);
  const locked = !["Draft", "Ready", "Paused"].includes(e.status);
  return (
    <section className="panel compact research-panel">
      <div className="panel-title">
        <h3>
          <Sparkles size={17} /> Prospect context
        </h3>
        <span className="count">{e.research.evidence.length}</span>
      </div>
      <div className="research-company">
        <Building2 size={18} />
        <div>
          <b>{e.contact.company}</b>
          <small>{e.contact.industry}</small>
        </div>
      </div>
      <p>{e.contact.companyInfo || "No company description in CRM."}</p>
      {e.contact.website && (
        <a
          className="source-link"
          href={e.contact.website}
          target="_blank"
          rel="noreferrer"
        >
          <Globe size={14} /> Company website <ExternalLink size={12} />
        </a>
      )}
      {e.contact.linkedin && (
        <a
          className="source-link"
          href={e.contact.linkedin}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} /> LinkedIn profile
        </a>
      )}
      <div className="research-label">VERIFIED FACTS & SOURCES</div>
      {e.research.evidence.map((ev) => (
        <div className="evidence-card" key={ev.id}>
          <Badge status={ev.verified ? "Verified" : "Needs review"} />
          <p>{ev.summary}</p>
          <a href={ev.url} target="_blank" rel="noreferrer">
            Open source <ExternalLink size={12} />
          </a>
          <small>
            Published: {ev.publishedAt ? fmt(ev.publishedAt) : "Unknown"}
          </small>
          <small>Researched: {fmt(ev.researchedAt)}</small>
          <button
            className="text-button"
            disabled={busy || locked}
            onClick={() =>
              void run(
                () =>
                  api(`/enrollments/${e.id}/research/${ev.id}/verify`, {
                    verified: !ev.verified,
                  }),
                "Source review saved",
              )
            }
          >
            {ev.verified ? "Remove verification" : "I verified this source"}
          </button>
        </div>
      ))}
      {!e.research.evidence.length && (
        <div className="research-empty">
          No verified research yet. Drafts will use general recruitment
          partnership outreach.
        </div>
      )}
      <button
        className="text-button"
        disabled={busy || locked || !e.research.evidence.length}
        onClick={() =>
          void run(
            () => api(`/enrollments/${e.id}/research/analyze`, {}),
            "Research analysis saved. Verify each suggested observation.",
          )
        }
      >
        <Sparkles size={13} /> Analyze collected sources
      </button>
      <div className="research-label">LIMITATIONS</div>
      {e.research.limitations.map((x, i) => (
        <p className="limitation" key={i}>
          <AlertCircle size={13} />
          {x}
        </p>
      ))}
      {e.research.hypotheses.length > 0 && (
        <>
          <div className="research-label">POSSIBLE CHALLENGES · NOT FACTS</div>
          {e.research.hypotheses.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </>
      )}
      <button
        className="secondary full"
        disabled={busy || locked}
        onClick={() => setAdding(!adding)}
      >
        <Plus size={14} /> Add or refresh research
      </button>
      {adding && (
        <form
          className="research-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            const f = new FormData(ev.currentTarget);
            const url = String(f.get("url"));
            const summary = String(f.get("summary") || "");
            void run(
              () =>
                api(
                  `/enrollments/${e.id}/research`,
                  summary
                    ? {
                        evidence: {
                          url,
                          summary,
                          kind: f.get("kind"),
                          verified: f.get("verified") === "on",
                          ...(f.get("date")
                            ? {
                                publishedAt: new Date(
                                  String(f.get("date")),
                                ).toISOString(),
                              }
                            : {}),
                        },
                      }
                    : { url, refresh: true },
                ),
              "Research saved. Re-review drafts before starting",
            );
          }}
        >
          <label>
            Public source URL
            <input type="url" name="url" placeholder="https://…" required />
          </label>
          <label>
            Source type
            <select name="kind">
              <option value="company">Company information</option>
              <option value="hiring">Hiring post</option>
              <option value="employment">Current employment</option>
              <option value="post">Accessible recent post</option>
              <option value="market">Market context</option>
              <option value="competitor">Comparable company</option>
            </select>
          </label>
          <label>
            Publication date, if known
            <input type="date" name="date" />
          </label>
          <label>
            Supporting excerpt
            <textarea
              name="summary"
              rows={5}
              placeholder="Paste accessible profile information or a factual excerpt. Leave blank to fetch the public page."
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="verified" /> I checked this source and
            verified the excerpt.
          </label>
          <p className="footnote">
            Fetched pages require review. Hiring sources must be dated within 30
            days to support current hiring claims.
          </p>
          <button className="primary full" disabled={busy}>
            Save research
          </button>
        </form>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

