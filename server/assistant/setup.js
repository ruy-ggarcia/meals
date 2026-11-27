// Where the assistant's provider comes from: the three environment variables
// when all of them are set, or else the settings saved in Settings. A save
// replaces the provider at once, so the next turn uses the new one. The
// assistant is on while there is a provider.
//
// The provider's model list checks a key: a list that arrives proves that
// the provider accepts the key. A save that keeps or sets a key checks it,
// and the model, with the list first, so the saved settings always have a
// key that the provider accepted. A saved key only ever goes to its own
// provider.

import { ConflictError, UpstreamError, ValidationError } from "../errors.js";
import { silentLogger } from "../logger.js";
import { ProviderError } from "./providers/errors.js";
import { MODEL_LISTS, PROVIDER_FACTORIES } from "./providers/index.js";
import { checkChanges, checkListRequest } from "./settings.js";

/** @typedef {import("./config.js").AssistantConfig} AssistantConfig */
/** @typedef {import("./providers/index.js").ModelLists} ModelLists */
/** @typedef {import("./providers/index.js").ProviderFactories} ProviderFactories */
/** @typedef {import("./providers/types.js").Model} Model */
/** @typedef {import("./providers/types.js").Provider} Provider */
/** @typedef {import("./settings.js").SavedSettings} SavedSettings */

/**
 * What Settings shows: never the key, only whether one is saved. Before the
 * first save, the provider and the model are null.
 * @typedef {{ provider: string | null, model: string | null, keySaved: boolean, source: "environment" | "settings" }} SettingsView
 */

const ON_SERVER = "The assistant is set up on the server.";

/**
 * @param {object} options
 * @param {AssistantConfig} [options.environment] The complete configuration
 *   of the environment variables, which takes precedence over the settings.
 * @param {ReturnType<typeof import("./settings.js").createAssistantSettings>} options.settings
 * @param {ProviderFactories} [options.providerFactories]
 * @param {ModelLists} [options.modelLists]
 * @param {import("../logger.js").Logger} [options.logger]
 */
export function createAssistantSetup({
  environment,
  settings,
  providerFactories = PROVIDER_FACTORIES,
  modelLists = MODEL_LISTS,
  logger = silentLogger,
}) {
  /** @type {Provider | undefined} */
  let provider;

  /** The provider of `config`, or undefined when it has no key. */
  function build(config) {
    if (!config?.apiKey) return undefined;
    return providerFactories[config.provider]({ apiKey: config.apiKey, model: config.model });
  }

  /**
   * The saved key of `provider`. Rejects with a ValidationError when no key
   * is saved, or when the saved key belongs to the other provider.
   * @param {"anthropic" | "openai"} provider
   * @returns {Promise<string>}
   */
  async function savedKeyOf(provider) {
    const saved = await settings.read();
    if (!saved?.apiKey || saved.provider !== provider) {
      throw new ValidationError("Enter an API key for this provider.");
    }
    return saved.apiKey;
  }

  /**
   * The models that `provider` lists for `apiKey`. A rejected key rejects
   * with a ValidationError, and any other failure of the provider with an
   * UpstreamError, which the server logs. A ProviderError never holds the
   * key, so the log doesn't either.
   * @param {"anthropic" | "openai"} provider
   * @param {string} apiKey
   * @returns {Promise<Model[]>}
   */
  async function listModels(provider, apiKey) {
    try {
      return await modelLists[provider]({ apiKey });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.kind === "auth") throw new ValidationError("The provider didn't accept this key.");
      logger.error("assistant key check failed", {
        provider,
        kind: error.kind,
        error: error.message,
      });
      throw new UpstreamError("Couldn't check the key.");
    }
  }

  /** @returns {SettingsView} */
  function viewOf(config, source) {
    return {
      provider: config?.provider ?? null,
      model: config?.model ?? null,
      keySaved: Boolean(config?.apiKey),
      source,
    };
  }

  return {
    /**
     * Builds the provider that the server starts with. A settings file that
     * can't be read leaves the assistant off and logs why, because the rest
     * of the app matters more than the assistant. The settings' errors name
     * no value, so the log never holds the key.
     */
    async load() {
      if (environment) {
        provider = build(environment);
        return;
      }
      try {
        provider = build(await settings.read());
      } catch (error) {
        logger.error("assistant settings unreadable", { error: error.message });
      }
    },

    /** @returns {Provider | undefined} */
    provider: () => provider,

    /**
     * The provider's name and where it comes from, or undefined while the
     * assistant is off.
     * @returns {{ provider: string, source: "environment" | "settings" } | undefined}
     */
    status() {
      if (provider === undefined) return undefined;
      return { provider: provider.name, source: environment ? "environment" : "settings" };
    },

    /** @returns {Promise<SettingsView>} */
    async read() {
      if (environment) return viewOf(environment, "environment");
      return viewOf(await settings.read(), "settings");
    },

    /**
     * The models that the provider lists for the key, newest first, for
     * `request` `{ provider, apiKey }`, or `{ provider }` to use the saved
     * key of that provider. Rejects with a ConflictError while the
     * environment sets the assistant up, with a ValidationError for an
     * invalid request, a missing key, or a key that the provider rejects,
     * and with an UpstreamError when the provider fails.
     * @param {unknown} request
     * @returns {Promise<Model[]>}
     */
    async models(request) {
      if (environment) throw new ConflictError(ON_SERVER);
      checkListRequest(request);
      const { provider: name, apiKey } = /** @type {any} */ (request);
      return listModels(name, apiKey ?? (await savedKeyOf(name)));
    },

    /**
     * Saves `changes` as the settings' `save` takes them, replaces the
     * provider, and resolves to what `read` answers. Unless the changes
     * remove the key, the provider's list for the resulting key must hold
     * the model first, and a save rejects as `models` does, or with a
     * ValidationError when the list doesn't hold the model. Rejects with a
     * ConflictError while the environment sets the assistant up.
     * @param {unknown} changes
     * @returns {Promise<SettingsView>}
     */
    async save(changes) {
      if (environment) throw new ConflictError(ON_SERVER);
      checkChanges(changes);
      const { provider: name, model, apiKey } = /** @type {any} */ (changes);
      if (apiKey !== null) {
        const models = await listModels(name, apiKey ?? (await savedKeyOf(name)));
        if (!models.some(({ id }) => id === model)) {
          throw new ValidationError("Choose a model from the list.");
        }
      }
      const saved = await settings.save(changes);
      // The queue resolves the saves in their order, so the last save wins
      // here too.
      provider = build(saved);
      logger.info("assistant settings changed", { provider: saved.provider, model: saved.model });
      return viewOf(saved, "settings");
    },
  };
}
