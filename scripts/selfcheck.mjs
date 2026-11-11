// 依存ロジック（自動計測・重み付きκ・判定レポート）を、合成データで通しで検証する。
import assert from "node:assert/strict";
import { computeMetrics } from "../server/metrics.mjs";
import { weightedKappa, agreementDetail } from "../server/agreement.mjs";
import { buildReport } from "../server/report.mjs";
import { rubric } from "../server/config.mjs";

/* 1) 自動計測 */
const t0 = Date.now();
const turns = [
  { role: "student", text: "Hello... Not so good today.", at: t0 },
  { role: "teacher", text: "Oh no. What happened? Tell me about it.", at: t0 + 4000 },
  { role: "student", text: "Umm... work was very busy.", at: t0 + 11000, thinkingMs: 6000, apiLatencyMs: 1400 },
  { role: "teacher", text: "That sounds hard. Did you sleep well?", at: t0 + 13000 },
  { role: "student", text: "No... only five hour.", at: t0 + 20000, thinkingMs: 7000, interruptedAtMs: 2500, apiLatencyMs: 1700 },
];
const m = computeMetrics(turns);
assert.equal(m.turns.teacher, 2);
assert.equal(m.wait.windows, 2);
assert.equal(m.wait.interruptions, 1);
assert.equal(m.wait.minSeconds, 2.5);
assert.equal(m.wait.waitedFullRate, 0.5);
assert.ok(m.words.teacherRatio > 0.4 && m.words.teacherRatio < 0.8);
assert.equal(m.latency.avgSeconds, 1.55);
console.log("✓ 自動計測", JSON.stringify(m.wait));

/* 2) 重み付きκ */
assert.equal(weightedKappa([[1, 1], [3, 3], [5, 5], [2, 2]]).kappa, 1);
const mixed = weightedKappa([[4, 4], [3, 2], [5, 4], [2, 2], [1, 3], [4, 5]]);
assert.ok(mixed.kappa > 0 && mixed.kappa < 1);
assert.equal(weightedKappa([]).kappa, null);
assert.equal(weightedKappa([[3, 3], [3, 3]]).note.includes("参考値"), true);
const d = agreementDetail([[4, 4], [3, 2], [5, 4]]);
assert.equal(d.exact, 0.333);
assert.equal(d.within1, 1);
console.log("✓ 重み付きκ", mixed.kappa, JSON.stringify(d));

/* 3) 判定レポート */
const mkSession = (i, aiScores, trainerScores) => ({
  id: `s${i}`, sceneId: "lobby3", createdAt: i, turns,
  metrics: { ...m, latency: { avgSeconds: 1.5, maxSeconds: 2.0 } },
  evaluation: { axes: rubric.axes.map((a) => ({ id: a.id, applicable: true, score: aiScores[a.id], rationale: "", evidence: [] })),
    counts: {}, summary: { strengths: [], improvements: [], nextPractice: "" } },
  trainer: { scores: trainerScores, personaFidelity: true, sceneOccurrence: true, usefulness: 4, feedbackTrust: 4 },
  stability: { runs: 3, perAxis: [], maxDiff: 1 },
});
const ai1 = { awareness: 4, recall: 3, balance: 5, waitTime: 2, elicitation: 3 };
const tr1 = { awareness: 4, recall: 2, balance: 5, waitTime: 2, elicitation: 4 };
const ai2 = { awareness: 2, recall: 5, balance: 3, waitTime: 4, elicitation: 1 };
const tr2 = { awareness: 2, recall: 5, balance: 2, waitTime: 4, elicitation: 1 };
const report = buildReport([mkSession(1, ai1, tr1), mkSession(2, ai2, tr2)]);
assert.equal(report.ratedAxisPairs, 10);
assert.ok(report.agreement.kappa > 0.8);
const lat = report.studentAI.find((c) => c.id === "responseLatency");
assert.equal(lat.pass, true);
const agr = report.evaluatorAI.find((c) => c.id === "agreement");
assert.equal(agr.pass, true);
const stab = report.evaluatorAI.find((c) => c.id === "stability");
assert.equal(stab.value, 1);
assert.equal(stab.pass, true);
console.log("✓ 判定レポート κ=", report.agreement.kappa, "/", report.agreement.label);

console.log("\nすべて通りました。");
