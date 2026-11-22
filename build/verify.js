// 本地验证：用假的 obsidian 模块执行 Collis 各子模块构建产物与打包后的 dist/main.js，
// 确认插件类能取到、单文件 bundle 能在模块层正常执行（不启动 Obsidian，不接触 vault）。
const fs = require("fs");
const path = require("path");
const Module = require("module");

global.window = global.window || {};
global.document = global.document || {};

const obsidianStub = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (prop === "default") return obsidianStub;
      if (!target[prop]) {
        target[prop] = class Stub {};
      }
      return target[prop];
    }
  }
);

function loadVendor(file) {
  const code = fs.readFileSync(file, "utf8");
  const mod = { exports: {} };
  const fakeRequire = (id) => {
    if (id === "obsidian") return obsidianStub;
    throw new Error("unexpected require: " + id);
  };
  const factory = new Function("module", "exports", "require", "__filename", "__dirname", code);
  factory(mod, mod.exports, fakeRequire, file, path.dirname(file));
  return mod.exports;
}

const root = path.join(__dirname, "..");
const cases = [
  ["collis", path.join(root, "vendor/collis-core.js")],
  ["collis-board", path.join(root, "vendor/collis-board-core.js")]
];

for (const [id, file] of cases) {
  const exported = loadVendor(file);
  const cls =
    typeof exported === "function"
      ? exported
      : exported && typeof exported.default === "function"
        ? exported.default
        : null;
  console.log(id, cls ? "OK: " + (cls.name || "(anonymous)") : "FAIL");
}

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return obsidianStub;
  return originalLoad.apply(this, arguments);
};
try {
  const CollisPlugin = require(path.join(root, "dist/main.js"));
  console.log("dist/main.js OK:", typeof CollisPlugin, CollisPlugin && CollisPlugin.name);
} finally {
  Module._load = originalLoad;
}
