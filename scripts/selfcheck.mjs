// 依存ロジック（自動計測・重み付きκ・判定レポート）を、合成データで通しで検証する。
import assert from "node:assert/strict";
import { computeMetrics, conversationSeconds } from "../server/metrics.mjs";
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
assert.equal(conversationSeconds(turns), 20);
assert.equal(conversationSeconds([{ at: 1 }]), 0, "発話1件では所要時間は0");
assert.equal(m.durationSeconds, 20);
// MOCK の応答（即時）は「応答時間 平均2秒以内」の母数に入れない
const mockMetrics = computeMetrics([
  { role: "teacher", text: "Hi", at: t0 },
  { role: "student", text: "Hello", at: t0 + 1000, thinkingMs: 5000, apiLatencyMs: 0, mock: true },
]);
assert.equal(mockMetrics.latency.avgSeconds, null, "MOCKだけなら応答時間は未測定");
console.log("✓ 自動計測", JSON.stringify(m.wait));

/* 2) 重み付きκ */
assert.equal(weightedKappa([[1, 1], [3, 3], [5, 5], [2, 2]]).kappa, 1);
const mixed = weightedKappa([[4, 4], [3, 2], [5, 4], [2, 2], [1, 3], [4, 5]]);
assert.ok(mixed.kappa > 0 && mixed.kappa < 1);
assert.equal(weightedKappa([]).kappa, null);
assert.equal(weightedKappa([[3, 3], [3, 3]]).note.includes("参考値"), true);
// 一次重みは二次重みより、離れたズレを重く見るので κ は低く出る
const quad = weightedKappa([[5, 3], [1, 2], [4, 4], [2, 2], [3, 5]], "quadratic").kappa;
const lin = weightedKappa([[5, 3], [1, 2], [4, 4], [2, 2], [3, 5]], "linear").kappa;
assert.ok(lin < quad, `linear(${lin}) < quadratic(${quad})`);
const detail = agreementDetail([[4, 4], [3, 2], [5, 4]]);
assert.equal(detail.exact, 0.333);
assert.equal(detail.within1, 1);
console.log("✓ 重み付きκ 二次", mixed.kappa, "/ 一次", lin,  JSON.stringify(detail));

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


/* 4) 上達（講師ごとの進捗集計） */
import { buildProgress, listTeachers } from "../server/progress.mjs";
const DAY2 = 86400000;
const mkPractice = (daysAgo, sceneId, scores, trainer) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const at = d.getTime() - daysAgo * DAY2 + 10 * 3600000;
  return {
    id: `p${daysAgo}`, createdAt: at, teacherName: "T", sceneId,
    turns: [{ role: "teacher", text: "Hi there", at }, { role: "student", text: "Hello", at: at + 60000 }],
    evaluation: { axes: rubric.axes.map((a) => ({ id: a.id, applicable: Boolean(scores[a.id]), score: scores[a.id] ?? 3, rationale: "", evidence: [] })), counts: {}, summary: {} },
    trainer: trainer ? { scores: trainer } : null,
  };
};
// 3日前・2日前・今日 → 今日まで途切れていないのは 2日前と今日ではなく、昨日が抜けるので current=1
const sessions = [
  mkPractice(3, "lobby3", { awareness: 2 }),
  mkPractice(2, "lobby3", { awareness: 3 }),
  mkPractice(0, "care1", { waitTime: 5 }, { waitTime: 4 }),
];
const prog = buildProgress(sessions, "T");
assert.equal(prog.sessions, 3);
assert.equal(prog.streak.current, 1, "昨日が抜けているので連続は今日の1日だけ");
assert.equal(prog.streak.activeDays, 3);
assert.equal(prog.scenesCovered, 2);
assert.equal(prog.week.rows.length, 5);
assert.equal(prog.week.rows[0].length, 7);
assert.equal(prog.week.rows.flat().filter((c) => c.isToday).length, 1, "今日は週グリッドに1つだけ");
assert.equal(prog.week.rows.flat().reduce((a, c) => a + c.count, 0), 3, "5週間の合計が練習回数と一致");
const aw = prog.axes.find((a) => a.id === "awareness");
assert.equal(aw.attempts, 2);
assert.equal(aw.first, 2);
assert.equal(aw.latest, 3);
assert.equal(aw.delta, 1, "前半2点→後半3点で +1");
assert.equal(prog.axes.find((a) => a.id === "recall").attempts, 0);
assert.equal(prog.nextUp.type, "scene", "未練習の場面があればそれを次に出す");
assert.ok(prog.practiceSeconds >= 180, "1セッション60秒 x 3");
assert.equal(prog.recent[0].sessionId, "p0", "直近が先頭");
assert.equal(prog.recent[0].trainerOverall, 4);
assert.equal(listTeachers(sessions).length, 1);
console.log("✓ 上達 連続", prog.streak.current, "日 / 制覇", prog.scenesCovered + "/" + prog.scenesTotal, "/ 気づきの伸び", aw.delta);


/* 5) セッション単位の直列化 */
import { withSessionLock, pendingLocks } from "../server/lock.mjs";
{
  const order = [];
  let shared = 0;
  // 「読み込む → await → 書き出す」をわざと書く。直列化が効いていなければ更新が消える
  const task = (name, delay) =>
    withSessionLock("s1", async () => {
      const seen = shared;                                   // 読み込む
      await new Promise((r) => setTimeout(r, delay));         // 途中で待つ
      // eslint-disable-next-line require-atomic-updates
      shared = seen + 1;                                      // 書き出す
      order.push(name);
    });
  // 遅い処理を先に出しても、後の処理は割り込まない
  await Promise.all([task("a", 30), task("b", 1), task("c", 1)]);
  assert.deepEqual(order, ["a", "b", "c"], "要求された順に直列で動く");
  assert.equal(shared, 3, "途中の await をまたいでも更新が消えない");

  // 別セッションは待たされない
  const start = Date.now();
  await Promise.all([
    withSessionLock("x", () => new Promise((r) => setTimeout(r, 40))),
    withSessionLock("y", () => new Promise((r) => setTimeout(r, 40))),
  ]);
  assert.ok(Date.now() - start < 75, "別セッションは並行して動く");

  // 失敗しても後続が止まらない
  await withSessionLock("s2", () => Promise.reject(new Error("boom"))).catch(() => {});
  await withSessionLock("s2", async () => order.push("after-error"));
  assert.equal(order.at(-1), "after-error", "前の処理が失敗しても次が動く");

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pendingLocks(), 0, "終わったセッションの鍵は残さない");
  console.log("✓ 直列化", order.join(" → "));
}

console.log("\nすべて通りました。");
