export default [
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024, sourceType: "module",
      globals: { process: "readonly", console: "readonly", fetch: "readonly", URL: "readonly", setTimeout: "readonly" },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "after-used", varsIgnorePattern: "^_" }],
      "no-undef": "error", "no-constant-condition": "warn", "no-empty": "warn",
      "no-dupe-keys": "error", "no-unreachable": "error", "require-atomic-updates": "warn",
      "no-shadow": "warn", "no-fallthrough": "error", "eqeqeq": ["warn", "smart"],
    },
  },
  {
    // ブラウザで動くもの（画面本体と、検証用に画面へ差し込むスクリプト）
    files: ["public/**/*.js", "scripts/*.browser.js"],
    languageOptions: {
      ecmaVersion: 2024, sourceType: "script",
      globals: {
        document: "readonly", window: "readonly", fetch: "readonly", console: "readonly",
        alert: "readonly", Option: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly", speechSynthesis: "readonly",
        SpeechSynthesisUtterance: "readonly", encodeURIComponent: "readonly",
        Event: "readonly", KeyboardEvent: "readonly",
        // 検証スクリプトは app.js の状態をそのまま読む
        S: "readonly", V: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "after-used" }],
      "no-undef": "error", "no-empty": "warn", "no-dupe-keys": "error",
      "no-unreachable": "error", "no-shadow": "warn", "eqeqeq": ["warn", "smart"],
    },
  },
];
