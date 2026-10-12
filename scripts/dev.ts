import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
await mkdir(".local/mongo", { recursive: true });
const mongo = await MongoMemoryReplSet.create({
  instanceOpts: [{ dbPath: path.resolve(".local/mongo"), port: 27019, launchTimeout: 60000 }],
  replSet: { count: 1, storageEngine: "wiredTiger", name: "jt-local" },
  binary: { version: "7.0.14" },
});
const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri("jt_outreach"),
  APP_MODE: "mock",
  ENABLE_LIVE_SENDING: "false",
};
console.log("Persistent local MongoDB ready. Data: .local/mongo");
const children = [
  spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    stdio: "inherit",
    env,
  }),
  spawn(
    process.execPath,
    ["--import", "tsx", "src/worker-main.ts"],
    { stdio: "inherit", env },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { stdio: "inherit", env },
  ),
];
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  await mongo.stop({ doCleanup: false, force: false });
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
for (const child of children)
  child.on("exit", () => {
    if (!closing) void close();
  });
