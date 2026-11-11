"use strict";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const api = async (url, opts) => {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
};

const S = {
  config: null,
  session: null,
  thinking: null, // { start, timer, tick, node }
  sending: false, // 送信中フラグ。連打でターンが消えるのを防ぐ
  progress: null,
};

/* ---------- 起動 ---------- */
(async function init() {
  S.config = await api("/api/config");
  const pill = $("mode-pill");
  pill.textContent = S.config.mode === "live" ? `live / ${S.config.model}` : "mock（APIキー未設定）";
  pill.classList.add(S.config.mode);

  const sel = $("scene-select");
  for (const sc of S.config.scenes) sel.appendChild(new Option(`${sc.group}｜${sc.name}`, sc.id));
  sel.onchange = renderSceneDesc;
  renderSceneDesc();

  for (const id of ["t-useful", "t-trust"]) {
    const s = $(id);
    s.appendChild(new Option("—", ""));
    for (let i = S.config.rubric.scale; i >= 1; i--) s.appendChild(new Option(`${i}`, String(i)));
    s.value = "4";
  }

  renderSpec();
  await refreshSessions();
  await loadReport();
  await loadProgress();
})();

document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $(t.dataset.tab).classList.add("active");
    if (t.dataset.tab === "report") loadReport();
    if (t.dataset.tab === "progress") loadProgress();
  };
});
const goTab = (name) => document.querySelector(`.tab[data-tab="${name}"]`).click();

function renderSceneDesc() {
  const sc = S.config.scenes.find((x) => x.id === $("scene-select").value);
  $("scene-desc").innerHTML =
    `<b>想定課題</b>：${esc(sc.issue)}<br><b>生徒役の設定</b>：${esc(sc.studentSetup)}`;
}

/* ---------- 1. 練習 ---------- */
$("start-btn").onclick = async () => {
  const sceneId = $("scene-select").value;
  const { session, scene } = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ sceneId, teacherName: $("teacher-name").value }),
  });
  S.session = session;
  $("setup").classList.add("hidden");
  $("chatwrap").classList.remove("hidden");
  $("chat-scene").textContent = scene.name;
  $("chat-persona").textContent = `　生徒役: ${S.config.persona.name}（${S.config.persona.profile.englishLevel.value}）`;
  $("chat").innerHTML = "";
  for (const t of session.turns) addBubble(t.role, t.text);
  $("input").focus();
};

function addBubble(role, text) {
  const b = el("div", `bubble ${role}`);
  b.appendChild(el("span", "who", role === "teacher" ? "講師" : S.config.persona.name));
  b.appendChild(document.createTextNode(text));
  $("chat").appendChild(b);
  $("chat").scrollTop = $("chat").scrollHeight;
  return b;
}
function addNotice(text) {
  $("chat").appendChild(el("div", "notice", esc(text)));
  $("chat").scrollTop = $("chat").scrollHeight;
}

function startThinking(ms, onDone) {
  const node = el("div", "thinking");
  node.innerHTML = `<span>${esc(S.config.persona.name)} は考えています</span><span class="dots"><span>●</span><span>●</span><span>●</span></span><b class="t">0.0秒</b>`;
  $("chat").appendChild(node);
  $("chat").scrollTop = $("chat").scrollHeight;
  const start = Date.now();
  const tick = setInterval(() => {
    node.querySelector(".t").textContent = ((Date.now() - start) / 1000).toFixed(1) + "秒";
  }, 100);
  const timer = setTimeout(() => finishThinking(), ms);
  S.thinking = { start, timer, tick, node, onDone };
}
function finishThinking() {
  if (!S.thinking) return 0;
  const { start, timer, tick, node, onDone } = S.thinking;
  clearTimeout(timer);
  clearInterval(tick);
  node.remove();
  S.thinking = null;
  const waited = Date.now() - start;
  onDone();
  return waited;
}

