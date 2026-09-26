import path from "node:path";
import { createApp } from "./app.js";
import { createQueue } from "./files.js";
import { createRecipes } from "./recipes.js";
import { createWeeks } from "./weeks.js";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");

// One queue for every file, so a save never checks recipes while they change.
const enqueue = createQueue();
const recipes = createRecipes({ dataDir, enqueue });
const weeks = createWeeks({ dataDir, enqueue, recipes });
const app = createApp({ recipes, weeks });

app.listen(port, "0.0.0.0", (error) => {
  if (error) throw error;
  console.log(`Meals listening on http://0.0.0.0:${port} (data: ${dataDir})`);
});
