import { MongoStore } from "./store";
import { config, validateConfig } from "./config";
import { seed } from "./seed";
import { MockCRM, LiveCRM } from "./crm";
import { MockEmail, GraphEmail } from "./graph";
import { Worker } from "./worker";
export async function runtime() {
  validateConfig();
  const store = await MongoStore.connect(config.mongo);
  if (config.mode === "mock") await seed(store);
  const crm =
    config.mode === "mock" ? new MockCRM(() => store.read()) : new LiveCRM();
  const provider =
    config.mode === "mock" ? new MockEmail(store) : new GraphEmail(store);
  return { store, crm, provider, worker: new Worker(store, crm, provider) };
}
