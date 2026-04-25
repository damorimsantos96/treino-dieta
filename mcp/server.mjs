import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load OPENAI_API_KEY from parent .env.local if not already in environment
if (!process.env.OPENAI_API_KEY) {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^OPENAI_API_KEY=(.+)$/);
      if (match) {
        process.env.OPENAI_API_KEY = match[1].trim();
        break;
      }
    }
  } catch {
    // .env.local not found; rely on env var being set externally
  }
}

let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const server = new McpServer({
  name: "codex-review",
  version: "1.0.0",
});

server.tool(
  "codex_review",
  "Ask OpenAI to validate a plan, implementation, or code. Returns a second-opinion review.",
  {
    prompt: z.string().describe("Plan, code, or question to validate"),
    model: z
      .string()
      .optional()
      .default("o4-mini")
      .describe("OpenAI model to use (default: o4-mini)"),
    context: z
      .string()
      .optional()
      .describe("Extra context about the codebase or task"),
  },
  async ({ prompt, model, context }) => {
    const systemPrompt = [
      "You are a senior software engineer doing a second-opinion review.",
      "Be direct and concise. Flag risks, bugs, and better alternatives.",
      "If the plan/code looks good, say so briefly.",
      context ? `\nCodebase context:\n${context}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await getClient().chat.completions.create({
      model: model ?? "o4-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "(no response)";
    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
