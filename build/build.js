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
  version: "0.8.3",
  minAppVersion: "1.13.0",
  description: "本地工作台：模块视图、速记卡片与画布集合并为一个插件.",
  author: "Lak",
  isDesktopOnly: true
};
fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

// versions.json 只增不覆盖：老版本的最低 App 版本是升级判断依据，丢了会让老用户判错。
let versions = {};
try {
  versions = JSON.parse(read("versions.json"));
} catch (error) {
  versions = {};
}
if (!versions || typeof versions !== "object" || Array.isArray(versions)) versions = {};
versions[manifest.version] = manifest.minAppVersion;
const sortKey = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
const ordered = {};
Object.keys(versions)
  .sort((a, b) => {
    const x = sortKey(a);
    const y = sortKey(b);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  })
  .forEach((k) => {
    ordered[k] = versions[k];
  });
fs.writeFileSync(path.join(dist, "versions.json"), JSON.stringify(ordered, null, 2) + "\n", "utf8");

// 4) 构建指纹：记录这批产物是由哪份源码、哪个 esbuild 构建出来的。
//    只写进 dist/build-info.json，不进入发布资产，也不影响 main.js 的字节。
const crypto = require("crypto");
const hashFiles = (list) => {
  const h = crypto.createHash("sha256");
  for (const rel of list) h.update(rel + "\0").update(fs.readFileSync(path.join(root, rel))).update("\0");
  return h.digest("hex");
};
const sources = [
  "src/main.js",
  "src/noval-notes.js",
  "src/noval-gallery.js",
  "vendor/noval-notes-core.js",
  "vendor/noval-board-core.js",
  "build/noval-host.css",
  "build/noval-notes.css",
  "build/noval-board.css"
];
let esbuildVersion = "unknown";
try {
  const v = spawnSync(esbuild, ["--version"], { cwd: root, shell: true, encoding: "utf8" });
  if (v.stdout) esbuildVersion = v.stdout.trim();
} catch (error) {
  esbuildVersion = "unknown";
}
const products = {};
for (const name of ["main.js", "styles.css", "manifest.json"]) {
  products[name] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, name))).digest("hex");
}
fs.writeFileSync(
  path.join(dist, "build-info.json"),
  JSON.stringify({ version: manifest.version, sources: hashFiles(sources), esbuild: esbuildVersion, products }, null, 2) + "\n",
  "utf8"
);

// 5) 根目录三资产跟 dist 对齐：以前靠手工 cp，漏过一次导致仓库根是旧产物。
const assets = ["main.js", "styles.css", "manifest.json", "versions.json"];
for (const name of assets) {
  const from = path.join(dist, name);
  const to = path.join(root, name);
  const buf = fs.readFileSync(from);
  let same = false;
  try {
    same = fs.readFileSync(to).equals(buf);
  } catch (error) {
    same = false;
  }
  if (!same) fs.writeFileSync(to, buf);
  console.log(name, buf.length, same ? "(root already in sync)" : "(copied to root)");
}
console.log("build-info.json written; esbuild", esbuildVersion);
