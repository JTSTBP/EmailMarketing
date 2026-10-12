import { MongoStore } from "../src/store";
import { config } from "../src/config";
const store = await MongoStore.connect(config.mongo);
await store.close();
console.log("Schema version 1 indexes are ready.");
