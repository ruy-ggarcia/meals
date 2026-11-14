// The providers that the assistant can use: for each one, the factory of its
// adapter and the function that lists its models. Every list of providers on
// the server comes from here.

import { createAnthropicProvider, listAnthropicModels } from "./anthropic.js";
import { createOpenAIProvider, listOpenAIModels } from "./openai.js";

/** @typedef {import("./types.js").Model} Model */
/** @typedef {import("./types.js").Provider} Provider */

/**
 * @typedef {Record<"anthropic" | "openai", (options: { apiKey: string, model: string }) => Provider>} ProviderFactories
 */

/**
 * @typedef {Record<"anthropic" | "openai", (options: { apiKey: string }) => Promise<Model[]>>} ModelLists
 */

/** @type {ProviderFactories} */
export const PROVIDER_FACTORIES = {
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
};

/** @type {ModelLists} */
export const MODEL_LISTS = { anthropic: listAnthropicModels, openai: listOpenAIModels };

/** The names of the providers, in the order that messages list them. */
export const PROVIDERS = Object.keys(PROVIDER_FACTORIES);
