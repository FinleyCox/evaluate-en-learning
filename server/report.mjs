import { criteria, rubric } from "./config.mjs";
import { weightedKappa, agreementDetail, interpret } from "./agreement.mjs";

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** 蓄積したセッションを、PoCの判定基準（提案スライド p.4）に突き合わせる。 */
export function buildReport(sessions) {
  const scored = sessions.filter((s) => s.evaluation && s.trainer?.scores);

  const pairs = [];
  const perAxisPairs = Object.fromEntries(rubric.axes.map((a) => [a.id, []]));
  for (const s of scored) {
    for (const axis of s.evaluation.axes) {
      if (!axis.applicable) continue;
      const t = s.trainer.scores[axis.id];
      if (typeof t !== "number") continue;
      pairs.push([axis.score, t]);
      perAxisPairs[axis.id].push([axis.score, t]);
    }
  }

  const overall = weightedKappa(pairs);
  const detail = agreementDetail(pairs);

  const stabilityDiffs = sessions.filter((s) => s.stability).map((s) => s.stability.maxDiff);
  const latencies = sessions.map((s) => s.metrics?.latency?.avgSeconds).filter((x) => typeof x === "number");
  const persona = sessions.map((s) => s.trainer?.personaFidelity).filter((x) => typeof x === "boolean");
  const occurrence = sessions.map((s) => s.trainer?.sceneOccurrence).filter((x) => typeof x === "boolean");
  const usefulness = sessions.map((s) => s.trainer?.usefulness).filter((x) => typeof x === "number");
  const trust = sessions.map((s) => s.trainer?.feedbackTrust).filter((x) => typeof x === "number");

  const measured = {
    personaFidelity: persona.length ? mean(persona.map(Number)) : null,
    sceneOccurrence: occurrence.length ? mean(occurrence.map(Number)) : null,
    responseLatency: latencies.length ? mean(latencies) : null,
    usefulness: mean(usefulness),
    agreement: overall.kappa,
    stability: stabilityDiffs.length ? Math.max(...stabilityDiffs) : null,
    feedbackTrust: mean(trust),
  };

  const judge = (c) => {
    const v = measured[c.id];
    if (v === null || v === undefined) return { ...c, value: null, pass: null, n: 0 };
    const pass =
      c.unit === "secondsMax" || c.unit === "maxDiffOf3" ? v <= c.target : v >= c.target;
    return { ...c, value: round(v, c.unit === "ratio" ? 2 : 2), pass };
  };

  return {
    sessions: sessions.length,
    scoredSessions: scored.length,
    ratedAxisPairs: pairs.length,
    agreement: {
      kappa: overall.kappa,
      note: overall.note,
      label: interpret(overall.kappa),
      ...detail,
      perAxis: rubric.axes.map((a) => {
        const k = weightedKappa(perAxisPairs[a.id]);
        return { id: a.id, name: a.name, n: k.n, kappa: k.kappa, note: k.note, label: interpret(k.kappa) };
      }),
    },
    studentAI: criteria.studentAI.map(judge),
    evaluatorAI: criteria.evaluatorAI.map(judge),
  };
}
