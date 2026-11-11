/*
 * 音声モードの検証で、画面に差し込む偽物。app.js より前に読み込まれる。
 * 本物を置き換えるのはマイクと読み上げだけで、画面もサーバもそのまま動かす。
 * 聞き取りを使うシナリオは、自分で window.SpeechRecognition = window.__FakeSR を置く。
 */
"use strict";

window.__spoken = [];
window.__posts = [];

/** 話したことにできるマイク。本物と同じ順序で onspeechstart → onspeechend → onresult を出す。 */
window.__FakeSR = class {
  start() { window.__sr = this; this._on = true; setTimeout(() => this.onstart && this.onstart(), 0); }
  stop() { this._on = false; setTimeout(() => this.onend && this.onend(), 0); }
  abort() { this._on = false; setTimeout(() => this.onend && this.onend(), 0); }
};

/** ms ミリ秒かけて話す。声が切れた少し後に聞き取り結果が届く。 */
window.__say = (text, ms) => {
  const sr = window.__sr;
  if (!sr || !sr._on) return false;
  sr.onspeechstart && sr.onspeechstart();
  setTimeout(() => {
    sr.onspeechend && sr.onspeechend();
    setTimeout(() => {
      const r = [{ transcript: text }];
      r.isFinal = true;
      sr.onresult && sr.onresult({ resultIndex: 0, results: [r] });
    }, 250);
  }, ms);
  return true;
};

const synth = {
  speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 200); },
  cancel() { window.__spoken.push("(cancel)"); },
};
Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
Object.defineProperty(window, "SpeechSynthesisUtterance", {
  value: function (t) { this.text = t; }, configurable: true,
});

const realFetch = window.fetch;
window.fetch = (url, opts) => {
  if (opts && opts.method === "POST" && String(url).endsWith("/turn")) window.__posts.push(JSON.parse(opts.body));
  return realFetch(url, opts);
};

/** シナリオ共通の小道具。結果は #voicecheck-result に書き出す。 */
window.__harness = () => {
  const out = [];
  return {
    out,
    ok: (cond, label) => out.push((cond ? "PASS " : "FAIL ") + label),
    $id: (id) => document.getElementById(id),
    until: async (cond, label, tries = 4000) => {
      for (let i = 0; i < tries; i++) {
        if (cond()) return true;
        await new Promise((r) => setTimeout(r, 10));
      }
      out.push("TIMEOUT " + label);
      return false;
    },
    report: () => {
      const pre = document.createElement("pre");
      pre.id = "voicecheck-result";
      pre.textContent = out.join("\n");
      document.body.appendChild(pre);
    },
  };
};
