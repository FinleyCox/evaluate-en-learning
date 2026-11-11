// 上達画面を触って確かめるためのデモデータを作る。
// 実際の練習ログではなく、画面確認とキックオフでの説明用。
import fs from "node:fs";
import path from "node:path";
import { ROOT, rubric, scenes } from "../server/config.mjs";
import { computeMetrics } from "../server/metrics.mjs";

const DIR = path.join(ROOT, "data", "sessions");
fs.mkdirSync(DIR, { recursive: true });
const DAY = 86400000;
const TEACHER = process.argv[2] || "Tristan（デモ）";

// 乱数を固定し、実行するたび同じデモデータになるようにする
let seed = 20261111;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const clamp = (n) => Math.max(1, Math.min(5, Math.round(n)));

const TALK = {
  lobby1: [["Hello... Good evening.", 0], ["Hi! How are you doing today?", 1], ["Ah... I am okay. Just... little tired.", 0], ["Oh, tired? What made you tired today?", 1], ["Work was very busy. Many meeting.", 0]],
  lobby2: [["Hi, nice to see you again.", 0], ["Good to see you too! How is the Osaka trip coming along?", 1], ["Ah! Yes, Osaka. Next month. I am excited.", 0], ["Who are you going to see?", 1], ["My favorite singer. I go with my friend.", 0]],
  lobby3: [["Hello. ...Not so good today.", 0], ["Oh no. What happened?", 1], ["Um... I have headache from morning.", 0], ["That sounds hard. Do you want to take it slowly today?", 1], ["Thank you... you are kind. A little better now.", 0]],
  lobby4: [["Hello! Today I am happy. I have good news.", 0], ["Good news? Tell me!", 1], ["I get concert ticket! Very difficult, but I win.", 0], ["That is amazing. Which artist is it?", 1], ["Ah, you know him? I like his old song best.", 0]],
  care1: [["Okay... I am ready.", 0], ["Why do you think teamwork is important?", 1], ["Umm... I think... maybe... because team is important?", 0], ["Take your time. What happens when a team works well?", 1], ["Ah... everyone help each other. Work is faster.", 0]],
  care3: [["Hmm... I want to say something, but difficult.", 0], ["What are you trying to say?", 1], ["気圧... what do you say in English?", 0], ["Good question. Can you describe it in other words?", 1], ["It is... air thing. When it change, my head is painful.", 0]],
};

/**
 * n日前の練習セッションを1件作る。progress は 0（初期）〜1（終盤）で上達を表す。
 * 直近の回（8日前以降）は音声モードで練習した想定にして、講師の発話秒数を実測値として持たせる。
 */
function makeSession(daysAgo, sceneId, progress, idx) {
  const voice = daysAgo <= 8;
  // その日の0時を基準に時刻を足す（now からの引き算だと時刻の繰り上がりで日がずれる）
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const base = Math.min(
    midnight.getTime() - daysAgo * DAY + (9 + Math.floor(rnd() * 9)) * 3600000,
    Date.now() - 300000
  );
  const turns = TALK[sceneId].map(([text, isTeacher], i) => {
    const t = { role: isTeacher ? "teacher" : "student", text, at: base + i * 25000 };
    if (isTeacher && voice) {
      // 上達するほど自分の話は短く切り上げる
      t.speechMs = Math.round(7000 - progress * 2500 + (rnd() - 0.5) * 2000);
    }
    if (!isTeacher && i > 0) {
      t.thinkingMs = 5000 + Math.floor(rnd() * 3000);
      t.apiLatencyMs = 900 + Math.floor(rnd() * 900);
      // 上達するほど割り込みが減る
      if (rnd() > 0.35 + progress * 0.5) t.interruptedAtMs = 1200 + Math.floor(rnd() * 1600);
    }
    return t;
  });

  const scene = scenes.find((s) => s.id === sceneId);
  const axes = rubric.axes.map((a) => {
    const applicable = a.scenes.includes(sceneId) || rnd() > 0.72;
    const score = clamp(2.1 + progress * 1.9 + (rnd() - 0.5) * 1.1);
    return {
      id: a.id, applicable, score,
      rationale: applicable
        ? `デモデータです。${a.behavior}について、会話ログから${score}と採点した想定の記録です。`
        : "この会話では該当する行動が現れませんでした。",
      evidence: applicable ? [{ speaker: "teacher", quote: turns.find((t) => t.role === "teacher").text, note: "採点の根拠とした発話（デモ）" }] : [],
    };
  });

  const session = {
    id: `${new Date(base).toISOString().slice(0, 10)}-seed${String(idx).padStart(2, "0")}`,
    createdAt: base, updatedAt: base,
    sceneId, teacherName: TEACHER, personaId: "hesitant-over-polite", seeded: true,
    turns,
    // 本番と同じ計算を通す（デモ用に手で書くと、画面と実装がずれる）
    metrics: computeMetrics(turns),
    evaluation: {
      mock: true, axes,
      counts: { directTranslation: Math.max(0, 2 - Math.round(progress * 2)), elicitationPrompts: Math.round(progress * 3), previousTopicFollowUps: sceneId === "lobby2" ? 1 : 0 },
      summary: {
        strengths: [`${scene.name}で、生徒の発言を受け止める応答ができていました（デモ）。`],
        improvements: ["沈黙を3〜5秒待ってから次の問いに移る（デモ）。"],
        nextPractice: "生徒が黙ったら、心の中で5つ数えてから口を開く（デモ）。",
      },
    },
    stability: null, trainer: null,
  };

  // 直近でない回の一部には、トレーナー採点も入れておく（κを計算できるように）
  if (rnd() > 0.45) {
    session.trainer = {
      scores: Object.fromEntries(axes.filter((a) => a.applicable).map((a) => [a.id, clamp(a.score + (rnd() - 0.5) * 1.6)])),
      personaFidelity: rnd() > 0.2, sceneOccurrence: rnd() > 0.12,
      usefulness: clamp(3.3 + rnd()), feedbackTrust: clamp(3.1 + rnd()),
      comment: "デモデータのトレーナー所見です。", ratedAt: base + 3600000,
    };
  }
  return session;
}

// 過去4週間、週3〜4回。終盤ほど上達している想定
const plan = [
  [27, "lobby1"], [25, "care1"], [22, "lobby3"],
  [20, "care1"], [18, "lobby4"], [15, "care3"],
  [13, "care1"], [11, "lobby2"], [8, "lobby3"],
  [6, "care1"], [3, "care3"], [2, "lobby2"], [1, "care1"], [0, "lobby4"],
];

for (const f of fs.readdirSync(DIR)) {
  if (f.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).seeded) {
    fs.unlinkSync(path.join(DIR, f));
  }
}
plan.forEach(([daysAgo, sceneId], i) => {
  const s = makeSession(daysAgo, sceneId, i / (plan.length - 1), i);
  fs.writeFileSync(path.join(DIR, `${s.id}.json`), JSON.stringify(s, null, 2));
});
console.log(`デモデータを ${plan.length} 件作りました（講師名: ${TEACHER}）`);
console.log(`消すときは data/sessions/*-seed*.json を削除してください。`);
