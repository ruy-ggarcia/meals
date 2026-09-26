import path from "node:path";
import { createApp } from "./app.js";
import { createStore, weekIdOf } from "./store.js";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");

const store = createStore({ dataDir });
// Data from the single-week version becomes the current week.
await store.migrateLegacyWeek(weekIdOf(new Date()));

const app = createApp({ store });

app.listen(port, "0.0.0.0", (error) => {
  if (error) throw error;
  console.log(`Meals listening on http://0.0.0.0:${port} (data: ${dataDir})`);
});
