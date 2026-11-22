const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const src = path.join(__dirname, "..", "dist");
// The install target is machine-specific; pass it in instead of baking a
// local vault path into the repository.
const dst = process.env.OBSIDIAN_PLUGIN_DIR;
if (!dst) {
  console.error("请先设置 OBSIDIAN_PLUGIN_DIR 指向本机的插件安装目录");
  process.exit(1);
}
// main.js 放最后写：Obsidian 监听到它会立刻重载插件并短暂占用其它文件，
// 先写完样式和 manifest，最后再触发重载。
const files = ["styles.css", "manifest.json", "main.js"];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeWithRetry(target, buf) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.writeFileSync(target, buf);
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      try {
        fs.chmodSync(target, 0o666);
      } catch (e) {
        // 文件不存在时忽略
      }
      sleep(400);
    }
  }
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

fs.mkdirSync(dst, { recursive: true });
for (const name of files) {
  const buf = fs.readFileSync(path.join(src, name));
  const target = path.join(dst, name);
  // 内容一致就别重写：Obsidian 会监听插件文件，重复写只会把文件锁住。
  try {
    if (sha(fs.readFileSync(target)) === sha(buf)) {
      console.log(name, "unchanged");
      continue;
    }
  } catch (error) {
    // 文件不存在时继续写
  }
  // copyFile 会被宿主拦截，直接写更稳；先解除只读位。
  try {
    fs.chmodSync(target, 0o666);
  } catch (error) {
    // 文件不存在时忽略
  }
  writeWithRetry(target, buf);
}

let ok = true;
for (const name of files) {
  const a = fs.readFileSync(path.join(src, name));
  const b = fs.readFileSync(path.join(dst, name));
  const same = a.length === b.length && sha(a) === sha(b);
  if (!same) ok = false;
  console.log(name, b.length, same ? "OK" : "MISMATCH");
}
console.log(ok ? "INSTALL-OK" : "INSTALL-FAILED");
process.exit(ok ? 0 : 1);
