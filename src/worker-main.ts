import { runtime } from "./runtime";
const { store, worker } = await runtime();
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await worker.tick();
  } catch {
    console.error("Worker cycle failed; durable jobs retained.");
  } finally {
    running = false;
  }
}, 5000);
console.log("Durable sequence worker running");
async function close() {
  clearInterval(timer);
  while (running) await new Promise((r) => setTimeout(r, 100));
  await store.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
