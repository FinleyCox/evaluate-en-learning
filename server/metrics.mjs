const WORDS_PER_SECOND = 2.5; // 英語の発話をテキストから秒数換算する係数（150 wpm 相当）
const ACKS = ["okay", "ok", "i see", "nice", "good", "great", "wow", "right", "sure", "cool", "uh huh", "mm hmm"];
const RECALL_KEYWORDS = ["osaka", "concert", "live", "singer", "idol", "ticket", "next month"];

const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * 会話ログから、人手を介さずに測れる指標だけを計算する。
 * 評価AIのスコアとは独立に出し、評価軸「考える時間の確保」「生徒が主役の会話配分」の
 * しきい値合わせに使う（提案スライド p.2 注記）。
 */
export function computeMetrics(turns) {
  const teacher = turns.filter((t) => t.role === "teacher");
  const student = turns.filter((t) => t.role === "student");

  const tWords = teacher.reduce((a, t) => a + words(t.text), 0);
  const sWords = student.reduce((a, t) => a + words(t.text), 0);
  const total = tWords + sWords;

  const turnSeconds = teacher.map((t) => words(t.text) / WORDS_PER_SECOND);

  // 沈黙を待てたか：生徒役の「考え中」ウィンドウごとに、講師が割り込んだ時点を見る
  const windows = student.filter((t) => typeof t.thinkingMs === "number");
  const waits = windows.map((t) =>
    typeof t.interruptedAtMs === "number" ? t.interruptedAtMs / 1000 : t.thinkingMs / 1000
  );
  const interruptions = windows.filter((t) => typeof t.interruptedAtMs === "number").length;

  const latencies = student
    .filter((t) => typeof t.apiLatencyMs === "number")
    .map((t) => t.apiLatencyMs / 1000);

  const ackCount = teacher.filter((t) => {
    const c = t.text.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    return words(c) <= 3 && ACKS.some((a) => c === a || c.startsWith(a + " "));
  }).length;

  const teacherAll = teacher.map((t) => t.text.toLowerCase()).join(" ");
  const recallHits = RECALL_KEYWORDS.filter((k) => teacherAll.includes(k));

  const at = turns.map((t) => t.at).filter(Boolean);

  return {
    turns: { teacher: teacher.length, student: student.length },
    words: {
      teacher: tWords,
      student: sWords,
      teacherRatio: total ? round(tWords / total) : 0,
    },
    teacherTurn: {
      maxSeconds: turnSeconds.length ? round(Math.max(...turnSeconds), 1) : 0,
      avgSeconds: turnSeconds.length ? round(turnSeconds.reduce((a, b) => a + b, 0) / turnSeconds.length, 1) : 0,
      questionCount: teacher.filter((t) => t.text.includes("?")).length,
      shortAckCount: ackCount,
    },
    wait: {
      windows: windows.length,
      interruptions,
      minSeconds: waits.length ? round(Math.min(...waits), 1) : null,
      avgSeconds: waits.length ? round(waits.reduce((a, b) => a + b, 0) / waits.length, 1) : null,
      waitedFullRate: windows.length ? round((windows.length - interruptions) / windows.length) : null,
    },
    latency: {
      avgSeconds: latencies.length ? round(latencies.reduce((a, b) => a + b, 0) / latencies.length, 2) : null,
      maxSeconds: latencies.length ? round(Math.max(...latencies), 2) : null,
    },
    recall: { keywordsMentionedByTeacher: recallHits },
    durationSeconds: at.length > 1 ? round((Math.max(...at) - Math.min(...at)) / 1000, 1) : 0,
  };
}

/** 評価AIのプロンプトに差し込む、自動計測の要約行。 */
export function metricsSummary(m) {
  return [
    `講師の発話量の比率: ${(m.words.teacherRatio * 100).toFixed(0)}%（講師${m.words.teacher}語 / 生徒${m.words.student}語）`,
    `講師の1回の連続発話: 最長${m.teacherTurn.maxSeconds}秒 / 平均${m.teacherTurn.avgSeconds}秒（1語0.4秒換算）`,
    `講師の質問数: ${m.teacherTurn.questionCount}回、単語だけの相づち: ${m.teacherTurn.shortAckCount}回`,
    `生徒の沈黙(考え中)ウィンドウ: ${m.wait.windows}回、講師の割り込み: ${m.wait.interruptions}回、` +
      `講師が沈黙を破るまで 最短${m.wait.minSeconds ?? "-"}秒 / 平均${m.wait.avgSeconds ?? "-"}秒`,
    `講師が前回の話題キーワードに触れた: ${m.recall.keywordsMentionedByTeacher.length ? m.recall.keywordsMentionedByTeacher.join(", ") : "なし"}`,
  ].join("\n");
}
