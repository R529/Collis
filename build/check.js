/**
 * 发布前体检：把「版本号 / 产物 / 源码 / 配置」四处容易脱节的地方一次性对齐检查。
 * 只读，不修改任何文件。退出码 0 = 通过（可有警告），1 = 有必须修的问题。
 *
 * 用法：node build/check.js
 *   可选 OBSIDIAN_PLUGIN_DIR=... 时同时核对本机安装目录。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const problems = [];
const warnings = [];
const notes = [];

const fail = (msg) => problems.push(msg);
const warn = (msg) => warnings.push(msg);
const info = (msg) => notes.push(msg);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const exists = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch (error) {
    return false;
  }
};
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/* 1. 结构完整性：源码、样式、产物都在 */
const SOURCES = [
  "src/main.js",
  "src/noval-notes.js",
  "src/noval-gallery.js",
  "vendor/noval-notes-core.js",
  "vendor/noval-board-core.js",
  "build/noval-host.css",
  "build/noval-notes.css",
  "build/noval-board.css"
];
const ASSETS = ["main.js", "styles.css", "manifest.json", "versions.json"];
for (const f of SOURCES) if (!exists(path.join(root, f))) fail("缺少源文件：" + f);
for (const f of ASSETS) {
  if (!exists(path.join(root, f))) fail("缺少仓库根资产：" + f);
  if (!exists(path.join(dist, f))) fail("缺少 dist 资产：" + f);
}
if (problems.length) {
  console.log("结构完整性未通过，先补齐文件再继续检查。");
  problems.forEach((p) => console.log("  FAIL " + p));
  process.exit(1);
}

/* 2. dist 与仓库根逐字节一致 */
for (const f of ASSETS) {
  const a = path.join(dist, f);
  const b = path.join(root, f);
  if (!fs.readFileSync(a).equals(fs.readFileSync(b))) {
    fail(f + "：dist 与仓库根不一致（先跑 node build/build.js）");
  }
}

/* 3. 版本号四处一致 */
const manifest = readJson(path.join(root, "manifest.json"));
const versions = readJson(path.join(root, "versions.json"));
const buildSrc = fs.readFileSync(path.join(root, "build/build.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const version = manifest.version;

const buildVersion = (buildSrc.match(/version:\s*"([^"]+)"/) || [])[1];
if (!buildVersion) warn("build/build.js 里没找到 version 字段");
else if (buildVersion !== version) fail('build/build.js 版本 ' + buildVersion + ' 与 manifest ' + version + " 不一致");

const badge = (readme.match(/version-([0-9]+\.[0-9]+\.[0-9]+)-/ ) || [])[1];
if (!badge) warn("README 没有版本 badge");
else if (badge !== version) fail("README badge " + badge + " 与 manifest " + version + " 不一致");

const vKeys = Object.keys(versions);
if (!vKeys.includes(version)) fail("versions.json 缺少当前版本 " + version + " 的映射");
const latest = vKeys
  .slice()
  .sort((a, b) => {
    const x = a.split(".").map(Number);
    const y = b.split(".").map(Number);
    for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  })
  .pop();
if (latest !== version) fail("versions.json 最新键是 " + latest + "，与 manifest " + version + " 不一致");
if (vKeys.length < 3) warn("versions.json 只剩 " + vKeys.length + " 条映射，历史版本可能被覆盖过");

/* 4. manifest 合规：市场上架要求 */
if (manifest.id !== "noval") fail("manifest.id 必须是 noval，当前 " + manifest.id);
if (!manifest.minAppVersion) fail("manifest 缺少 minAppVersion");
if (versions[version] && versions[version] !== manifest.minAppVersion) {
  fail("versions.json 里 " + version + " 的 minAppVersion 与 manifest 不一致");
}
const desc = String(manifest.description || "");
if (!desc) fail("manifest 缺少 description");
else {
  if (/obsidian/i.test(desc)) fail("manifest.description 不能出现 Obsidian 一词（市场上架规则）");
  if (!/[.]$/.test(desc)) warn("manifest.description 建议以英文句点结尾");
  if ([...desc].length > 250) fail("manifest.description 超过 250 字符");
}

/* 5. 构建指纹：dist 是不是当前源码构建出来的 */
const infoPath = path.join(dist, "build-info.json");
if (!exists(infoPath)) {
  warn("dist/build-info.json 不存在：无法确认 dist 是否由当前源码构建");
} else {
  const meta = readJson(infoPath);
  const hashFiles = (list) => {
    const h = crypto.createHash("sha256");
    for (const f of list) h.update(f + "\0").update(fs.readFileSync(path.join(root, f))).update("\0");
    return h.digest("hex");
  };
  const now = hashFiles(SOURCES);
  if (meta.sources !== now) {
    fail("源码已改动但 dist 没重建：dist 落后于 src/vendor/build（重跑 node build/build.js）");
  }
  if (meta.version !== version) fail("build-info 版本 " + meta.version + " 与 manifest " + version + " 不一致");
  for (const f of ["main.js", "styles.css", "manifest.json"]) {
    if (meta.products && meta.products[f] && meta.products[f] !== sha(path.join(dist, f))) {
      fail(f + "：dist 里的文件不是 build-info 记录的那一版（被手工改过？）");
    }
  }
}

/* 6. 产物安全扫描：不能带本机信息 */
const banned = [
  [/[A-Za-z]:[\\/](?:Users|Documents|Desktop)[\\/]/i, "本机绝对路径"],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "邮箱地址"],
  [/sk-[A-Za-z0-9]{12,}/, "疑似 API Key"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, "内网/公网 IP"]
];
for (const f of ["main.js", "styles.css"]) {
  const text = fs.readFileSync(path.join(root, f), "utf8");
  for (const [re, label] of banned) {
    const hit = text.match(re);
    if (hit) fail(f + " 含有" + label + "：" + String(hit[0]).slice(0, 40));
  }
}

/* 7. 旧插件名：只允许出现在 LEGACY 兼容映射里 */
const legacyHits = (fs.readFileSync(path.join(root, "main.js"), "utf8").match(/collis|volis/gi) || []).length;
if (legacyHits) info("产物中有 " + legacyHits + " 处 collis/volis，属 LEGACY 迁移表（老配置兼容），预期存在");

/* 8. 本机安装目录（可选） */
const installDir = process.env.OBSIDIAN_PLUGIN_DIR;
if (installDir) {
  for (const f of ["main.js", "styles.css", "manifest.json"]) {
    const target = path.join(installDir, f);
    if (!exists(target)) {
      warn("本机安装目录缺少 " + f);
      continue;
    }
    if (!fs.readFileSync(target).equals(fs.readFileSync(path.join(dist, f)))) {
      warn("本机安装的 " + f + " 与仓库产物不一致（可跑 node build/install.js 同步）");
    }
  }
} else {
  info("未设置 OBSIDIAN_PLUGIN_DIR，跳过本机安装目录核对");
}

/* 输出 */
console.log("Noval 发布体检 · 版本 " + version);
for (const n of notes) console.log("  INFO " + n);
for (const w of warnings) console.log("  WARN " + w);
for (const p of problems) console.log("  FAIL " + p);
console.log(
  problems.length
    ? "\n结果：有 " + problems.length + " 项必须修复"
    : warnings.length
      ? "\n结果：通过，有 " + warnings.length + " 项提示"
      : "\n结果：全部通过"
);
process.exit(problems.length ? 1 : 0);
