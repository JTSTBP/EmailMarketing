import { MongoClient } from "mongodb";
import { tables, type State } from "./types";
export function emptyState(): State {
  return Object.fromEntries(
    tables.map((k) => [
      k,
      k === "settings"
        ? [{ id: "global", emergencyStop: false, schemaVersion: 1 }]
        : [],
    ]),
  ) as unknown as State;
}
export interface Store {
  manualSendHistory?(mailboxIds: string[]): Promise<ManualSendRecord[]>;
  read(): Promise<State>;
  change<T>(fn: (s: State) => T): Promise<T>;
  close(): Promise<void>;
}
export type ManualSendRecord = {
  id: string; recipient: string; subject: string; body: string;
  mailboxId: string; state: string; providerId?: string; enrollmentId?: string;
  createdAt: string; acceptedAt?: string;
};
// A transaction serializes state transitions across API and workers. External I/O is never
// performed inside the callback, which MongoDB may retry. Records live in separate collections.
export class MongoStore implements Store {
  constructor(public client: MongoClient) {}
  async manualSendHistory(mailboxIds: string[]): Promise<ManualSendRecord[]> {
    const rows = await this.client.db().collection("manual_send_tests")
      .find({ mailboxId: { $in: mailboxIds } }, { projection: {
        _id: 1, recipient: 1, subject: 1, body: 1, mailboxId: 1,
        state: 1, providerId: 1, createdAt: 1, acceptedAt: 1, enrollmentId: 1,
      } }).sort({ createdAt: -1 }).limit(200).toArray();
    return rows.map(({ _id, ...row }) => ({ ...row, id: String(_id) })) as unknown as ManualSendRecord[];
  }
  static async connect(uri: string) {
    const c = new MongoClient(uri);
    await c.connect();
    const s = new MongoStore(c);
    await s.migrate();
    return s;
  }
  async migrate() {
    const db = this.client.db();
    for (const t of tables)
      await db.collection(t).createIndex({ id: 1 }, { unique: true });
    await db
      .collection("enrollments")
      .createIndex({ leadId: 1, pocId: 1, sequenceId: 1 }, { unique: true });
    await db
      .collection("enrollments")
      .createIndex(
        { normalizedEmail: 1 },
        { unique: true, partialFilterExpression: { holdEmail: true } },
      );
    await db
      .collection("jobs")
      .createIndex(
        { enrollmentId: 1, generation: 1, step: 1 },
        { unique: true },
      );
    await db.collection("jobs").createIndex({ state: 1, dueAt: 1 });
    await db
      .collection("incoming")
      .createIndex({ mailboxId: 1, providerId: 1 }, { unique: true });
    await db.collection("events").createIndex({ state: 1, nextAttemptAt: 1 });
    await db
      .collection("settings")
      .updateOne(
        { id: "global" },
        {
          $setOnInsert: {
            id: "global",
            emergencyStop: false,
            schemaVersion: 1,
          },
        },
        { upsert: true },
      );
    await db
      .collection("_revision")
      .updateOne(
        { _id: "state" as any },
        { $setOnInsert: { v: 0 } },
        { upsert: true },
      );
  }
  async read(): Promise<State> {
    const session = this.client.startSession();
    let result!: State;
    try {
      await session.withTransaction(
        async () => {
          const rows = [];
          for (const t of tables)
            rows.push([
              t,
              await this.client
                .db()
                .collection(t)
                .find({}, { session, projection: { _id: 0 } })
                .toArray(),
            ]);
          result = Object.fromEntries(rows) as State;
        },
        { readConcern: { level: "snapshot" } },
      );
      return result;
    } finally {
      await session.endSession();
    }
  }
  async change<T>(fn: (s: State) => T): Promise<T> {
    const session = this.client.startSession();
    let result!: T;
    try {
      await session.withTransaction(
        async () => {
          const db = this.client.db();
          await db
            .collection("_revision")
            .updateOne(
              { _id: "state" as any },
              { $inc: { v: 1 } },
              { session },
            );
          const s = emptyState();
          for (const t of tables)
            (s[t] as any) = await db
              .collection(t)
              .find({}, { session, projection: { _id: 0 } })
              .toArray();
          const before = structuredClone(s);
          result = fn(s);
          for (const t of tables) {
            const old = new Map(
              (before[t] as { id: string }[]).map((x) => [
                x.id,
                JSON.stringify(x),
              ]),
            );
            const next = s[t] as { id: string }[];
            const operations: any[] = [];
            for (const row of next) {
              if (old.get(row.id) !== JSON.stringify(row))
                operations.push({
                  replaceOne: {
                    filter: { id: row.id },
                    replacement: row,
                    upsert: true,
                  },
                });
              old.delete(row.id);
            }
            for (const id of old.keys())
              operations.push({ deleteOne: { filter: { id } } });
            if (operations.length)
              await db.collection(t).bulkWrite(operations, { session });
          }
        },
        { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } },
      );
      return result;
    } finally {
      await session.endSession();
    }
  }
  async close() {
    await this.client.close();
  }
}
export class MemoryStore implements Store {
  private state: State;
  private chain = Promise.resolve();
  constructor(state = emptyState()) {
    this.state = structuredClone(state);
  }
  async read() {
    await this.chain;
    return structuredClone(this.state);
  }
  async change<T>(fn: (s: State) => T): Promise<T> {
    const run = this.chain.then(() => {
      const copy = structuredClone(this.state);
      const value = fn(copy);
      this.state = copy;
      return structuredClone(value);
    });
    this.chain = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  async close() {}
}
