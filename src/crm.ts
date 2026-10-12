import { config } from "./config";
import { assert, id, sign } from "./security";
import type { Contact, User, Event, State } from "./types";
export interface CRM {
  contacts(user: User): Promise<Contact[]>;
  contact(userId: string, leadId: string, pocId: string): Promise<Contact>;
  sync(event: Event): Promise<void>;
}
export class MockCRM implements CRM {
  constructor(private read: () => Promise<State>) {}
  async contacts(u: User) {
    return (await this.read()).contacts.filter(
      (c) => u.role === "Admin" || c.owners.some((o) => u.scope.includes(o)),
    );
  }
  async contact(userId: string, leadId: string, pocId: string) {
    const c = (await this.read()).contacts.find(
      (c) => c.leadId === leadId && c.pocId === pocId,
    );
    assert(c, "CRM contact not found", 404);
    assert(
      userId === "demo-admin" || c.owners.includes(userId),
      "CRM access revoked",
      403,
    );
    return c;
  }
  async sync(_event: Event) {}
}
export async function crmRequest(
  path: string,
  method = "GET",
  body?: unknown,
  actor?: string,
) {
  const payload = body === undefined ? "" : JSON.stringify(body),
    timestamp = String(Date.now()),
    nonce = id();
  const signedPath = path;
  const response = await fetch(`${config.crmUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-outreach-timestamp": timestamp,
      "x-outreach-nonce": nonce,
      "x-outreach-signature": sign(
        method,
        signedPath,
        timestamp,
        nonce,
        payload,
      ),
      "x-outreach-actor": actor || "",
      "x-outreach-actor-signature": sign(
        method,
        signedPath,
        timestamp,
        nonce,
        `${payload}\n${actor || ""}`,
      ),
    },
    body: payload || undefined,
    signal: AbortSignal.timeout(15000),
  });
  assert(
    response.ok,
    `CRM request failed (${response.status})`,
    response.status === 403 ? 403 : 502,
  );
  return response.json();
}
export class LiveCRM implements CRM {
  async contacts(u: User) {
    const result: Contact[] = [];
    for (let page = 1; page <= 100; page++) {
      const data: any = await crmRequest(
        `/api/outreach/contacts?page=${page}`,
        "GET",
        undefined,
        u.id,
      );
      result.push(...data.contacts);
      if (!data.hasMore) return result;
    }
    throw new Error(
      "CRM pagination exceeds pilot limit; narrow the contact export",
    );
  }
  async contact(userId: string, leadId: string, pocId: string) {
    return (await crmRequest(
      `/api/outreach/contacts/${encodeURIComponent(leadId)}/${encodeURIComponent(pocId)}`,
      "GET",
      undefined,
      userId,
    )) as Contact;
  }
  async sync(event: Event) {
    await crmRequest("/api/outreach/events", "POST", event);
  }
}
