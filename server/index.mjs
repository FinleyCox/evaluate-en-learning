import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, PORT, MODEL_ID, STUDENT_MODEL_ID, HAS_API_KEY, scenes, persona, rubric, criteria, sceneById } from "./config.mjs";
import { studentTurn } from "./student.mjs";
import { computeMetrics } from "./metrics.mjs";
import { evaluate, evaluateStability } from "./evaluator.mjs";
import { buildReport } from "./report.mjs";
import { buildProgress, listTeachers } from "./progress.mjs";
import * as store from "./store.mjs";
import { withSessionLock } from "./lock.mjs";

const PUBLIC = path.join(ROOT, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

function serveStatic(req, res) {
  const rel = req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (!p.startsWith("/api/")) return serveStatic(req, res);

    if (p === "/api/config" && req.method === "GET") {
      return json(res, 200, {
        scenes, persona, rubric, criteria,
        mode: HAS_API_KEY ? "live" : "mock",
        model: HAS_API_KEY ? MODEL_ID : null,
        studentModel: HAS_API_KEY ? STUDENT_MODEL_ID : null,
      });
    }

    if (p === "/api/sessions" && req.method === "GET") {
      return json(res, 200, store.listSessions().map((s) => ({
        id: s.id, sceneId: s.sceneId, createdAt: s.createdAt,
        teacherName: s.teacherName, turns: s.turns.length,
        evaluated: Boolean(s.evaluation), trainerRated: Boolean(s.trainer?.scores),
        stability: s.stability?.maxDiff ?? null,
      })));
    }

    if (p === "/api/teachers" && req.method === "GET") {
      return json(res, 200, listTeachers(store.listSessions()));
    }

    if (p === "/api/progress" && req.method === "GET") {
      const all = store.listSessions();
      const name = url.searchParams.get("teacher") || listTeachers(all)[0]?.name;
      if (!name) return json(res, 200, null);
      return json(res, 200, buildProgress(all, name));
    }

    if (p === "/api/report" && req.method === "GET") {
      return json(res, 200, buildReport(store.listSessions()));
    }

    if (p === "/api/sessions" && req.method === "POST") {
      const body = await readBody(req);
      const scene = sceneById(body.sceneId);
      if (!scene) return json(res, 400, { error: "unknown sceneId" });
      const session = store.createSession({
        sceneId: scene.id,
        teacherName: (body.teacherName || "").slice(0, 40) || "（未入力）",
        personaId: persona.id,
      });
      const opening = { role: "student", text: scene.opening, at: Date.now() };
      session.turns.push(opening);
      store.save(session);
      return json(res, 200, { session, scene });
    }

    const turnMatch = p.match(/^\/api\/sessions\/([\w-]+)\/turn$/);
    if (turnMatch && req.method === "POST") {
      const body = await readBody(req);
      const text = (body.text || "").trim();
      if (!text) return json(res, 400, { error: "empty text" });

      const result = await withSessionLock(turnMatch[1], async () => {
        const session = store.load(turnMatch[1]);
        if (!session) return { code: 404, body: { error: "session not found" } };

        // 直前の「沈黙のあった生徒ターン」に、講師が割り込むまでの時間を記録する
        if (typeof body.interruptedAtMs === "number") {
          const last = [...session.turns]
            .reverse()
            .find((t) => t.role === "student" && typeof t.thinkingMs === "number");
          if (last && last.interruptedAtMs === undefined) last.interruptedAtMs = body.interruptedAtMs;
        }

        session.turns.push({ role: "teacher", text, at: Date.now() });
        // 生徒役の生成に失敗しても講師の発話が消えないよう、先に保存する
        store.save(session);

        const history = session.turns.slice(0, -1).map((t) => ({ role: t.role, text: t.text }));
        const reply = await studentTurn({ sceneId: session.sceneId, history, teacherText: text });
        const studentRecord = {
          role: "student", text: reply.text, at: Date.now(),
          thinkingMs: reply.thinkingMs, apiLatencyMs: reply.apiLatencyMs, mock: reply.mock,
        };
        session.turns.push(studentRecord);
        store.save(session);
        return { code: 200, body: { turn: studentRecord } };
      });
      return json(res, result.code, result.body);
    }

    const evalMatch = p.match(/^\/api\/sessions\/([\w-]+)\/evaluate$/);
    if (evalMatch && req.method === "POST") {
      const body = await readBody(req);
      const result = await withSessionLock(evalMatch[1], async () => {
      const session = store.load(evalMatch[1]);
      if (!session) return { code: 404, body: { error: "session not found" } };
      session.metrics = computeMetrics(session.turns);

      if (body.stability) {
        const st = await evaluateStability({
          sceneId: session.sceneId, turns: session.turns, metrics: session.metrics, runs: 3,
        });
        session.evaluation = st.results[0];
        session.stability = { runs: st.runs, perAxis: st.perAxis, maxDiff: st.maxDiff };
      } else {
        session.evaluation = await evaluate({
          sceneId: session.sceneId, turns: session.turns, metrics: session.metrics,
        });
      }
      store.save(session);
      return { code: 200, body: { metrics: session.metrics, evaluation: session.evaluation, stability: session.stability } };
      });
      return json(res, result.code, result.body);
    }

    const trainerMatch = p.match(/^\/api\/sessions\/([\w-]+)\/trainer$/);
    if (trainerMatch && req.method === "POST") {
      const body = await readBody(req);
      const saved = await withSessionLock(trainerMatch[1], async () => {
      const session = store.load(trainerMatch[1]);
      if (!session) return null;
      session.trainer = {
        scores: body.scores || {},
        personaFidelity: Boolean(body.personaFidelity),
        sceneOccurrence: Boolean(body.sceneOccurrence),
        usefulness: Number(body.usefulness) || null,
        feedbackTrust: Number(body.feedbackTrust) || null,
        comment: (body.comment || "").slice(0, 2000),
        ratedAt: Date.now(),
      };
      store.save(session);
      return session.trainer;
      });
      if (!saved) return json(res, 404, { error: "session not found" });
      return json(res, 200, { trainer: saved, report: buildReport(store.listSessions()) });
    }

    const getMatch = p.match(/^\/api\/sessions\/([\w-]+)$/);
    if (getMatch && req.method === "GET") {
      const session = store.load(getMatch[1]);
      if (!session) return json(res, 404, { error: "session not found" });
      return json(res, 200, session);
    }

    return json(res, 404, { error: "unknown endpoint" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  生徒ケアAIトレーナー PoC`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  モード: ${HAS_API_KEY ? `live (${MODEL_ID})` : "mock（ANTHROPIC_API_KEY 未設定）"}\n`);
});
