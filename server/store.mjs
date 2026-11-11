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
  // 一時ファイルに書いてから置き換える。書き込み中に落ちても壊れたJSONを残さない
  const tmp = `${file(session.id)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, file(session.id));
  return session;
}

export function load(id) {
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(file(id))) return null;
  try {
    return JSON.parse(fs.readFileSync(file(id), "utf8"));
  } catch (err) {
    console.error(`[store] 読めないセッションを飛ばしました: ${id}`, err.message);
    return null;
  }
}

export function listSessions() {
  const out = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));
    } catch (err) {
      // 壊れたファイルが1つあっても、残りのセッションは読めるようにする
      console.error(`[store] 読めないセッションを飛ばしました: ${f}`, err.message);
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
