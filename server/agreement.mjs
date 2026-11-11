const K = 5; // 5段階

/**
 * 重み付きκ（Cohen's weighted kappa）。
 * 偶然の一致を除いた一致度で、提案スライド p.4 の基準は 0.61 以上
 * （Landis & Koch 1977 の "substantial agreement"）。
 * @param {Array<[number,number]>} pairs [AIのスコア, トレーナーのスコア] の配列
 * @param {"quadratic"|"linear"} weights
 */
export function weightedKappa(pairs, weights = "quadratic") {
  const n = pairs.length;
  if (n === 0) return { kappa: null, n: 0, note: "採点ペアがありません" };

  const O = Array.from({ length: K }, () => new Array(K).fill(0));
  const rowSum = new Array(K).fill(0);
  const colSum = new Array(K).fill(0);
  for (const [a, b] of pairs) {
    const i = Math.min(K, Math.max(1, Math.round(a))) - 1;
    const j = Math.min(K, Math.max(1, Math.round(b))) - 1;
    O[i][j] += 1;
    rowSum[i] += 1;
    colSum[j] += 1;
  }

  const w = (i, j) =>
    weights === "linear" ? Math.abs(i - j) / (K - 1) : (i - j) ** 2 / (K - 1) ** 2;

  let num = 0;
  let den = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const E = (rowSum[i] * colSum[j]) / n;
      num += w(i, j) * O[i][j];
      den += w(i, j) * E;
    }
  }
  if (den === 0) {
    const allAgree = pairs.every(([a, b]) => Math.round(a) === Math.round(b));
    return {
      kappa: allAgree ? 1 : null,
      n,
      note: allAgree
        ? "両者のスコアが一点に集中して完全一致。κの分母が0のため参考値"
        : "κの分母が0（スコアの分散がない）。評価対象のばらつきが必要",
    };
  }
  return { kappa: round(1 - num / den), n, note: null };
}

export function agreementDetail(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, exact: null, within1: null, meanDiff: null, aiBias: null };
  const exact = pairs.filter(([a, b]) => a === b).length / n;
  const within1 = pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length / n;
  const diffs = pairs.map(([a, b]) => a - b);
  return {
    n,
    exact: round(exact),
    within1: round(within1),
    meanAbsDiff: round(diffs.reduce((s, d) => s + Math.abs(d), 0) / n),
    aiBias: round(diffs.reduce((s, d) => s + d, 0) / n), // 正ならAIが甘い
  };
}

export function interpret(kappa) {
  if (kappa === null) return "—";
  if (kappa < 0.21) return "わずかな一致 (slight)";
  if (kappa < 0.41) return "ある程度の一致 (fair)";
  if (kappa < 0.61) return "中程度の一致 (moderate)";
  if (kappa < 0.81) return "かなりの一致 (substantial)";
  return "ほぼ完全な一致 (almost perfect)";
}

const round = (n) => Math.round(n * 1000) / 1000;
