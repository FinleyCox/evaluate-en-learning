import { rubric, persona, sceneById } from "./config.mjs";
import { askStructured } from "./claude.mjs";
import { metricsSummary } from "./metrics.mjs";

const obj = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });

/** 評価AIの出力スキーマ（構造化出力）。数値制約は enum で表現する。 */
const EVALUATION_SCHEMA = obj(
  {
    axes: {
      type: "array",
      items: obj(
        {
          id: { type: "string", enum: rubric.axes.map((a) => a.id) },
          applicable: { type: "boolean" },
          score: { type: "integer", enum: [1, 2, 3, 4, 5] },
          rationale: { type: "string" },
          evidence: {
            type: "array",
            items: obj(
              {
                speaker: { type: "string", enum: ["teacher", "student"] },
                quote: { type: "string" },
                note: { type: "string" },
              },
              ["speaker", "quote", "note"]
            ),
          },
        },
        ["id", "applicable", "score", "rationale", "evidence"]
      ),
    },
    counts: obj(
      {
        directTranslation: { type: "integer" },
        elicitationPrompts: { type: "integer" },
        previousTopicFollowUps: { type: "integer" },
      },
      ["directTranslation", "elicitationPrompts", "previousTopicFollowUps"]
    ),
    summary: obj(
      {
        strengths: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
        nextPractice: { type: "string" },
      },
      ["strengths", "improvements", "nextPractice"]
    ),
  },
  ["axes", "counts", "summary"]
);

function systemPrompt() {
  return [
    "あなたは英会話スクールの講師トレーナーです。講師（teacher）と生徒役AI（student）の会話ログを読み、",
    "与えられた評価軸にそって講師の対応を5段階で採点します。生徒役の英語の正しさは評価対象ではありません。",
    "",
    "採点の原則:",
    "- 各軸は、その軸の5段階の記述子に最も近いものを選ぶ。印象ではなく記述子で決める。",
    "- 必ず会話ログからの引用（原文のまま）を根拠として添える。引用を作ってはいけない。",
    "- その軸を判断できる行動がログに現れていない場合は applicable を false にし、score は 3 を入れる。",
    "- 自動計測の数値は、時間や比率に関する軸（考える時間の確保／生徒が主役の会話配分）で優先して使う。",
    "- 根拠・コメント・フィードバックはすべて日本語で書く。会話の引用のみ英語のままでよい。",
    "- フィードバックは講師本人が次の練習で試せる具体的な行動として書く。人格や資質に触れない。",
  ].join("\n");
}

function transcriptText(turns) {
  return turns
    .map((t, i) => {
      const who = t.role === "teacher" ? "講師" : "生徒";
      const extra =
        t.role === "student" && typeof t.thinkingMs === "number"
          ? typeof t.interruptedAtMs === "number"
            ? `（この発話の前に ${(t.thinkingMs / 1000).toFixed(1)} 秒の沈黙予定。講師は ${(t.interruptedAtMs / 1000).toFixed(1)} 秒で割り込んだ）`
            : `（この発話の前に ${(t.thinkingMs / 1000).toFixed(1)} 秒考えた。講師は最後まで待った）`
          : "";
      return `${i + 1}. ${who}: ${t.text}${extra}`;
    })
    .join("\n");
}

