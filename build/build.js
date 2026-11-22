const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// 1) 把宿主 + 内置的 Noval（速记卡片 + 画布集）打成单文件 main.js
const esbuild = process.env.ESBUILD || "npx esbuild";
const args = [
  "src/main.js",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=es2020",
  "--external:obsidian",
  "--external:electron",
  "--outfile=dist/main.js",
  "--log-level=warning"
];
const result = spawnSync(esbuild, args, { cwd: root, stdio: "inherit", shell: true });
if (result.status !== 0) {
  console.error("esbuild 失败，请检查 ESBUILD 路径");
  process.exit(1);
}

// 2) 三段样式拼接：宿主 → 速记卡片 → 画布集
const parts = ["build/noval-host.css", "build/noval-notes.css", "build/noval-board.css"].map(
  (p) => "/* ==================== " + path.basename(p) + " ==================== */\n" + read(p)
);
fs.writeFileSync(path.join(dist, "styles.css"), parts.join("\n\n"), "utf8");

// 3) 插件清单
const manifest = {
  id: "noval",
  name: "Noval",
  version: "0.6.2",
  minAppVersion: "1.13.0",
  description: "本地工作台：模块视图、速记卡片与画布集合并为一个插件.",
  author: "Lak",
  isDesktopOnly: true
};
fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
fs.writeFileSync(
  path.join(dist, "versions.json"),
  JSON.stringify({ [manifest.version]: manifest.minAppVersion }, null, 2) + "\n",
  "utf8"
);

for (const name of ["main.js", "styles.css", "manifest.json"]) {
  console.log(name, fs.statSync(path.join(dist, name)).size);
}
