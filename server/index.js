import path from "node:path";
import { createApp } from "./app.js";
import { createStores } from "./stores.js";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");

const app = createApp(createStores({ dataDir }));

app.listen(port, "0.0.0.0", (error) => {
  if (error) throw error;
  console.log(`Meals listening on http://0.0.0.0:${port} (data: ${dataDir})`);
});