function userPrompt({ scene, turns, metrics }) {
  const axes = rubric.axes.map((a) => {
    const lines = Object.entries(a.descriptors).map(([k, v]) => `    ${k}: ${v}`).join("\n");
    return [
      `- id: ${a.id} / ${a.name}`,
      `  見る行動: ${a.behavior}`,
      `  採点の手がかり: ${a.cue}`,
      `  この軸が主対象の場面: ${a.scenes.join(", ")}${a.scenes.includes(scene.id) ? "  ← 今回の場面（必ず applicable: true で採点）" : ""}`,
      "  5段階の記述子:",
      lines,
    ].join("\n");
  });

  return [
    `## 練習した場面`,
    `${scene.name}（id: ${scene.id}）`,
    `想定課題: ${scene.issue}`,
    "",
    `## 生徒役のペルソナ`,
    `${persona.label} / ${persona.profile.englishLevel.value} / ${persona.profile.personality.value}`,
    `前回のレッスンで話した内容: ${persona.profile.lastLesson.value}`,
    "",
    `## 評価軸（全${rubric.axes.length}軸。今回の場面以外の軸も、該当する行動がログにあれば採点する）`,
    axes.join("\n"),
    "",
    `## 自動計測`,
    metricsSummary(metrics),
    "",
    `## 会話ログ`,
    transcriptText(turns),
    "",
    "## 出力",
    `${rubric.axes.length}軸すべてについて結果を返し、counts と summary も埋めること。`,
    "counts.directTranslation は講師が生徒の質問に即座に訳語を与えた回数、",
    "counts.elicitationPrompts はヒントや言い換えで生徒に言わせようとした回数、",
    "counts.previousTopicFollowUps は講師が前回の話題に自分から触れて掘り下げた回数。",
  ].join("\n");
}

/** MOCK モード：自動計測だけから機械的に採点する（APIキーなしでもUIが通しで動くように） */
function mockEvaluate({ scene, metrics }) {
  const pick = (cond, hi, lo) => (cond ? hi : lo);
  const base = {
    awareness: pick(metrics.teacherTurn.questionCount >= 2, 4, 2),
    recall: pick(metrics.recall.keywordsMentionedByTeacher.length > 0, 4, 2),
    balance: pick(metrics.words.teacherRatio <= 0.5, 4, 2),
    waitTime: pick(metrics.wait.interruptions === 0, 4, metrics.wait.minSeconds >= 3 ? 3 : 1),
    elicitation: pick(metrics.teacherTurn.questionCount >= 2, 3, 2),
  };
  return {
    mock: true,
    axes: rubric.axes.map((a) => ({
      id: a.id,
      applicable: a.scenes.includes(scene.id),
      score: base[a.id] ?? 3,
      rationale: "MOCK モード（ANTHROPIC_API_KEY 未設定）。自動計測の数値だけから機械的に採点しています。",
      evidence: [],
    })),
    counts: { directTranslation: 0, elicitationPrompts: 0, previousTopicFollowUps: metrics.recall.keywordsMentionedByTeacher.length },
    summary: {
      strengths: ["MOCK モードのため、実際の発話内容は評価していません。"],
      improvements: ["ANTHROPIC_API_KEY を設定すると、引用付きの評価が返ります。"],
      nextPractice: "—",
    },
  };
}

/** 会話ログ1本を評価する。 */
export async function evaluate({ sceneId, turns, metrics }) {
  const scene = sceneById(sceneId);
  try {
    const parsed = await askStructured({
      system: systemPrompt(),
      messages: [{ role: "user", content: userPrompt({ scene, turns, metrics }) }],
      schema: EVALUATION_SCHEMA,
      maxTokens: 8000,
      effort: "high",
    });
    if (parsed) {
      // 設定にない軸が返っても落とさないよう、rubric 側の順序に揃える
      const byId = new Map(parsed.axes.map((a) => [a.id, a]));
      return {
        mock: false,
        ...parsed,
        axes: rubric.axes.map(
          (a) => byId.get(a.id) || { id: a.id, applicable: false, score: 3, rationale: "モデルが返しませんでした。", evidence: [] }
        ),
      };
    }
  } catch (err) {
    console.error("[evaluator] LLM 呼び出し失敗、MOCK にフォールバック:", err.message);
  }
  return mockEvaluate({ scene, metrics });
}

/** 同じログを n 回採点し、軸ごとの最大差（採点の安定性）を測る。 */
export async function evaluateStability({ sceneId, turns, metrics, runs = 3 }) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(await evaluate({ sceneId, turns, metrics }));
  }
  const perAxis = rubric.axes.map((a) => {
    const scores = results.map((r) => r.axes.find((x) => x.id === a.id)?.score ?? 3);
    return { id: a.id, name: a.name, scores, maxDiff: Math.max(...scores) - Math.min(...scores) };
  });
  return {
    runs,
    perAxis,
    maxDiff: Math.max(...perAxis.map((p) => p.maxDiff)),
    results,
  };
}