function speak(text) {
  if (!$("tts-toggle").checked || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

async function send() {
  const input = $("input");
  const text = input.value.trim();
  if (!text || !S.session || S.sending) return;
  S.sending = true;

  let interruptedAtMs = null;
  if (S.thinking) {
    interruptedAtMs = finishThinking();
    addNotice(`沈黙中に割り込みました（${(interruptedAtMs / 1000).toFixed(1)}秒）`);
  }

  input.value = "";
  $("send-btn").disabled = true;
  addBubble("teacher", text);

  try {
    const { turn } = await api(`/api/sessions/${S.session.id}/turn`, {
      method: "POST",
      body: JSON.stringify({ text, interruptedAtMs }),
    });
    startThinking(turn.thinkingMs, () => {
      addBubble("student", turn.text);
      speak(turn.text);
    });
  } catch (err) {
    addNotice(`エラー: ${err.message}`);
  } finally {
    S.sending = false;
    $("send-btn").disabled = false;
    input.focus();
  }
}

$("send-btn").onclick = send;
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// 音声入力（対応ブラウザのみ）
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $("mic-btn").style.display = "none";
else {
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  let on = false;
  rec.onresult = (e) => {
    $("input").value = ($("input").value + " " + e.results[0][0].transcript).trim();
  };
  rec.onend = () => { on = false; $("mic-btn").textContent = "🎤"; };
  $("mic-btn").onclick = () => {
    if (on) return rec.stop();
    on = true;
    $("mic-btn").textContent = "⏹";
    rec.start();
  };
}

$("finish-btn").onclick = async () => {
  if (S.thinking) finishThinking();
  await openSession(S.session.id);
  goTab("review");
};

/* ---------- 2. 評価・採点 ---------- */
async function refreshSessions() {
  const list = await api("/api/sessions");
  const sel = $("session-picker");
  const keep = sel.value;
  sel.innerHTML = "";
  for (const s of list) {
    const sc = S.config.scenes.find((x) => x.id === s.sceneId);
    sel.appendChild(new Option(
      `${s.id}｜${sc ? sc.name : s.sceneId}｜${s.teacherName}｜${s.turns}ターン${s.trainerRated ? "｜採点済" : ""}`,
      s.id
    ));
  }
  if (keep && list.some((s) => s.id === keep)) sel.value = keep;
  return list;
}
$("load-session").onclick = () => $("session-picker").value && openSession($("session-picker").value);

async function openSession(id) {
  const s = await api(`/api/sessions/${id}`);
  S.session = s;
  $("review-hint").classList.add("hidden");
  $("review-body").classList.remove("hidden");
  renderTranscript(s);
  renderMetrics(s.metrics);
  if (s.evaluation) renderEvaluation(s.evaluation, s.stability);
  else {
    $("eval-card").classList.add("hidden");
    $("trainer-card").classList.add("hidden");
  }
  await refreshSessions();
}

/** 評価タブに会話ログを出す。トレーナーはこれを読んで独立に採点する。 */
function renderTranscript(session) {
  const scene = S.config.scenes.find((x) => x.id === session.sceneId);
  $("transcript-meta").textContent =
    `${scene ? scene.name : session.sceneId}　/　講師: ${session.teacherName}　/　${session.turns.length}ターン`;
  const box = $("transcript");
  box.innerHTML = "";
  for (const t of session.turns) {
    const b = el("div", `bubble ${t.role}`);
    b.appendChild(el("span", "who", t.role === "teacher" ? "講師" : S.config.persona.name));
    b.appendChild(document.createTextNode(t.text));
    box.appendChild(b);
    if (t.role === "student" && typeof t.thinkingMs === "number") {
      const waited = typeof t.interruptedAtMs === "number" ? t.interruptedAtMs : t.thinkingMs;
      box.appendChild(el("div", "notice",
        typeof t.interruptedAtMs === "number"
          ? `この発話の前に${(t.thinkingMs / 1000).toFixed(1)}秒の沈黙。講師は${(waited / 1000).toFixed(1)}秒で割り込んだ`
          : `この発話の前に${(t.thinkingMs / 1000).toFixed(1)}秒の沈黙。講師は最後まで待った`));
    }
  }
}

function renderMetrics(m) {
  const box = $("metrics");
  if (!m) {
    box.innerHTML = `<p class="muted">「評価AIで採点する」を押すと、自動計測も合わせて算出します。</p>`;
    return;
  }
  const cards = [
    ["講師の発話量", `${(m.words.teacherRatio * 100).toFixed(0)}<small>%</small>`, `講師${m.words.teacher}語 / 生徒${m.words.student}語`],
    ["1回の連続発話 最長", `${m.teacherTurn.maxSeconds}<small>秒</small>`, `平均 ${m.teacherTurn.avgSeconds}秒`],
    ["沈黙を破るまで 最短", `${m.wait.minSeconds ?? "-"}<small>秒</small>`, `平均 ${m.wait.avgSeconds ?? "-"}秒`],
    ["割り込み", `${m.wait.interruptions}<small>回</small>`, `沈黙ウィンドウ ${m.wait.windows}回`],
    ["講師の質問数", `${m.teacherTurn.questionCount}<small>回</small>`, `単語だけの相づち ${m.teacherTurn.shortAckCount}回`],
    ["生徒役の応答時間", `${m.latency.avgSeconds ?? "-"}<small>秒</small>`, `最大 ${m.latency.maxSeconds ?? "-"}秒 / 基準 2.0秒`],
  ];
  box.innerHTML = cards
    .map(([k, v, sub]) => `<div class="metric"><span class="k">${esc(k)}</span><span class="v">${v}</span><span class="k">${esc(sub)}</span></div>`)
    .join("");
}

$("eval-btn").onclick = () => runEvaluation(false);
$("stability-btn").onclick = () => runEvaluation(true);

async function runEvaluation(stability) {
  const btns = [$("eval-btn"), $("stability-btn")];
  btns.forEach((b) => (b.disabled = true));
  const label = $("eval-btn").textContent;
  $("eval-btn").textContent = stability ? "3回採点中…" : "採点中…";
  try {
    const r = await api(`/api/sessions/${S.session.id}/evaluate`, {
      method: "POST",
      body: JSON.stringify({ stability }),
    });
    S.session.metrics = r.metrics;
    S.session.evaluation = r.evaluation;
    S.session.stability = r.stability;
    renderMetrics(r.metrics);
    renderEvaluation(r.evaluation, r.stability);
  } catch (err) {
    alert("評価に失敗しました: " + err.message);
  } finally {
    btns.forEach((b) => (b.disabled = false));
    $("eval-btn").textContent = label;
  }
}

const steps = () => Array.from({ length: S.config.rubric.scale }, (_, i) => i + 1);
const dots = (n) => `<span class="dots5">${steps().map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;

function renderEvaluation(ev, stability) {
  $("eval-card").classList.remove("hidden");
  $("trainer-card").classList.remove("hidden");

  const axesBox = $("axes");
  axesBox.innerHTML = "";
  for (const a of ev.axes) {
    const def = S.config.rubric.axes.find((x) => x.id === a.id);
    const node = el("div", `axis${a.applicable ? "" : " na"}`);
    node.innerHTML = `
      <div class="axis-head">
        <div><span class="axis-name">${esc(def.name)}</span>
          <div class="axis-behavior">${esc(def.behavior)}</div></div>
        <div class="score">${a.applicable ? `${a.score} / ${S.config.rubric.scale} ${dots(a.score)}` : "該当行動なし"}</div>
      </div>
      <div class="rationale">${esc(a.rationale)}</div>
      ${(a.evidence || []).map((e) => `
        <div class="evidence"><q>${esc(e.speaker === "teacher" ? "講師" : "生徒")}: ${esc(e.quote)}</q>
        <span class="note">${esc(e.note)}</span></div>`).join("")}`;
    axesBox.appendChild(node);
  }

  const c = ev.counts || {};
  $("summary").innerHTML = `
    <b>よかった点</b><ul>${(ev.summary.strengths || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <b>次に直す点</b><ul>${(ev.summary.improvements || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <b>次の練習での課題</b><div>${esc(ev.summary.nextPractice)}</div>
    <div class="muted" style="margin-top:8px">即答で訳語を与えた回数 ${c.directTranslation ?? "-"} / ヒントで引き出した回数 ${c.elicitationPrompts ?? "-"} / 前回の話題を掘り下げた回数 ${c.previousTopicFollowUps ?? "-"}${ev.mock ? "　※MOCKモード" : ""}</div>`;

  $("stability").innerHTML = stability
    ? `<b>採点の安定性（同じログを${stability.runs}回採点）</b>　最大差 <b>${stability.maxDiff}</b> 段階（基準: 1以内）<br>` +
      stability.perAxis.map((p) => `${esc(p.name)}: ${p.scores.join(" / ")}（差 ${p.maxDiff}）`).join("　｜　")
    : "";

  renderTrainerForm(ev);
  applyBlind();
}

$("blind-toggle").onchange = applyBlind;
function applyBlind() {
  const hide = $("blind-toggle").checked && !S.session?.trainer?.scores;
  $("axes").classList.toggle("hide-score", hide);
  $("summary").classList.toggle("hide-score", hide);
}

function renderTrainerForm(ev) {
  const box = $("trainer-axes");
  box.innerHTML = "";
  for (const a of ev.axes) {
    const def = S.config.rubric.axes.find((x) => x.id === a.id);
    const saved = S.session.trainer?.scores?.[a.id];
    const row = el("div", "axis");
    row.innerHTML = `
      <div class="axis-head">
        <div><span class="axis-name">${esc(def.name)}</span>
          <div class="axis-behavior">${esc(def.behavior)}${a.applicable ? "" : "（AIは該当行動なしと判定）"}</div></div>
        <select data-axis="${esc(a.id)}">
          <option value="">—（採点しない）</option>
          ${steps().map((i) => `<option value="${i}" ${saved === i ? "selected" : ""}>${i}: ${esc(def.descriptors[i])}</option>`).join("")}
        </select>
      </div>`;
    box.appendChild(row);
  }
  const t = S.session.trainer;
  if (t) {
    $("t-persona").checked = t.personaFidelity;
    $("t-scene").checked = t.sceneOccurrence;
    $("t-useful").value = t.usefulness ? String(t.usefulness) : "";
    $("t-trust").value = t.feedbackTrust ? String(t.feedbackTrust) : "";
    $("t-comment").value = t.comment || "";
  }
}

$("trainer-submit").onclick = async () => {
  const scores = {};
  document.querySelectorAll("#trainer-axes select").forEach((s) => {
    if (s.value) scores[s.dataset.axis] = Number(s.value);
  });
  if (!Object.keys(scores).length) return alert("少なくとも1つの軸を採点してください。");
  const { trainer } = await api(`/api/sessions/${S.session.id}/trainer`, {
    method: "POST",
    body: JSON.stringify({
      scores,
      personaFidelity: $("t-persona").checked,
      sceneOccurrence: $("t-scene").checked,
      usefulness: $("t-useful").value,
      feedbackTrust: $("t-trust").value,
      comment: $("t-comment").value,
    }),
  });
  S.session.trainer = trainer;
  applyBlind();
  await refreshSessions();
  await loadReport();
  await loadProgress();
  goTab("report");
};

/* ---------- 3. 判定レポート ---------- */
$("refresh-report").onclick = loadReport;

async function loadReport() {
  const r = await api("/api/report");
  $("report-meta").textContent =
    `セッション ${r.sessions} 件（うちトレーナー採点済 ${r.scoredSessions} 件）／ κの対象となった軸別スコアのペア ${r.ratedAxisPairs} 組`;

  const fmt = (c) => {
    if (c.value === null) return "—";
    if (c.unit === "ratio") return `${(c.value * 100).toFixed(0)}%`;
    if (c.unit === "secondsMax") return `${c.value}秒`;
    if (c.unit === "likert5") return `${c.value} / 5`;
    if (c.unit === "weightedKappa") return `κ ${c.value}`;
    return `${c.value}段階`;
  };
  const target = (c) => {
    if (c.unit === "ratio") return `${(c.target * 100).toFixed(0)}%以上`;
    if (c.unit === "secondsMax") return `平均${c.target}秒以内`;
    if (c.unit === "likert5") return `平均${c.target}以上`;
    if (c.unit === "weightedKappa") return `${c.target}以上`;
    return `${c.target}段階以内`;
  };
  const row = (c) => `
    <div class="crit">
      <div><span class="name">${esc(c.name)}</span><span class="check">${esc(c.check)}　/　${esc(c.method)}</span></div>
      <div class="target muted">基準 ${esc(target(c))}</div>
      <div class="value"><b>${esc(fmt(c))}</b></div>
      <div><span class="badge ${c.pass === null ? "na" : c.pass ? "pass" : "fail"}">${c.pass === null ? "未測定" : c.pass ? "達成" : "未達"}</span></div>
    </div>`;
  $("criteria-student").innerHTML = r.studentAI.map(row).join("");
  $("criteria-evaluator").innerHTML = r.evaluatorAI.map(row).join("");

  const a = r.agreement;
  $("kappa-overall").innerHTML = `
    <div class="row between">
      <div><span class="kappa-big">${a.kappa === null ? "—" : a.kappa}</span>
        <span class="muted">　重み付きκ（二次重み）／ ${esc(a.label)}　基準 0.61以上</span></div>
      <div class="muted">完全一致 ${a.exact === null ? "—" : (a.exact * 100).toFixed(0) + "%"}　／　
        ±1以内 ${a.within1 === null ? "—" : (a.within1 * 100).toFixed(0) + "%"}　／　
        平均絶対差 ${a.meanAbsDiff ?? "—"}　／　
        AIの甘辛 ${a.aiBias === null ? "—" : (a.aiBias > 0 ? "+" : "") + a.aiBias}（正=AIが甘い）</div>
    </div>
    ${a.note ? `<p class="muted">${esc(a.note)}</p>` : ""}`;

  $("kappa-axes").innerHTML = a.perAxis
    .map((x) => `<div class="crit"><div><span class="name">${esc(x.name)}</span><span class="check">${esc(x.note || x.label)}</span></div>
      <div class="muted">n=${x.n}</div><div class="value"><b>${x.kappa === null ? "—" : x.kappa}</b></div>
      <div><span class="badge ${x.kappa === null ? "na" : x.kappa >= 0.61 ? "pass" : "fail"}">${x.kappa === null ? "—" : x.kappa >= 0.61 ? "達成" : "未達"}</span></div></div>`)
    .join("");

  const list = await api("/api/sessions");
  $("session-list").innerHTML = list.length
    ? `<table><tr><th>ID</th><th>場面</th><th>講師</th><th>ターン</th><th>評価AI</th><th>トレーナー</th><th>安定性</th></tr>` +
      list.map((s) => {
        const sc = S.config.scenes.find((x) => x.id === s.sceneId);
        return `<tr><td><a href="#" data-open="${esc(s.id)}">${esc(s.id)}</a></td><td>${esc(sc ? sc.name : s.sceneId)}</td>
        <td>${esc(s.teacherName)}</td><td>${s.turns}</td><td>${s.evaluated ? "済" : "—"}</td>
        <td>${s.trainerRated ? "済" : "—"}</td><td>${s.stability === null ? "—" : s.stability + "段階"}</td></tr>`;
      }).join("") + `</table>`
    : `<p class="muted">まだセッションがありません。</p>`;
  $("session-list").querySelectorAll("a[data-open]").forEach((a2) => {
    a2.onclick = async (e) => {
      e.preventDefault();
      await openSession(a2.dataset.open);
      goTab("review");
    };
  });
}

/* ---------- 評価軸・ペルソナ ---------- */
function renderSpec() {
  $("spec-rubric").innerHTML = S.config.rubric.axes
    .map((a) => `<div class="spec-item"><b>${esc(a.name)}</b>　<span class="muted">${esc(a.behavior)}</span>
      <div class="muted">採点の手がかり: ${esc(a.cue)}</div>
      <div>${[1, 2, 3, 4, 5].map((i) => `${i}: ${esc(a.descriptors[i])}`).join("<br>")}</div></div>`)
    .join("") + `<p class="muted">出典: ${esc(S.config.rubric.source)}</p>`;

  const p = S.config.persona.profile;
  $("spec-persona").innerHTML =
    `<p class="muted">${esc(S.config.persona.label)}</p>` +
    Object.entries(p)
      .map(([k, v]) => `<div class="spec-item"><b>${esc(({
        englishLevel: "英語レベル", age: "年代・職業", goal: "学習目的", personality: "性格・不安",
        thinkingTime: "考える時間", hobby: "趣味", lastLesson: "前回の話題", condition: "当日の状態",
      })[k] || k)}</b><span class="origin">${esc(v.origin)}</span><div>${esc(v.value)}</div></div>`)
      .join("");

  $("spec-scenes").innerHTML = S.config.scenes
    .map((s) => `<div class="spec-item"><b>${esc(s.name)}</b>　<span class="muted">${esc(s.group)}</span>
      <div class="muted">想定課題: ${esc(s.issue)}</div><div>生徒役の設定: ${esc(s.studentSetup)}</div></div>`)
    .join("");
}

/* ---------- 上達（ホーム） ---------- */
const fmtDate = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtMin = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}<small>時間</small>${m % 60}<small>分</small>` : `${m}<small>分</small>`;
};

async function loadProgress(teacher) {
  const teachers = await api("/api/teachers");
  const sel = $("teacher-picker");
  const keep = teacher || sel.value;
  sel.innerHTML = "";
  for (const t of teachers) sel.appendChild(new Option(`${t.name}（${t.sessions}回）`, t.name));
  if (keep && teachers.some((t) => t.name === keep)) sel.value = keep;

  if (!teachers.length) return renderProgressEmpty();
  const p = await api(`/api/progress?teacher=${encodeURIComponent(sel.value)}`);
  if (!p) return renderProgressEmpty();
  S.progress = p;
  renderProgress(p);
}

function renderProgressEmpty() {
  $("hello").textContent = "ようこそ";
  $("progress-meta").textContent = "まだ練習の記録がありません。";
  $("progress-tiles").innerHTML =
    `<div class="empty" style="grid-column:1/-1"><div class="big">最初の練習をはじめましょう</div>
     <p class="muted">1回練習すると、ここに上達の記録が出ます。デモデータを入れるなら <code>npm run seed</code></p>
     <button class="primary" onclick="document.querySelector('.tab[data-tab=practice]').click()">練習を始める</button></div>`;
  for (const id of ["weekgrid", "axisbars", "trend", "scenegrid", "weektable", "axistable"]) $(id).innerHTML = "";
  $("nextup-card").classList.add("hidden");
}

function renderProgress(p) {
  $("nextup-card").classList.toggle("hidden", !p.nextUp);
  $("hello").textContent = `こんにちは、${p.teacher} さん`;
  $("progress-meta").textContent = p.firstAt
    ? `${fmtDate(p.firstAt)} から ${p.sessions} 回練習（最後は ${fmtDate(p.lastAt)}）`
    : "";

  // 1) 数値タイル（ヒーロー数値：グラフにするより数字のほうが速く読める）
  const pct = p.overall.avg ? Math.round((p.overall.avg / S.config.rubric.scale) * 100) : 0;
  $("progress-tiles").innerHTML = [
    `<div class="tile hero"><span class="k">総合スコア</span><span class="v">${p.overall.avg ?? "—"}<small> / ${S.config.rubric.scale}</small></span><span class="s">到達 ${pct}%　最高 ${p.overall.best ?? "—"}</span></div>`,
    `<div class="tile"><span class="k">練習時間</span><span class="v">${fmtMin(p.practiceSeconds)}</span><span class="s">${p.sessions} 回ぶん</span></div>`,
    `<div class="tile"><span class="k">連続練習日数</span><span class="v" style="color:var(--accent)">${p.streak.current}<small> 日</small></span><span class="s">最長 ${p.streak.longest} 日 / 練習した日 ${p.streak.activeDays} 日</span></div>`,
    `<div class="tile"><span class="k">場面の制覇</span><span class="v">${p.scenesCovered}<small> / ${p.scenesTotal}</small></span><span class="s">6場面のうち練習済み</span></div>`,
  ].join("");

  // 2) 週の練習（順序尺度のドットグリッド）
  const cells = [];
  for (const row of p.week.rows) {
    for (const c of row) {
      const cls = ["wk", c.level ? `l${c.level}` : "", c.isToday ? "today" : "", c.isFuture ? "future" : ""].filter(Boolean).join(" ");
      cells.push(`<div class="${cls}" title="${esc(c.date)}　${c.count}回"></div>`);
    }
  }
  $("weekgrid").innerHTML =
    `<div class="weekgrid">${cells.join("")}</div>
     <div class="wklabels">${p.week.labels.map((l, i) => {
       const todayCol = p.week.rows[p.week.rows.length - 1][i]?.isToday;
       return `<span class="${todayCol ? "now" : ""}">${l}</span>`;
     }).join("")}</div>`;
  $("weektable").innerHTML =
    `<table><tr><th>日付</th><th>練習回数</th></tr>` +
    p.week.rows.flat().filter((c) => c.count > 0).reverse()
      .map((c) => `<tr><td>${esc(c.date)}</td><td>${c.count}</td></tr>`).join("") + `</table>`;

  // 3) 評価軸の上達（単一系列の横棒。凡例は不要、値は直接ラベル）
  $("axisbars").innerHTML = p.axes.map((a) => {
    const has = a.attempts > 0;
    const w = has ? (a.avg / S.config.rubric.scale) * 100 : 0;
    const d = a.delta;
    const dCls = d === null ? "flat" : d > 0.05 ? "up" : d < -0.05 ? "down" : "flat";
    const dTxt = d === null ? "" : `<span class="delta ${dCls}">${d > 0.05 ? "▲+" : d < -0.05 ? "▼" : "±"}${Math.abs(d).toFixed(1)}</span>`;
    return `<div class="bar-row ${has ? "" : "none"}">
      <div class="bar-top">
        <div><span class="bar-name">${esc(a.name)}</span>
          <span class="bar-sub">　${esc(a.behavior)}　/　${a.attempts}回</span></div>
        <div class="bar-val">${has ? a.avg.toFixed(1) : "—"}${has ? dTxt : ""}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
    </div>`;
  }).join("");
  $("axistable").innerHTML =
    `<table><tr><th>評価軸</th><th>回数</th><th>平均</th><th>初回</th><th>直近</th><th>最高</th><th>伸び</th></tr>` +
    p.axes.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.attempts}</td><td>${a.avg ?? "—"}</td>
      <td>${a.first ?? "—"}</td><td>${a.latest ?? "—"}</td><td>${a.best ?? "—"}</td><td>${a.delta ?? "—"}</td></tr>`).join("") +
    `</table>`;

  // 4) 総合スコアの推移（1系列の折れ線。凡例なし、端だけ直接ラベル）
  $("trend").innerHTML = sparkline(p.recent.slice().reverse());

  // 5) 場面の制覇
  $("scenegrid").innerHTML = p.scenes.map((s) =>
    `<div class="scard ${s.count ? "done" : ""}">
      <span class="n">${esc(s.name)}</span><span class="g">${esc(s.group)}</span>
      <div class="c">${s.count}<small> 回</small>　${s.avg !== null ? `<small>平均 </small>${s.avg}` : "<small>未練習</small>"}</div>
    </div>`).join("");

  if (p.nextUp) {
    $("nextup-label").textContent = p.nextUp.label;
    $("nextup-reason").textContent = p.nextUp.reason;
    $("nextup-btn").dataset.scene = p.nextUp.sceneId || "";
    $("nextup-btn").classList.toggle("hidden", !p.nextUp.sceneId);
  }
}

/** 総合スコアの推移。1系列なので凡例は置かず、最初と最後だけ値を直接書く。 */
function sparkline(points) {
  if (points.length < 2) return `<p class="muted">推移を描くには練習が2回以上必要です。</p>`;
  const W = 640, H = 72, PX = 26, PY = 12;
  const x = (i) => PX + (i / (points.length - 1)) * (W - PX * 2);
  const y = (v) => PY + (1 - (v - 1) / 4) * (H - PY * 2); // 1〜5点
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.overall).toFixed(1)}`).join(" ");
  const grid = [1, 3, 5].map((v) =>
    `<line class="gl" x1="${PX}" y1="${y(v)}" x2="${W - PX}" y2="${y(v)}"></line>
     <text x="0" y="${y(v) + 3}">${v}</text>`).join("");
  const marks = points.map((p, i) =>
    `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(p.overall).toFixed(1)}" r="4.5">
      <title>${esc(fmtDate(p.at))}　${esc(p.sceneName)}　総合 ${p.overall}${p.trainerOverall !== null ? `（トレーナー ${p.trainerOverall}）` : ""}</title>
     </circle>`).join("");
  const label = (i, anchor) =>
    `<text x="${x(i).toFixed(1)}" y="${(y(points[i].overall) - 10).toFixed(1)}" text-anchor="${anchor}" style="font-weight:700;fill:var(--ink)">${points[i].overall}</text>`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
    aria-label="総合スコアの推移。${points.length}回ぶん、${points[0].overall}点から${points[points.length - 1].overall}点へ">
    ${grid}<path class="ln" d="${d}"></path>${marks}${label(0, "start")}${label(points.length - 1, "end")}
  </svg>
  <p class="muted">左が古い回。点にカーソルを合わせると日付と場面が出ます（縦軸 1〜5点）</p>`;
}

$("teacher-picker").onchange = () => loadProgress($("teacher-picker").value);
$("nextup-btn").onclick = () => {
  const sceneId = $("nextup-btn").dataset.scene;
  if (sceneId) {
    $("scene-select").value = sceneId;
    renderSceneDesc();
    if (S.progress?.teacher && !$("teacher-name").value) $("teacher-name").value = S.progress.teacher;
  }
  goTab("practice");
};
