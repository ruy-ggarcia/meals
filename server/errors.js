// Errors that the stores throw for bad input. server/app.js maps each one to
// an HTTP status, so the stores never deal with HTTP.

/** The input breaks a rule, such as an empty recipe name. */
export class ValidationError extends Error {
  name = "ValidationError";
}

/** The input names something that doesn't exist, such as an unknown recipe ID. */
export class NotFoundError extends Error {
  name = "NotFoundError";
}

/**
 * Another entry already has the name key. `kind` is "recipe" or
 * "ingredient", and `entity` is that entry.
 */
export class NameConflictError extends Error {
  name = "NameConflictError";

  constructor(message, kind, entity) {
    super(message);
    this.kind = kind;
    this.entity = entity;
  }
}
