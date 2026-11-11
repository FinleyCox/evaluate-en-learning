import { rubric, scenes } from "./config.mjs";
import { conversationSeconds } from "./metrics.mjs";

const DAY = 86400000;
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const round = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** 連続練習日数。今日まで（または昨日まで）途切れずに続いた日数を current とする。 */
function streaks(dayKeys) {
  const days = [...new Set(dayKeys)].sort();
  if (!days.length) return { current: 0, longest: 0, activeDays: 0, days: [] };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = (Date.parse(days[i]) - Date.parse(days[i - 1])) / DAY;
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - DAY);
  const last = days[days.length - 1];
  let current = 0;
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if ((Date.parse(days[i]) - Date.parse(days[i - 1])) / DAY === 1) current++;
      else break;
    }
  }
  return { current, longest, activeDays: days.length, days };
}

/** 1セッションの総合点＝採点対象になった軸の平均。 */
function sessionOverall(session) {
  const scored = (session.evaluation?.axes || []).filter((a) => a.applicable);
  return scored.length ? mean(scored.map((a) => a.score)) : null;
}

/**
 * 講師1人分の上達の度合いをまとめる。
 * スコアは評価AIの採点を使う（練習直後に出る唯一のスコアのため）。
 * トレーナー採点がある回は trainerOverall に併記し、ずれを見られるようにする。
 */
function weekGrid(sessions, weeks = 5) {
  const counts = new Map();
  for (const s of sessions) {
    const k = dayKey(s.createdAt);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  // 今週の月曜を起点に、過去 weeks 週ぶんを古い順で返す
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const today = dayKey(Date.now());
  const rows = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      // 固定の86400000msではなく暦で進める（月末・サマータイムでずれないように）
      const cell = new Date(monday);
      cell.setDate(cell.getDate() - w * 7 + d);
      const at = cell.getTime();
      const key = dayKey(at);
      const count = counts.get(key) || 0;
      row.push({
        date: key,
        at,
        count,
        level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3,
        isToday: key === today,
        isFuture: at > Date.now(),
      });
    }
    rows.push(row);
  }
  return { weeks, rows, labels: ["月", "火", "水", "木", "金", "土", "日"] };
}

export function buildProgress(allSessions, teacherName) {
  const mine = allSessions
    .filter((s) => s.teacherName === teacherName)
    .sort((a, b) => a.createdAt - b.createdAt);
  const evaluated = mine.filter((s) => s.evaluation);

  // 軸ごとの履歴
  const axes = rubric.axes.map((def) => {
    const history = [];
    for (const s of evaluated) {
      const a = s.evaluation.axes.find((x) => x.id === def.id);
      if (!a?.applicable) continue;
      history.push({
        sessionId: s.id, at: s.createdAt, sceneId: s.sceneId, score: a.score,
        trainerScore: s.trainer?.scores?.[def.id] ?? null,
      });
    }
    const vals = history.map((h) => h.score);
    const half = Math.ceil(vals.length / 2);
    return {
      id: def.id, name: def.name, behavior: def.behavior,
      attempts: vals.length,
      avg: round(mean(vals), 2),
      first: vals[0] ?? null,
      latest: vals[vals.length - 1] ?? null,
      // 前半と後半の平均差。1回しかなければ null
      delta: vals.length >= 2 ? round(mean(vals.slice(half)) - mean(vals.slice(0, half)), 2) : null,
      best: vals.length ? Math.max(...vals) : null,
      history,
    };
  });

  // 場面ごとの実施状況
  const sceneStats = scenes.map((sc) => {
    const done = mine.filter((s) => s.sceneId === sc.id);
    const scored = done.map(sessionOverall).filter((x) => x !== null);
    return {
      id: sc.id, name: sc.name, group: sc.group, primaryAxis: sc.primaryAxis,
      count: done.length,
      avg: round(mean(scored), 2),
      latest: scored.length ? round(scored[scored.length - 1], 2) : null,
      lastAt: done.length ? done[done.length - 1].createdAt : null,
    };
  });

  const overalls = evaluated.map(sessionOverall).filter((x) => x !== null);
  const recent = evaluated.slice(-10).reverse().map((s) => ({
    sessionId: s.id, at: s.createdAt, sceneId: s.sceneId,
    sceneName: scenes.find((x) => x.id === s.sceneId)?.name ?? s.sceneId,
    overall: round(sessionOverall(s), 2),
    trainerOverall: s.trainer?.scores
      ? round(mean(Object.values(s.trainer.scores)), 2)
      : null,
    scores: Object.fromEntries(
      s.evaluation.axes.filter((a) => a.applicable).map((a) => [a.id, a.score])
    ),
    interruptions: s.metrics?.wait?.interruptions ?? null,
    teacherRatio: s.metrics?.words?.teacherRatio ?? null,
  }));

  // 次に取り組むこと：未練習の場面があればそれ、なければ平均が最も低い軸の場面
  const untouched = sceneStats.find((s) => s.count === 0);
  const weakest = axes.filter((a) => a.attempts > 0).sort((a, b) => a.avg - b.avg)[0];
  const nextUp = untouched
    ? { type: "scene", sceneId: untouched.id, label: untouched.name, reason: "まだ練習していない場面です" }
    : weakest
      ? {
          type: "axis", axisId: weakest.id, label: weakest.name,
          sceneId: scenes.find((s) => s.primaryAxis === weakest.id)?.id ?? null,
          reason: `平均 ${weakest.avg} でいちばん伸びしろがあります`,
        }
      : null;

  return {
    teacher: teacherName,
    sessions: mine.length,
    evaluatedSessions: evaluated.length,
    firstAt: mine[0]?.createdAt ?? null,
    lastAt: mine[mine.length - 1]?.createdAt ?? null,
    overall: {
      avg: round(mean(overalls), 2),
      latest: overalls.length ? round(overalls[overalls.length - 1], 2) : null,
      best: overalls.length ? round(Math.max(...overalls), 2) : null,
      trend: overalls.map((v) => round(v, 2)),
    },
    practiceSeconds: Math.round(mine.reduce((a, s) => a + conversationSeconds(s.turns), 0)),
    streak: streaks(mine.map((s) => dayKey(s.createdAt))),
    week: weekGrid(mine),
    scenesCovered: sceneStats.filter((s) => s.count > 0).length,
    scenesTotal: scenes.length,
    scenes: sceneStats,
    axes,
    recent,
    nextUp,
  };
}

/** 講師の一覧（進捗画面の切り替え用）。 */
export function listTeachers(allSessions) {
  const map = new Map();
  for (const s of allSessions) {
    const cur = map.get(s.teacherName) || { name: s.teacherName, sessions: 0, lastAt: 0 };
    cur.sessions++;
    cur.lastAt = Math.max(cur.lastAt, s.createdAt);
    map.set(s.teacherName, cur);
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}
