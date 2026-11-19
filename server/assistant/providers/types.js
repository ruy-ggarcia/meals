// The common shape of a provider and of a conversation, which every provider
// adapter translates to and from its API. The module holds only types.

/**
 * A file of a user message, with `data` in base64.
 * @typedef {{ name: string, mediaType: string, data: string }} Attachment
 */

/**
 * A call of a tool. `input` holds the parsed arguments, or null when they
 * aren't a JSON object.
 * @typedef {{ id: string, name: string, input: any }} ToolCall
 */

/**
 * A message of a conversation, in the shape that every adapter translates.
 * `output` of a tool result is a JSON string.
 * @typedef {{ role: "user", text: string, attachments: Attachment[] }
 *   | { role: "assistant", text: string, toolCalls: ToolCall[] }
 *   | { role: "tool", results: { id: string, name: string, output: string, isError: boolean }[] }} Message
 */

/**
 * A tool that the model can call, with `parameters` a JSON Schema object.
 * @typedef {{ name: string, description: string, parameters: any }} Tool
 */

/**
 * One answer of the model.
 * @typedef {{ text: string, toolCalls: ToolCall[], usage: { inputTokens: number, outputTokens: number } }} Answer
 */

/**
 * A model in a provider's list, with the name to show for it.
 * @typedef {{ id: string, name: string }} Model
 */

/**
 * A language model behind a provider's API.
 * @typedef {object} Provider
 * @property {"anthropic" | "openai"} name
 * @property {string} model
 * @property {(request: { system: string, messages: Message[], tools: Tool[], signal?: AbortSignal }) => Promise<Answer>} complete
 */

export {};
