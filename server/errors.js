// Errors that the stores and the assistant throw for bad input, a failed
// save, or a failed provider. server/app.js maps each one to an HTTP status,
// so they never deal with HTTP.

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

/** The request conflicts with the data in another way, such as a new unit for an ingredient in use. */
export class ConflictError extends Error {
  name = "ConflictError";
}

const RULE_ERRORS = [ConflictError, NameConflictError, NotFoundError, ValidationError];

/**
 * Whether `error` is one that a rule throws for bad input: one of the four
 * errors above, which server/app.js maps to 400, 404, and 409. Anything else
 * is a fault, such as a failed write, or a bug.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRuleError(error) {
  return RULE_ERRORS.some((type) => error instanceof type);
}

/**
 * A service that the server asks on behalf of a request, such as the
 * assistant's provider, failed or didn't answer in time.
 */
export class UpstreamError extends Error {
  name = "UpstreamError";
}

/**
 * A transaction failed after it wrote some of its files, so part of its
 * changes is saved. `cause` is the failure of the write.
 */
export class PartialSaveError extends Error {
  name = "PartialSaveError";

  /** @param {any} cause */
  constructor(cause) {
    super(`Part of the changes was saved before a write failed: ${cause?.message ?? cause}`, {
      cause,
    });
  }
}
