// The configuration of the assistant in three environment variables, which
// take precedence over the settings saved in Settings. With none of them, the
// settings apply. With some of them, or an unknown provider, the server logs
// the problem and the settings apply too: the rest of the app matters more
// than the assistant.

import { PROVIDERS } from "./providers/index.js";

const NAMES = ["ASSISTANT_API_KEY", "ASSISTANT_MODEL", "ASSISTANT_PROVIDER"];

/**
 * @typedef {{ provider: "anthropic" | "openai", model: string, apiKey: string }} AssistantConfig
 */

/**
 * Reads the assistant's configuration from `env`, where an empty variable
 * counts as an unset one. Returns undefined when none of the three is set,
 * and `{ problem }` when the configuration is incomplete or names an unknown
 * provider. The problem names variables, and never holds a value.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {AssistantConfig | { problem: string } | undefined}
 */
export function readAssistantConfig(env) {
  const missing = NAMES.filter((name) => !env[name]);
  if (missing.length === NAMES.length) return undefined;
  if (missing.length > 0) {
    const list = missing.join(" and ");
    const verb = missing.length === 1 ? "is" : "are";
    return {
      problem: `${list} ${verb} missing. Set all three assistant variables, or none of them.`,
    };
  }
  const provider = /** @type {string} */ (env.ASSISTANT_PROVIDER);
  if (!PROVIDERS.includes(provider)) {
    // Never the value: it could be the key, pasted into the wrong line.
    return { problem: `ASSISTANT_PROVIDER must be ${PROVIDERS.join(" or ")}.` };
  }
  return {
    provider: /** @type {AssistantConfig["provider"]} */ (provider),
    model: /** @type {string} */ (env.ASSISTANT_MODEL),
    apiKey: /** @type {string} */ (env.ASSISTANT_API_KEY),
  };
}
