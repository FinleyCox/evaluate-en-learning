/*
 * 音声に対応していないブラウザでの振る舞いと、テキストでの練習を通しで動かす。
 * voicecheck.stub.browser.js の後、app.js の前に読み込まれる。
 * ここでは window.SpeechRecognition を置かない＝聞き取りが使えない環境を再現する。
 */
"use strict";

for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
  Object.defineProperty(window, name, { value: undefined, configurable: true });
}

(async () => {
  const { out, ok, $id, until, report } = window.__harness();

  try {
    await until(() => $id("scene-select").options.length > 0, "設定の読み込み");

    /* 音声が使えない環境では、選べないことが分かるようにする */
    ok($id("mode-select").querySelector('option[value="voice"]').disabled, "「声で話す」は選べない");
    ok($id("mic-btn").classList.contains("hidden"), "マイクのボタンは出さない");
    ok($id("mode-note").textContent.includes("対応していません"), "対応していないことを書く: " + $id("mode-note").textContent);
    ok(!$id("tts-label").classList.contains("hidden"), "読み上げの選択は出す");

    /* テキストでの練習 */
    $id("teacher-name").value = "音声チェック";
    $id("start-btn").click();
    await until(() => S.session, "練習の開始");
    ok(S.mode === "text", "テキストモードで始まる");
    ok($id("voicebar").classList.contains("hidden"), "マイクの状態帯は出ない");
    ok(!V.on, "マイクは動かない");
    ok(window.__spoken.length === 0, "読み上げがオフなら喋らない");

    $id("input").value = "How was your weekend?";
    $id("input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => window.__posts.length === 1, "Enterで送信");
    ok(window.__posts[0].speechMs === null, "実測なしで送る");
    ok(window.__posts[0].interruptedAtMs === null, "割り込みなしの回は null を送る");

    /* 沈黙中に送信したら、その時点が割り込みになる */
    await until(() => S.thinking, "生徒が考え始める");
    await new Promise((r) => setTimeout(r, 1500));
    $id("input").value = "Hello?";
    $id("send-btn").click();
    await until(() => window.__posts.length === 2, "沈黙中の送信");
    ok(window.__posts[1].interruptedAtMs >= 1400,
      "送信した時点を割り込みとして送る: " + window.__posts[1].interruptedAtMs + "ms");
    const kids = Array.from($id("chat").children).map((n) => n.className);
    const noticeAt = kids.indexOf("notice");
    const replyAt = kids.findIndex((c, i) => i > noticeAt && c.includes("bubble student"));
    ok(noticeAt >= 0 && replyAt > noticeAt, "割り込みの注記は生徒の返事より先に出る");

    /* テキストモードでも、読み上げを選べば喋る */
    $id("tts-toggle").checked = true;
    await until(() => S.thinking, "生徒が考え始める(2)");
    await until(() => window.__spoken.length === 1, "読み上げをオンにすると喋る");
    ok(window.__spoken.length === 1, "テキストモードでも読み上げは効く");

    $id("finish-btn").click();
    await until(() => $id("setup") && !$id("setup").classList.contains("hidden"), "終了で設定に戻る");
    ok(!$id("setup").classList.contains("hidden"), "終了すると場面を選ぶところに戻る");
  } catch (err) {
    out.push("ERROR " + (err && err.stack ? err.stack : err));
  }
  report();
})();
