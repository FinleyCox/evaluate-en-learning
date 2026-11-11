/*
 * 音声モードを1人で通しで動かす。voicecheck.stub.browser.js の後、app.js の前に読み込まれる。
 */
"use strict";

window.SpeechRecognition = window.__FakeSR;

(async () => {
  const { out, ok, $id, until, report } = window.__harness();
  const notices = () => Array.from(document.querySelectorAll("#chat .notice")).map((n) => n.textContent);

  try {
    await until(() => $id("scene-select").options.length > 0, "設定の読み込み");
    $id("teacher-name").value = "音声チェック";
    $id("mode-select").value = "voice";
    $id("mode-select").dispatchEvent(new Event("change"));
    ok($id("tts-label").classList.contains("hidden"), "音声モードでは読み上げの選択を隠す");
    $id("start-btn").click();

    await until(() => S.session && V.on, "練習の開始とマイクの待受");
    ok(S.mode === "voice", "音声モードで始まる");
    ok(!$id("voicebar").classList.contains("hidden"), "マイクの状態帯が出る");
    await until(() => window.__spoken.length > 0, "生徒の第一声の読み上げ");
    ok(window.__spoken.length === 1, "生徒の第一声を読み上げる: " + window.__spoken[0]);
    await until(() => V.running && !V.muted, "読み上げが終わるとマイクが戻る");

    /* 1回目：普通に話し、黙ったら自動で送られる */
    ok(window.__say("Hi, how are you today?", 2000), "マイクが聞き取る");
    ok(V.startedAt !== null, "話し始めの時刻を記録する");
    await until(() => V.spokeUntil !== null, "声の切れ目を拾う");
    await until(() => window.__posts.length === 1, "1.5秒の沈黙で自動送信する");
    const p1 = window.__posts[0] || {};
    ok(p1.text === "Hi, how are you today?", "聞き取った文をそのまま送る");
    ok(p1.speechMs >= 1900 && p1.speechMs <= 2300, "2秒話したぶんを実測して送る: speechMs=" + p1.speechMs);
    ok(p1.interruptedAtMs === null, "割り込みのない回は null を送る");

    /* 2回目：生徒が黙って考えている最中に話し始める＝割り込み */
    await until(() => S.thinking, "生徒が考え始める");
    const spokenBefore = window.__spoken.length;
    ok(window.__say("Are you okay?", 1200), "沈黙中にマイクが聞き取る");
    ok(S.pendingInterruptMs !== null && S.pendingInterruptMs >= 0, "話し始めた時刻を割り込みとして記録する");
    ok(!S.thinking, "沈黙はそこで打ち切られる");
    ok(notices().some((t) => t.includes("話し始めました")), "割り込みを画面に出す");
    await new Promise((r) => setTimeout(r, 300));
    ok(window.__spoken.length === spokenBefore, "割り込んだ回の返事は読み上げない（声が重ならない）");
    const interrupt = S.pendingInterruptMs;
    await until(() => window.__posts.length === 2, "割り込みの後も自動送信する");
    const p2 = window.__posts[1] || {};
    ok(p2.interruptedAtMs === interrupt, "送信した時点ではなく話し始めた時点を送る: " + p2.interruptedAtMs + "ms");
    ok(p2.speechMs >= 1100 && p2.speechMs <= 1500, "割り込んだ回も秒数は実測: speechMs=" + p2.speechMs);

    /* 3回目：手で打ち直したら、聞き取りから測った秒数は使わない */
    await until(() => S.thinking, "生徒が考え始める(2)");
    window.__say("typed over", 500);
    await until(() => V.spokeUntil !== null, "声の切れ目を拾う(2)");
    $id("input").value = "I typed this myself";
    $id("input").dispatchEvent(new Event("input"));
    ok(V.typed, "手で打ち直したことを検知する");
    $id("send-btn").click();
    await until(() => window.__posts.length === 3, "手打ちの送信");
    const p3 = window.__posts[2] || {};
    ok(p3.speechMs === null, "打ち直した回は実測を使わない");

    /* 練習を終えるとマイクも読み上げも止まり、次の練習を始められる状態に戻る */
    const firstId = S.session.id;
    $id("finish-btn").click();
    await until(() => !V.on, "終了でマイクが止まる");
    ok(!V.on && !V.running, "マイクが止まっている");
    ok(!$id("setup").classList.contains("hidden") && $id("chatwrap").classList.contains("hidden"),
      "終了すると場面を選ぶところに戻る");
    document.querySelector('.tab[data-tab="practice"]').click();
    $id("start-btn").click();
    await until(() => S.session && S.session.id !== firstId, "2回目の練習を始められる");
    ok(S.session.id !== firstId, "リロードせずに2回目を始められる");
    $id("finish-btn").click();
    await until(() => !V.on, "2回目の終了");

    /* サーバに残った1回目のログ */
    const saved = await (await fetch("/api/sessions/" + firstId)).json();
    const teacher = saved.turns.filter((t) => t.role === "teacher");
    ok(teacher.length === 3, "3ターン保存されている");
    ok(teacher[0].speechMs > 0 && teacher[2].speechMs === undefined, "実測のある回だけ speechMs を持つ");
    ok(saved.turns.some((t) => t.interruptedAtMs > 0), "割り込みがログに残る");
    ok(saved.metrics === undefined || saved.metrics === null, "採点前なので自動計測はまだ無い");
  } catch (err) {
    out.push("ERROR " + (err && err.stack ? err.stack : err));
  }

  report();
})();
