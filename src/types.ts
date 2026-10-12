export type Status =
  | "Draft"
  | "Ready"
  | "Active"
  | "Paused"
  | "Replied"
  | "Stopped"
  | "Completed"
  | "Failed";
export type User = {
  id: string;
  name: string;
  role: "Admin" | "Manager" | "BD Executive";
  scope: string[];
};
export type Contact = {
  id: string;
  leadId: string;
  pocId: string;
  company: string;
  website: string;
  industry: string;
  companyInfo: string;
  name: string;
  designation: string;
  email: string;
  linkedin: string;
  owners: string[];
  assignedExecutive: string;
  hiringNeeds: string[];
  sourceLinks: string[];
};
export type Evidence = {
  id: string;
  url: string;
  publishedAt?: string;
  researchedAt: string;
  summary: string;
  kind: "company" | "employment" | "hiring" | "post" | "market" | "competitor";
  verified: boolean;
};
export type Research = {
  id: string;
  contactId: string;
  company: string;
  evidence: Evidence[];
  hypotheses: string[];
  limitations: string[];
  updatedAt: string;
};
export type Draft = {
  step: number;
  subject: string;
  body: string;
  evidenceIds: string[];
  personalization: string[];
  caseStudyId: string | null;
  limitations: string[];
  approved: boolean;
  version: number;
  history: { subject: string; body: string; version: number; at: string }[];
};
export type Timing = {
  days: number[];
  timezone: string;
  startHour: number;
  endHour: number;
  skipWeekends: boolean;
};
export type Campaign = {
  id: string;
  name: string;
  ownerId: string;
  status: "Draft" | "Active" | "Paused" | "Stopped";
  mailboxId: string;
  timing: Timing;
  createdAt: string;
};
export type Enrollment = {
  id: string;
  leadId: string;
  pocId: string;
  sequenceId: string;
  ownerId: string;
  contact: Contact;
  mailboxId: string;
  timing: Timing;
  status: Status;
  stopReason: string | null;
  holdEmail: boolean;
  normalizedEmail: string;
  drafts: Draft[];
  research: Research;
  sent: number;
  startAt?: string;
  nextAt?: string;
  lastSentAt?: string;
  conversationId?: string;
  replyId?: string;
  generation: number;
  revision: number;
  blockedReason?: string;
  createdAt: string;
};
export type Job = {
  id: string;
  enrollmentId: string;
  step: number;
  generation: number;
  dueAt: string;
  state:
    | "pending"
    | "claimed"
    | "dispatching"
    | "submitted"
    | "cancelled"
    | "uncertain"
    | "failed";
  attempts: number;
  leaseUntil?: string;
  leaseId?: string;
  providerId?: string;
  conversationId?: string;
  internetMessageId?: string;
  submittedAt?: string;
  error?: string;
  dayKey?: string;
  slotReserved?: boolean;
  content?: { subject:string; body:string; evidence:Evidence[]; caseStudy?:CaseStudy };
};
export type Mailbox = {
  id: string;
  ownerId: string;
  email: string;
  name: string;
  provider: "mock" | "graph";
  dailyLimit: number;
  health: "healthy" | "syncing" | "unhealthy" | "reconnect";
  lastSyncAt?: string;
  tokens?: string;
  expiresAt?: number;
  deltaLinks?: Record<string, string>;
  pendingMessageIds?: string[];
  subscriptionId?: string;
  subscriptionExpiresAt?: string;
  clientState?: string;
  syncRequested?: boolean;
  syncLeaseUntil?: string;
  syncLeaseId?: string;
  retryAt?: string;
  error?: string;
};
export type Incoming = {
  id: string;
  mailboxId: string;
  providerId: string;
  conversationId?: string;
  inReplyTo?: string;
  references?: string[];
  originalMessageId?: string;
  from: string;
  subject: string;
  body: string;
  kind: "reply" | "automatic" | "bounce" | "unsubscribe";
  receivedAt: string;
  enrollmentId?: string;
  manualTestId?: string;
};
export type CaseStudy = {
  id: string;
  client: string;
  industry: string;
  roles: string;
  result: string;
  permission: boolean;
};
export type Event = {
  id: string;
  enrollmentId: string;
  leadId: string;
  pocId: string;
  type: string;
  status: Status;
  stopReason: string | null;
  sent: number;
  lastSentAt?: string;
  nextAt?: string;
  replyId?: string;
  revision: number;
  at: string;
  state: "pending" | "synced" | "failed";
  attempts: number;
  nextAttemptAt: string;
  error?: string;
};
export type Audit = {
  id: string;
  actor: string;
  action: string;
  entityId: string;
  at: string;
  detail?: string;
};
export type Usage = {
  id: string;
  ownerId: string;
  enrollmentId: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  currency: string;
  at: string;
  valid: boolean;
};
export type Session = {
  id: string;
  user: User;
  expiresAt: string;
  crmToken?: string;
};
export type State = {
  contacts: Contact[];
  research: Research[];
  campaigns: Campaign[];
  enrollments: Enrollment[];
  jobs: Job[];
  mailboxes: Mailbox[];
  incoming: Incoming[];
  cases: CaseStudy[];
  events: Event[];
  audits: Audit[];
  usage: Usage[];
  sessions: Session[];
  suppressions: { id: string; reason: string; at: string }[];
  oauth: {
    id: string;
    userId: string;
    sessionId: string;
    verifier: string;
    expiresAt: string;
  }[];
  receipts: { id: string; at: string }[];
  settings: { id: string; emergencyStop: boolean; schemaVersion: number }[];
};
export const tables = [
  "contacts",
  "research",
  "campaigns",
  "enrollments",
  "jobs",
  "mailboxes",
  "incoming",
  "cases",
  "events",
  "audits",
  "usage",
  "sessions",
  "suppressions",
  "oauth",
  "receipts",
  "settings",
] as const;
