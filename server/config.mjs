import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

// .env の読み込みは Node 標準（process.loadEnvFile）に任せる
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "config", name), "utf8"));

export const persona = read("persona.json");
export const scenes = read("scenes.json");
export const rubric = read("rubric.json");
export const criteria = read("criteria.json");

export const MODEL_ID = process.env.MODEL_ID || "claude-opus-5-5";
// 生徒役は対話のレイテンシが判定基準（平均2.0秒以内）に直結するため、別モデルを指定できる
export const STUDENT_MODEL_ID = process.env.STUDENT_MODEL_ID || MODEL_ID;
export const PORT = Number(process.env.PORT || 5173);
export const HAS_API_KEY = Boolean(
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
);

export const sceneById = (id) => scenes.find((s) => s.id === id);
