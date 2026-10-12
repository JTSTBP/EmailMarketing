import { runtime } from "./runtime";
import { createApp } from "./app";
import { config } from "./config";
const { store, crm, worker } = await runtime();
const server = createApp(store, crm, worker).listen(
  config.port,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `Jobs Territory API: http://127.0.0.1:${config.port} (${config.mode}; live sending ${config.liveSending ? "enabled" : "disabled"})`,
    ),
);
async function close() {
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
