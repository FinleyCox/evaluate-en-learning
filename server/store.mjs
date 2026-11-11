import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./config.mjs";

const DIR = path.join(ROOT, "data", "sessions");
fs.mkdirSync(DIR, { recursive: true });

const file = (id) => path.join(DIR, `${id}.json`);

export function createSession(data) {
  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
  const session = { id, createdAt: Date.now(), turns: [], evaluation: null, trainer: null, stability: null, ...data };
  save(session);
  return session;
}

export function save(session) {
  session.updatedAt = Date.now();
  fs.writeFileSync(file(session.id), JSON.stringify(session, null, 2));
  return session;
}

export function load(id) {
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(file(id))) return null;
  return JSON.parse(fs.readFileSync(file(id), "utf8"));
}

export function listSessions() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))
    .sort((a, b) => b.createdAt - a.createdAt);
}
