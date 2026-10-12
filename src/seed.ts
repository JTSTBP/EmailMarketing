import type { Store } from "./store";
import { defaultTiming } from "./schedule";
export const demoUser = {
  id: "demo-admin",
  name: "Alex Morgan",
  role: "Admin" as const,
  scope: ["demo-admin"],
};
export async function seed(store: Store) {
  await store.change((s) => {
    if (s.mailboxes.length) return;
    s.mailboxes.push({
      id: "demo-mailbox",
      ownerId: demoUser.id,
      email: "alex@jobsterritory.example",
      name: "Alex · Demo mailbox",
      provider: "mock",
      dailyLimit: 50,
      health: "healthy",
      lastSyncAt: new Date().toISOString(),
    });
    s.campaigns.push({
      id: "demo-campaign",
      name: "Recruitment partnerships",
      ownerId: demoUser.id,
      status: "Draft",
      mailboxId: "demo-mailbox",
      timing: defaultTiming,
      createdAt: new Date().toISOString(),
    });
    const rows = [
      ["Aster Labs", "Technology", "Maya Shah", "Head of People"],
      ["Aster Labs", "Technology", "Arjun Rao", "Talent Acquisition Lead"],
      ["Northstar Works", "Manufacturing", "Riya Mehta", "HR Director"],
      ["Cedar Health", "Healthcare", "Dev Patel", "People Operations"],
      ["Morrow Retail", "Retail", "Anika Roy", "Head of Talent"],
      ["Orbit Logistics", "Logistics", "Kabir Sethi", "HR Manager"],
    ];
    s.contacts = rows.map(([company, industry, name, designation], i) => ({
      id: `demo-${i}`,
      leadId: `lead-${i < 2 ? 0 : i}`,
      pocId: `poc-${i}`,
      company,
      industry,
      name,
      designation,
      website: `https://${company.toLowerCase().replaceAll(" ", "")}.example`,
      email: `${name.split(" ")[0].toLowerCase()}@${company.toLowerCase().replaceAll(" ", "")}.example`,
      companyInfo: "Fictional company for local demonstration.",
      linkedin: "",
      owners: [demoUser.id],
      assignedExecutive: demoUser.name,
      hiringNeeds: [],
      sourceLinks: [],
    }));
  });
}
