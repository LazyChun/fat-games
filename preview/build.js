/* HurdleGame 预览构建脚本（仅本地验证用） */
const esbuild = require("esbuild");
const path = require("path");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "hurdle-preview.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome110"],
  outfile: path.join(__dirname, "bundle.js"),
  loader: { ".less": "css", ".css": "css" },
  jsx: "automatic",
  logLevel: "warning",
});
console.log("[preview] bundle done");
