// The failure of a call to a provider, in one shape for every provider. Its
// message is safe to log: it never holds the API key.

/**
 * @typedef {"auth" | "network" | "overloaded" | "rate_limit" | "timeout" | "too_long" | "other"} ProviderErrorKind
 */

/** A call to a provider failed. `kind` tells the caller what to do about it. */
export class ProviderError extends Error {
  name = "ProviderError";

  /**
   * @param {ProviderErrorKind} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
