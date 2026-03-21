import { getNestedValue } from "../utils/object";
import { createProviderStrategy } from "./factory";

export const anthropicStrategy = createProviderStrategy({
  provider: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  requiresApiKey: true,
  modes: ["json_schema", "text"],
  validationPaths: ["/v1/models"],
  buildRequest: ({ mode, baseUrl, apiKey, model, messages, jsonSchema }) => {
    const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    // Separate system messages from user/assistant messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");
    const systemContent = systemMessages.map((m) => m.content).join("\n\n");

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages: conversationMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemContent) {
      body.system = systemContent;
    }

    if (mode === "json_schema") {
      // Use tool_use to force structured JSON output
      body.tools = [
        {
          name: "json_response",
          description: "Return structured JSON response matching the schema",
          input_schema: {
            type: "object",
            properties: jsonSchema.schema.properties,
            required: jsonSchema.schema.required,
            additionalProperties: jsonSchema.schema.additionalProperties,
          },
        },
      ];
      body.tool_choice = { type: "tool", name: "json_response" };
    }

    return { url, headers, body };
  },
  extractText: (response) => {
    const content = getNestedValue(response, ["content"]);
    if (!Array.isArray(content)) return null;

    for (const block of content) {
      const type = getNestedValue(block, ["type"]);

      // Tool use block — return JSON-stringified input
      if (type === "tool_use") {
        const input = getNestedValue(block, ["input"]);
        if (input && typeof input === "object") {
          try {
            return JSON.stringify(input);
          } catch {
            return null;
          }
        }
      }

      // Plain text block
      if (type === "text") {
        const text = getNestedValue(block, ["text"]);
        if (typeof text === "string") return text;
      }
    }

    return null;
  },
  getValidationUrls: ({ baseUrl, apiKey }) => {
    const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;
    // Anthropic uses x-api-key, not Bearer — validation URL encodes it as a query trick
    // We return the URL and let the custom header logic handle it in validateCredentials
    return apiKey ? [url] : [];
  },
});
