// 音声まわりを、実際のブラウザで通しで動かして確かめる。
// マイクと読み上げだけを偽物に差し替え、画面・app.js・サーバは本物を使う。
// ヘッドレスの Chrome が要る。無ければ理由を出して成功扱いで終える。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "../server/config.mjs";

const PORT = Number(process.env.VOICECHECK_PORT || 5399);
const TEACHER = "音声チェック";
const PUBLIC = path.join(ROOT, "public");
const PAGE = path.join(PUBLIC, "__voicecheck.html");
const STUB = path.join(PUBLIC, "__voicecheck-stub.js");
const SCRIPT = path.join(PUBLIC, "__voicecheck.js");

const SCENARIOS = [
  { name: "音声モード", file: "voicecheck.voice.browser.js" },
  { name: "音声が使えないブラウザとテキスト練習", file: "voicecheck.fallback.browser.js" },
];

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && fs.existsSync(p));

if (!CHROME) {
  console.log("Chrome が見つからないので音声モードの検証は省略しました（CHROME_PATH で指定できます）。");
  process.exit(0);
}

const run = (cmd, args, opts) =>
  new Promise((resolve) => {
    let out = "";
    const child = spawn(cmd, args, opts);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", () => {});
    child.on("close", (code) => resolve({ code, out }));
  });

/** 検証用のページを public に置く。本物の index.html から作るので、画面とずれない。 */
function writePage(scenarioFile) {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const injected = html.replace(
    '<script src="app.js"></script>',
    '<script src="__voicecheck-stub.js"></script>\n<script src="__voicecheck.js"></script>\n<script src="app.js"></script>'
  );
  if (injected === html) throw new Error("index.html に app.js の読み込みが見当たりません");
  fs.copyFileSync(path.join(ROOT, "scripts", "voicecheck.stub.browser.js"), STUB);
  fs.copyFileSync(path.join(ROOT, "scripts", scenarioFile), SCRIPT);
  fs.writeFileSync(PAGE, injected);
}

/** 1シナリオぶんを走らせ、結果の行を返す。 */
async function runScenario(scenario) {
  writePage(scenario.file);
  // --virtual-time-budget で、沈黙の5〜8秒を待たずに時計だけ先へ進める
  const { out } = await run(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=60000",
    "--dump-dom", `http://localhost:${PORT}/__voicecheck.html`,
  ]);
  const m = out.match(/<pre id="voicecheck-result">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error(`「${scenario.name}」の結果が見つかりませんでした（ページが最後まで動いていません）`);
  return m[1].split("\n").map((l) =>
    l.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
}

function cleanup(server) {
  if (server) server.kill();
  for (const f of [PAGE, STUB, SCRIPT]) if (fs.existsSync(f)) fs.unlinkSync(f);
  // 検証で作ったセッションは残さない
  const dir = path.join(ROOT, "data", "sessions");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(dir, f);
    try {
      if (JSON.parse(fs.readFileSync(file, "utf8")).teacherName === TEACHER) fs.unlinkSync(file);
    } catch {
      /* 読めないファイルは触らない */
    }
  }
}

let server = null;
try {
  // 生徒役は台本（MOCK）で足りるので、APIは呼ばない。
  // 空文字で渡せば .env の値で上書きされない（loadEnvFile は設定済みの変数を触らない）
  server = spawn(process.execPath, [path.join(ROOT, "server", "index.mjs")], {
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
    stdio: "ignore",
  });

  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try {
      up = (await fetch(`http://localhost:${PORT}/api/config`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!up) throw new Error(`検証用サーバが ${PORT} 番で起動しませんでした`);

  let total = 0;
  let failed = 0;
  for (const scenario of SCENARIOS) {
    const lines = await runScenario(scenario);
    const bad = lines.filter((l) => !l.startsWith("PASS "));
    console.log(`\n[${scenario.name}]`);
    for (const l of lines) console.log(bad.length ? "  " + l : "  ✓ " + l.slice(5));
    total += lines.length;
    failed += bad.length;
  }
  if (failed) throw new Error(`${failed} 件が通りませんでした`);
  console.log(`\n${SCENARIOS.length} シナリオ ${total} 項目、すべて通りました。`);
} catch (err) {
  console.error("\n音声モードの検証に失敗しました:", err.message);
  cleanup(server);
  process.exit(1);
}
cleanup(server);
