import Anthropic from "@anthropic-ai/sdk";
import { HAS_API_KEY, MODEL_ID } from "./config.mjs";

let client = null;
function getClient() {
  if (!HAS_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}


/**
 * テキスト応答を1件取得する。未設定・失敗時は null を返し、呼び出し側が
 * MOCK にフォールバックできるようにしている（PoC のデモを止めないため）。
 */
export async function askText({ system, messages, maxTokens = 1024, effort = "low", model = MODEL_ID }) {
  const c = getClient();
  if (!c) return null;
  const res = await c.messages.create({
    model,
    max_tokens: maxTokens,
    output_config: { effort },
    system,
    messages,
  });
  if (res.stop_reason === "refusal") return null;
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * 構造化出力（JSON Schema）を1件取得する。
 * スキーマに沿った JSON がそのまま返るため、採点結果のパースに失敗しない。
 */
export async function askStructured({ system, messages, schema, maxTokens = 8000, effort = "high" }) {
  const c = getClient();
  if (!c) return null;
  const { jsonSchemaOutputFormat } = await import("@anthropic-ai/sdk/helpers/json-schema");
  const res = await c.messages.parse({
    model: MODEL_ID,
    max_tokens: maxTokens,
    output_config: { effort, format: jsonSchemaOutputFormat(schema) },
    system,
    messages,
  });
  if (res.stop_reason === "refusal") return null;
  return res.parsed_output ?? null;
}
