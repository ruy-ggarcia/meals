import { fileURLToPath } from "node:url";
import express from "express";
import { DAYS, isWeekId, MEALS } from "./store.js";

export const MAX_TEXT_LENGTH = 2000;

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

export function createApp({ store }) {
  const app = express();
  app.use(express.json());

  app.get("/api/weeks/:week", async (req, res) => {
    const { week } = req.params;
    if (!isWeekId(week)) {
      res.status(404).json({ error: `Unknown week: ${week}` });
      return;
    }
    res.json(await store.readWeek(week));
  });

  app.put("/api/weeks/:week/:day/:meal", async (req, res) => {
    const { week, day, meal } = req.params;
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      res.status(404).json({ error: `Unknown week, day, or meal: ${week}/${day}/${meal}` });
      return;
    }

    // Express 5 leaves req.body undefined when there is no JSON body.
    const text = req.body?.text;
    if (typeof text !== "string") {
      res.status(400).json({ error: '"text" must be a string' });
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      res.status(400).json({ error: `"text" must be at most ${MAX_TEXT_LENGTH} characters` });
      return;
    }

    res.json(await store.saveCell(week, day, meal, text));
  });

  // Any other /api path: JSON 404 (the API only ever answers JSON).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(express.static(PUBLIC_DIR));

  // Final error handler (Express 5 forwards rejected async handlers here).
  // 4xx errors from body parsing (for example, malformed JSON -> 400) keep their status.
  // Keep all four parameters: Express identifies error handlers by arity.
  app.use((err, _req, res, _next) => {
    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
  });

  return app;
}
