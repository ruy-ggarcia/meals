import { fileURLToPath } from "node:url";
import express from "express";
import { ConflictError, NameConflictError, NotFoundError, ValidationError } from "./errors.js";
import { silentLogger } from "./logger.js";
import { DAYS, isWeekId, MEALS } from "./weeks.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

/** The path of a request, without its query string. */
function pathOf(req) {
  return req.originalUrl.split("?")[0];
}

/** Logs each request when its response finishes. */
function logRequests(logger) {
  return (req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      logger.info("request", {
        method: req.method,
        path: pathOf(req),
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  };
}

export function createApp({ ingredients, recipes, weeks }, { logger = silentLogger } = {}) {
  const app = express();
  app.use("/api", logRequests(logger));
  app.use(express.json());

  app.get("/api/recipes", async (_req, res) => {
    res.json({ recipes: await recipes.list() });
  });

  app.get("/api/ingredients", async (_req, res) => {
    res.json({ ingredients: await ingredients.list() });
  });

  // From here on, every route that passes req.body to a store: Express 5
  // leaves req.body undefined when there is no JSON body. The stores
  // validate what they get and throw the errors that the handler below maps.
  app.post("/api/recipes", async (req, res) => {
    res.status(201).json(await recipes.create(req.body));
  });

  app.patch("/api/recipes/:id", async (req, res) => {
    res.json(await recipes.update(req.params.id, req.body));
  });

  app.post("/api/ingredients", async (req, res) => {
    res.status(201).json(await ingredients.create(req.body));
  });

  app.patch("/api/ingredients/:id", async (req, res) => {
    res.json(await ingredients.update(req.params.id, req.body));
  });

  app.get("/api/weeks/:week", async (req, res) => {
    const { week } = req.params;
    if (!isWeekId(week)) {
      res.status(404).json({ error: `Unknown week: ${week}` });
      return;
    }
    res.json(await weeks.readWeek(week));
  });

  app.put("/api/weeks/:week/:day/:meal", async (req, res) => {
    const { week, day, meal } = req.params;
    if (!isWeekId(week) || !DAYS.includes(day) || !MEALS.includes(meal)) {
      res.status(404).json({ error: `Unknown week, day, or meal: ${week}/${day}/${meal}` });
      return;
    }
    res.json(await weeks.saveSlot(week, day, meal, req.body?.items));
  });

  // Any other /api path: JSON 404 (the API only ever answers JSON).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(express.static(PUBLIC_DIR));

  // Final error handler (Express 5 forwards rejected async handlers here).
  // 4xx errors from body parsing (for example, malformed JSON -> 400) keep their status.
  // Keep all four parameters: Express identifies error handlers by arity.
  app.use((err, req, res, _next) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof NameConflictError) {
      res.status(409).json({ error: err.message, [err.kind]: err.entity });
      return;
    }
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) {
      logger.error("request failed", {
        method: req.method,
        path: pathOf(req),
        error: err?.stack ?? String(err),
      });
    }
    res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
  });

  return app;
}
