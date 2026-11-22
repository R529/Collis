const {
  Plugin,
  ItemView,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  Menu,
  debounce,
  setIcon,
  addIcon
} = require("obsidian");

// 内置子插件：Collis（速记卡片）与 Collis（画布工作台）。
// 代码在打包时并入本插件，设置统一存进 collis/data.json 的 collis / collis-board 键，
// 不再依赖单独的插件文件夹。
const CollisBundle = require("../vendor/collis-core.js");
const CollisBoardBundle = require("../vendor/collis-board-core.js");
const { CollisGalleryPanel } = require("./collis-gallery.js");
const { CollisNotesPanel } = require("./collis-notes.js");

function resolvePluginClass(bundle, fallbackName) {
  if (typeof bundle === "function") return bundle;
  if (bundle && typeof bundle.default === "function") return bundle.default;
  if (bundle && typeof bundle[fallbackName] === "function") return bundle[fallbackName];
  return null;
}

const BUNDLED_PLUGINS = [
  {
    id: "collis",
    className: "QuickMemoPlugin",
    bundle: CollisBundle,
    manifest: {
      id: "collis",
      name: "Collis",
      version: "2.0.5",
      minAppVersion: "1.4.0",
      description: "在知识库里速记：不建文件、不起标题，按月存进本地 Markdown。",
      author: "Lak",
      isDesktopOnly: false
    }
  },
  {
    id: "collis-board",
    className: "CollisBoardPlugin",
    bundle: CollisBoardBundle,
    manifest: {
      id: "collis-board",
      name: "Collis",
      version: "0.6.2",
      minAppVersion: "1.13.0",
      description: "Canvas 思考工作台：画布集、语义连线、大纲、Markdown 导出与 AI。",
      author: "Lak",
      isDesktopOnly: true
    }
  }
];

const VIEW_TYPE = "collis-view";
// 卡片笔记右侧栏视图，由内置 Collis 注册；主插件需要用它判断/恢复侧栏
const QM_VIEW_TYPE = "qm-cards-view";
// 插件图标沿用 Collis 画布标志；图形从内置 Collis 模块里取，保证
// 侧栏卡片视图、ribbon、标签页三处是同一枚图标。
const PLUGIN_ICON_ID = (CollisBundle && CollisBundle.ICON_ID) || "collis-mark";
const PLUGIN_ICON_SVG = (CollisBundle && CollisBundle.ICON_MARK) || "";
const CARD_FOLDER = "00-Inbox/速记";
const BOARD_EXT = "collis";

/* 收集箱收录的附件类型白名单。
 * 以前是“非 md 全收”，结果白板的 .volis.json / .volis.bak 这类复合后缀
 * 也混进了收集箱。改成白名单后，只认真正给人看的素材文件。 */
const ATTACHMENT_EXTENSIONS = new Set([
  // 图片
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif", "ico", "tif", "tiff",
  // 视频
  "mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpeg", "mpg",
  // 音频
  "mp3", "wav", "m4a", "ogg", "flac", "aac", "opus", "wma", "aiff",
  // 文档
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "epub", "odt", "ods", "odp", "rtf", "txt",
  // 压缩包
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
  // 其他常见素材
  "excalidraw", "base"
]);
/* ---------------- 收录过滤 ----------------
 * 只排除“给工具/AI 用的技术文件”，不动任何正常笔记。
 * 判定分三层，任一命中就跳过：
 *   1. 路径里任意一段以 "." 开头（.obsidian / .claude / .git …）
 *   2. 任意一级目录名命中技术目录名单（vault-scripts / node_modules …）
 *   3. 文件名（去掉扩展名、转小写）命中工具文件名单（README / CLAUDE / AGENTS …）
 * 目录名和文件名都不区分大小写，所以 Vault-Scripts、Readme.md 同样会被排除。
 */
const EXCLUDED_DIR_NAMES = new Set([
  // AI / 编辑器 / 版本控制的工作目录
  ".git",
  ".github",
  ".gitee",
  ".obsidian",
  ".trash",
  ".claude",
  ".cursor",
  ".codex",
  ".trae",
  ".aider",
  ".continue",
  ".windsurf",
  ".cline",
  ".roo",
  ".vscode",
  ".idea",
  ".specstory",
  // 脚本 / 依赖 / 构建产物
  "vault-scripts",
  "node_modules",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv"
]);

const EXCLUDED_FILE_NAMES = new Set([
  // 仓库说明类
  "readme",
  "license",
  "licence",
  "changelog",
  "contributing",
  "code_of_conduct",
  "security",
  // AI 代理 / 编辑器说明文件（CLAUDE.md、AGENTS.md、GEMINI.md …）
  "claude",
  "agents",
  "agent",
  "gemini",
  "copilot",
  "cursor",
  "windsurf",
  "cline",
  "aider",
  "roo",
  // 构建 / 包管理说明
  "package",
  "package-lock",
  "pnpm-lock",
  "yarn",
  "makefile",
  "dockerfile",
  "install",
  "api",
  // 系统垃圾文件
  "thumbs",
  "desktop"
]);

function isIgnoredPath(filePath) {
  const parts = String(filePath || "").split("/");
  if (!parts.length) return false;
  if (parts.some((part) => part.startsWith("."))) return true;
  const dirs = parts.slice(0, -1).map((p) => p.toLowerCase());
  if (dirs.some((d) => EXCLUDED_DIR_NAMES.has(d))) return true;
  const base = parts[parts.length - 1];
  const name = base.replace(/\.[^.]+$/, "").toLowerCase();
  return EXCLUDED_FILE_NAMES.has(name);
}

// 文件夹名与模块名保持同一个规则，避免「模块叫 A、目录叫 B」的偏差
function sanitizeFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/, "")
    .replace(/^\/+|\/+$/g, "");
}

// 给工具 / AI / 构建用的目录（vault-scripts、node_modules、.claude …）不当作模块
function isToolFolder(path) {
  const dir = String(path || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!dir) return false;
  return dir.split("/").some((part) => EXCLUDED_DIR_NAMES.has(part));
}

const DEFAULT_MODULES = [
  {
    id: "learning",
    name: "学习提升",
    icon: "graduation-cap",
    module: "learning",
    types: ["topic", "course", "lesson"],
    keywords: ["学习", "课程", "专题", "知识"]
  },
  {
    id: "reading",
    name: "读书阅览",
    icon: "book-open",
    module: "reading",
    types: ["book", "highlight"],
    folder: "Clippings",
    keywords: ["读书", "阅读", "书摘", "书评", "摘录"]
  },
  {
    id: "media",
    name: "自媒体创作",
    icon: "pen-line",
    module: "media",
    types: ["idea", "script", "post"],
    keywords: ["自媒体", "创作", "选题", "脚本", "公众号", "视频"]
  },
  {
    id: "invest",
    name: "投资学习",
    icon: "trending-up",
    module: "invest",
    types: ["company", "investment", "thesis"],
    keywords: ["投资", "理财", "公司", "行业", "财报"]
  },
  {
    id: "writing",
    name: "文章写作",
    icon: "file-text",
    module: "writing",
    types: ["article", "draft"],
    keywords: ["写作", "文章", "草稿", "长文"]
  }
];

const DEFAULT_SETTINGS = {
  modules: DEFAULT_MODULES,
  focusOnOpen: false,
  workspaceName: "个人工作台",
  navCollapsed: false,
  // 上次退出时卡片笔记右侧栏是否开着，用于重启后恢复
  collisSidebarOpen: false,
  // 用户点过“忽略”的未知 module 值，避免同一提示反复出现
  ignoredModuleValues: [],
  // 收件箱策略：root = 只收库根目录里散落的文件；unassigned / all 作为后续扩展接口
  inboxPolicy: "root",
  // 已从导航删除、但文件仍保留在磁盘上的文件夹模块
  hiddenModuleFolders: [],
  // 素材归属表：路径 -> 模块 id。
  // 素材没有 frontmatter，归入模块后靠这张表记住归属；
  // 收件箱据此判断是否已处理，模块页据此决定素材属于谁。
  inboxAssigned: {}
};

const ACTIVE_STATUSES = [
  "active",
  "reading",
  "draft",
  "idea",
  "doing",
  "in-progress",
  "进行中",
  "在读",
  "草稿"
];

function getFm(app, file) {
  try {
    const cache = app.metadataCache.getFileCache(file);
    return (cache && cache.frontmatter) || {};
  } catch (e) {
    return {};
  }
}

function getTags(fm) {
  let tags = fm && fm.tags;
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).replace(/^#/, "")).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, ""))
      .filter(Boolean);
  }
  return [];
}

function formatTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
  const d = new Date(ts);
  return d.getMonth() + 1 + "-" + d.getDate();
}

/** 把模块色（#rrggbb）转成带透明度的 rgba，供首页彩色底纹使用。 */
function hmRgba(hex, alpha) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return "rgba(255,255,255," + alpha + ")";
  const n = parseInt(value, 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
}

function statusClass(status) {
  const v = String(status || "").toLowerCase();
  if (["done", "published", "finished", "已读", "已发布", "完成", "归档"].includes(v)) {
    return "cl-done";
  }
  if (["reading", "active", "draft", "doing", "in-progress", "进行中", "在读", "草稿"].includes(v)) {
    return "cl-reading";
  }
  if (["want", "todo", "planned", "想读", "计划中", "待办"].includes(v)) {
    return "cl-want";
  }
  return "cl-pause";
}

function isContentFile(file) {
  return !isIgnoredPath(file.path);
}

/* ---------------- 网格缩略图工具 ----------------
 * 收件箱和模块页共用同一套缩略图规则：
 *   - 图片铺真实图片；
 *   - 视频显示首帧 + 播放角标；
 *   - 笔记读取正文，优先展示内嵌的图片 / 视频，否则展示正文片段；
 *   - 音频 / 文档 / 其他交给调用方渲染类型图标。
 */
const THUMB_IMAGE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif", "ico", "tif", "tiff"
]);
const THUMB_VIDEO_EXT = new Set([
  "mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpeg", "mpg"
]);
const THUMB_AUDIO_EXT = new Set([
  "mp3", "wav", "m4a", "ogg", "flac", "aac", "opus", "wma", "aiff"
]);
const THUMB_DOC_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "epub", "odt", "ods", "odp", "rtf", "txt"
]);
const THUMB_KIND_LABELS = {
  note: "笔记",
  image: "图片",
  video: "视频",
  audio: "音频",
  doc: "文档",
  other: "文件"
};

function fileKind(file) {
  const ext = String((file && file.extension) || "").toLowerCase();
  if (ext === "md") return "note";
  if (THUMB_IMAGE_EXT.has(ext)) return "image";
  if (THUMB_VIDEO_EXT.has(ext)) return "video";
  if (THUMB_AUDIO_EXT.has(ext)) return "audio";
  if (THUMB_DOC_EXT.has(ext)) return "doc";
  return "other";
}

// 去掉 note 的 frontmatter，只留正文
function stripNoteBody(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return fm ? text.slice(fm[0].length) : text;
}

// 正文片段：去掉代码块、嵌入、链接、标题、列表、强调符后压成一段纯文本
function noteSnippet(body) {
  let text = String(body || "");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/!\[\[[^\]]*\]\]/g, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, path, alias) => alias || path);
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/^[ \t]*([-*+]|\d+\.)[ \t]+/gm, "");
  text = text.replace(/[*_~`]/g, "");
  text = text.replace(/\|/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 220);
}

// 从正文里找第一个能解析到本地文件的图片 / 视频嵌入
function findNoteMedia(app, body, sourcePath) {
  const re = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  let m;
  while ((m = re.exec(body))) {
    let link = String(m[1] || m[2] || "").trim();
    if (!link) continue;
    if (m[2]) {
      try {
        link = decodeURI(link);
      } catch (e) {
        // 保持原样
      }
    }
    let target = null;
    try {
      target = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
    } catch (e) {
      target = null;
    }
    if (!target) continue;
    const kind = fileKind(target);
    if (kind === "image" || kind === "video") return { file: target, kind };
  }
  return null;
}

function paintMediaThumb(app, thumb, file, kind) {
  let src = "";
  try {
    src = app.vault.getResourcePath(file) || "";
  } catch (e) {
    src = "";
  }
  if (!src) return false;
  thumb.addClass("cl-md-thumb-media");
  if (kind === "image") {
    const img = thumb.createEl("img", { cls: "cl-md-media" });
    img.setAttribute("alt", file.basename);
    img.setAttribute("loading", "lazy");
    img.onerror = () => {
      img.remove();
      thumb.removeClass("cl-md-thumb-media");
      setIcon(thumb, "image");
    };
    img.setAttribute("src", src);
    return true;
  }
  if (kind === "video") {
    const video = thumb.createEl("video", { cls: "cl-md-media" });
    video.setAttribute("preload", "metadata");
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.onerror = () => {
      video.remove();
      thumb.removeClass("cl-md-thumb-media");
      setIcon(thumb, "video");
    };
    // #t=0.1 让浏览器把第一帧解出来，否则某些视频只显示黑底
    video.setAttribute("src", src + "#t=0.1");
    const play = thumb.createDiv({ cls: "cl-md-play" });
    setIcon(play, "play");
    return true;
  }
  thumb.removeClass("cl-md-thumb-media");
  return false;
}

function paintNoteThumb(app, thumb, file) {
  app.vault.cachedRead(file).then((raw) => {
    // 渲染期间可能已切页 / 重渲染，丢弃过期的异步结果
    if (!thumb.isConnected) return;
    const body = stripNoteBody(raw);
    const media = findNoteMedia(app, body, file.path);
    if (media && paintMediaThumb(app, thumb, media.file, media.kind)) return;
    const snippet = noteSnippet(body);
    if (!snippet) {
      setIcon(thumb, "file-text");
      return;
    }
    thumb.addClass("cl-md-thumb-note");
    thumb.createDiv({ cls: "cl-md-snippet", text: snippet });
  }).catch(() => {
    if (thumb.isConnected) setIcon(thumb, "file-text");
  });
}

/* ---------------- 提示框去重：只保留 Obsidian 的黑色提示框 ----------------
 * 根因（已核对 Obsidian 核心 obsidian.asar）：
 *   - Obsidian 的黑色 .tooltip 由核心读取 aria-label 生成（setTooltip 只写
 *     aria-label，从不写 title；触发函数也只读 aria-label）。
 *   - 浏览器 / Electron 的原生白色提示框读取 title 属性生成。
 *   - Obsidian 核心不会移除 title，所以一个元素同时有 aria-label 和 title
 *     时，悬停就会同时冒出黑、白两个提示框。
 * Collis 的功能按钮（回看 / 筛选 / 更多 / 卡片右上角 ··· / 侧栏
 * Collis 视图等）恰好同时写了这两个属性。这里把本插件视图内所有 title
 * 统一转成 aria-label：已有 aria-label 的只删 title（保留黑色提示文案），
 * 只有 title 的把文案搬到 aria-label 再删 title。作用域严格限定在本插件
 * 的视图容器内，不碰 Obsidian 核心和其他插件。
 */
const WB_TOOLTIP_SCOPE = [
  ".collis-view",
  ".qm-view",
  ".qm-root",
  ".collis-board-leaf",
  ".collis-board-host",
  ".collis-board",
  ".cl-root",
  ".vw-frame",
  ".collis-doctor-content",
  ".collis-export-content",
  ".collis-ai-modal",
  ".collis-settings"
].join(",");

function wbInTooltipScope(el) {
  try {
    return !!(el && el.closest && el.closest(WB_TOOLTIP_SCOPE));
  } catch (e) {
    return false;
  }
}

function wbNormalizeTitle(el) {
  if (!el || el.nodeType !== 1 || !el.hasAttribute || !el.hasAttribute("title")) return;
  if (!wbInTooltipScope(el)) return;
  const t = el.getAttribute("title") || "";
  if (!el.hasAttribute("aria-label")) {
    // 原本只有 title：把提示文案搬到 aria-label，并标记是我们派生的，
    // 之后若 title 被代码原地更新，aria-label 也跟着同步。
    el.setAttribute("aria-label", t);
    el.setAttribute("data-cl-tt", "1");
  } else if (el.getAttribute("data-cl-tt") === "1") {
    el.setAttribute("aria-label", t);
  }
  // 已有自己 aria-label 的元素（如回看按钮 aria-label="回看"）不动其文案，
  // 只删掉 title，黑色提示框保持原样。
  el.removeAttribute("title");
}

function wbNormalizeTree(root) {
  if (!root || root.nodeType !== 1) return;
  wbNormalizeTitle(root);
  const list = root.querySelectorAll("[title]");
  for (let i = 0; i < list.length; i++) wbNormalizeTitle(list[i]);
}

/** 把菜单精确锚定到按钮正下方：紧贴按钮底边；菜单会盖住按钮不溢出。
 *  showAtPosition 在有 transform/缩放的容器里坐标会偏，且右侧按钮默认左对齐会把
 *  菜单顶出屏幕——这里渲染后按真实宽度重算 left，右侧放不下就右对齐。 */
function anchorMenuBelow(menu, anchor) {
  if (!anchor || typeof anchor.getBoundingClientRect !== "function") {
    menu.showAtPosition({ x: 8, y: 8 });
    return;
  }
  const rect = anchor.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom });
  const dom = menu.dom;
  if (dom) {
    const mw = dom.offsetWidth;
    const vw = window.innerWidth;
    let left = rect.left;
    if (left + mw > vw - 4) left = Math.max(4, rect.right - mw);
    dom.style.left = Math.round(left) + "px";
    dom.style.top = Math.round(rect.bottom) + "px";
  }
}

const MODULE_ICONS = [
  "file-text",
  "graduation-cap",
  "book-open",
  "pen-line",
  "trending-up",
  "briefcase",
  "code",
  "flask-conical",
  "palette",
  "music",
  "camera",
  "heart",
  "dumbbell",
  "home",
  "map",
  "coffee"
];

const MODULE_COLORS = [
  "#7c6df2",
  "#3f9c6d",
  "#d9834a",
  "#3f7fd1",
  "#c2568a",
  "#8a6d3b"
];

/* 逐级建目录，父级不存在时一并补上；创建后文件树会自动出现。
 * 放在顶层，供各个视图/弹窗共用，避免某个类里漏定义直接报 is not a function。 */
async function ensureVaultFolder(app, path) {
  const parts = String(path || "").split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? cur + "/" + part : part;
    const found = app.vault.getAbstractFileByPath(cur);
    if (!found) await app.vault.createFolder(cur);
    else if (!Array.isArray(found.children)) throw new Error("「" + cur + "」已被同名文件占用");
  }
  return cur;
}

/* 模块的唯一标识：优先 id，其次旧字段 module / name。
 * 归属表、frontmatter、导航都用它，避免各处取值顺序不一致。 */
function moduleIdOf(mod) {
  return String((mod && (mod.id || mod.module || mod.name)) || "").trim();
}

/* 模块编辑器：名称 / 图标 / 颜色 / 文件夹。
 * 保存时会把模块文件夹同步创建到文件树；删除模块只删配置，不动笔记文件。 */
class ModuleEditorModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.module = this.options.module || null;
    this.initialName = this.options.initialName || "";
    this.icon = (this.module && this.module.icon) || MODULE_ICONS[0];
    this.color = (this.module && this.module.color) || this.options.initialColor || MODULE_COLORS[0];
    this.deleteArmed = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: this.module ? "编辑模块" : "新建模块" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "模块就是文件夹：保存时会同步在文件树里创建对应目录，模块内容只认这个目录里的文件。"
    });

    let name = this.module ? this.module.name || "" : this.initialName;
    let folder = (this.module && this.module.folder) || "";

    new Setting(contentEl)
      .setName("名称")
      .setDesc("显示在导航里的名字")
      .addText((t) =>
        t
          .setValue(name)
          .setPlaceholder("例如：健身记录")
          .onChange((v) => {
            name = v;
          })
      );

    const iconRow = contentEl.createDiv({ cls: "cl-modalfield" });
    iconRow.createDiv({ cls: "cl-modalfield-label", text: "图标" });
    const iconGrid = iconRow.createDiv({ cls: "cl-iconpick" });
    const iconButtons = [];
    MODULE_ICONS.forEach((name2) => {
      const btn = iconGrid.createDiv({
        cls: "cl-iconpick-item" + (name2 === this.icon ? " is-active" : "")
      });
      setIcon(btn, name2);
      btn.onclick = () => {
        this.icon = name2;
        iconButtons.forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
      };
      iconButtons.push(btn);
    });

    const colorRow = contentEl.createDiv({ cls: "cl-modalfield" });
    colorRow.createDiv({ cls: "cl-modalfield-label", text: "颜色" });
    const swatches = colorRow.createDiv({ cls: "cl-colorpick" });
    const colorDots = [];
    MODULE_COLORS.forEach((color) => {
      const dot = swatches.createDiv({
        cls: "cl-colorpick-dot" + (color === this.color ? " is-active" : "")
      });
      dot.style.setProperty("--dot-color", color);
      dot.onclick = () => {
        this.color = color;
        colorDots.forEach((d) => d.removeClass("is-active"));
        dot.addClass("is-active");
      };
      colorDots.push(dot);
    });

    let folderInput = null;
    new Setting(contentEl)
      .setName("模块文件夹")
      .setDesc("保存时自动创建。不填则用模块名；填写多级路径（如 媒体文件/客户）也可以。")
      .addText((t) => {
        folderInput = t;
        t.setValue(folder)
          .setPlaceholder("未选择")
          .onChange((v) => {
            folder = v;
          });
      })
      .addButton((b) => {
        b.setButtonText("选择").onClick(() => {
          new FolderPickerModal(this.app, {
            current: String(folder || "").trim(),
            onPick: (path) => {
              folder = path;
              if (folderInput) folderInput.setValue(path);
            }
          }).open();
        });
      });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });

    if (this.module && this.options.onDelete) {
      const del = foot.createEl("button", { cls: "cl-btn cl-btn-danger", text: "删除模块" });
      del.onclick = () => {
        if (!this.deleteArmed) {
          this.deleteArmed = true;
          del.setText("再点一次确认删除");
          setTimeout(() => {
            this.deleteArmed = false;
            del.setText("删除模块");
          }, 3000);
          return;
        }
        this.close();
        this.options.onDelete(this.module);
      };
    }

    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();

    const save = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "保存" });
    save.onclick = () => {
      const finalName = String(name || "").trim();
      if (!finalName) {
        new Notice("请先填写模块名称");
        return;
      }
      // 模块 = 文件夹：文件夹可以不存在，保存时统一创建（见 onSave）
      const folderValue = String(folder || "")
        .trim()
        .replace(/^\/+|\/+$/g, "");
      const id = this.module && this.module.id ? this.module.id : "mod-" + Date.now().toString(36);
      const next = Object.assign({}, this.module || {}, {
        id,
        module: this.module && this.module.module ? this.module.module : id,
        name: finalName,
        icon: this.icon,
        color: this.color,
        folder: folderValue || sanitizeFolderName(finalName)
      });
      this.close();
      if (this.options.onSave) this.options.onSave(next);
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 删除确认：收集箱里的笔记和附件都走这里，先确认再移入回收站。 */
class DeleteFilesModal extends Modal {
  constructor(app, files, onConfirm) {
    super(app);
    this.files = files || [];
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", {
      text: this.files.length === 1 ? "删除这个文件？" : "删除这 " + this.files.length + " 个文件？"
    });
    const names = this.files.slice(0, 3).map((f) => f.basename).join("、");
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text:
        this.files.length > 3
          ? "会移到系统回收站：" + names + " 等 " + this.files.length + " 个文件。"
          : "会移到系统回收站：" + names + "。"
    });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();
    const remove = foot.createEl("button", { cls: "cl-btn cl-btn-danger", text: "删除" });
    remove.onclick = () => {
      this.close();
      if (this.onConfirm) this.onConfirm();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 删除模块确认：说明会把文件和子文件夹上移一级，再清掉空文件夹。 */
class DissolveModuleModal extends Modal {
  constructor(app, info, onConfirm) {
    super(app);
    this.info = info || {};
    this.onConfirm = onConfirm;
  }

  finish(value) {
    const callback = this.onConfirm;
    this.onConfirm = null;
    if (callback) callback(value);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "删除模块「" + (this.info.name || "") + "」？" });

    const parts = [];
    if (this.info.fileCount) parts.push(this.info.fileCount + " 个文件");
    if (this.info.folderCount) parts.push(this.info.folderCount + " 个子文件夹");
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: parts.length
        ? "会把 " + parts.join("、") + " 上移到「" + (this.info.parentLabel || "上一级") +
          "」，然后删除空的模块文件夹。不会删除任何笔记内容。"
        : "这个模块文件夹是空的，会直接移除模块并删除空文件夹。"
    });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => {
      this.finish(false);
      this.close();
    };
    const ok = foot.createEl("button", { cls: "cl-btn cl-btn-danger", text: "上移并删除模块" });
    ok.onclick = () => {
      this.finish(true);
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
    this.finish(false);
  }
}

/* 重命名模块：同时重命名文件树里的文件夹，保持两者一致。 */
class RenameModuleModal extends Modal {
  constructor(app, name, onSubmit) {
    super(app);
    this.name = name || "";
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "重命名模块" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "会同步重命名文件树中的文件夹，模块里的笔记和子模块会一起改名。"
    });

    let value = this.name;
    let inputEl = null;
    new Setting(contentEl).setName("新名称").addText((text) => {
      text.setValue(this.name).onChange((next) => {
        value = next;
      });
      inputEl = text.inputEl;
      inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit(value);
        }
      });
    });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();
    const ok = foot.createEl("button", { cls: "cl-btn mod-cta", text: "重命名" });
    ok.onclick = () => this.submit(value);
    window.setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 0);
  }

  submit(value) {
    const callback = this.onSubmit;
    this.onSubmit = null;
    if (callback) callback(String(value || "").trim());
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 选择保存文件夹：可以挑已有的目录，也可以直接新建一个。 */
class FolderPickerModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
  }

  listFolders() {
    const out = [];
    const walk = (folder) => {
      for (const child of folder.children || []) {
        if (!Array.isArray(child.children)) continue;
        if (!isIgnoredPath(child.path + "/")) out.push(child.path);
        walk(child);
      }
    };
    const root = this.app.vault.getRoot();
    if (root) walk(root);
    return out.sort((a, b) => a.localeCompare(b, "zh"));
  }

  // 逐级建目录，父级不存在时一并补上；创建后文件树会自动出现
  async ensureFolder(path) {
    return ensureVaultFolder(this.app, path);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "选择保存文件夹" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "选一个已有的文件夹，或点下面的「新建文件夹」直接建一个。"
    });

    const pickWrap = contentEl.createDiv();
    const input = pickWrap.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: "筛选文件夹…" }
    });
    const listEl = pickWrap.createDiv({ cls: "cl-picklist" });
    const empty = pickWrap.createDiv({ cls: "cl-modal-hint" });

    const folders = this.listFolders();
    const draw = () => {
      const q = String(input.value || "").trim().toLowerCase();
      const rows = folders.filter((p) => !q || p.toLowerCase().includes(q));
      listEl.empty();
      empty.setText(
        folders.length ? "没有匹配的文件夹。" : "库里还没有文件夹，点下面的「新建文件夹」建一个。"
      );
      empty.toggle(rows.length === 0);
      rows.forEach((path) => {
        const row = listEl.createDiv({ cls: "cl-pickitem" });
        if (path === this.options.current) row.addClass("is-active");
        const icon = row.createDiv({ cls: "cl-pickicon" });
        setIcon(icon, "folder");
        row.createDiv({ cls: "cl-pickname", text: path });
        row.onclick = () => {
          this.close();
          if (this.options.onPick) this.options.onPick(path);
        };
      });
    };
    input.addEventListener("input", draw);
    draw();

    // 新建文件夹：内联展开，创建成功后直接选中它的路径
    const form = contentEl.createDiv({ cls: "cl-foldernew is-hidden" });
    form.createDiv({ cls: "cl-modalfield-label", text: "新文件夹路径" });
    const nameInput = form.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: "例如：01-Notes 或 10-Modules/健身记录" }
    });
    form.createDiv({
      cls: "cl-modal-hint",
      text: "支持多级路径，创建后会立即出现在 Obsidian 文件树里。"
    });
    const formFoot = form.createDiv({ cls: "cl-modalfoot" });
    const backBtn = formFoot.createEl("button", { cls: "cl-btn", text: "返回" });
    const okBtn = formFoot.createEl("button", {
      cls: "cl-btn cl-btn-accent",
      text: "创建并使用"
    });

    const showForm = (on) => {
      form.classList.toggle("is-hidden", !on);
      pickWrap.classList.toggle("is-hidden", on);
      if (on) nameInput.focus();
    };
    backBtn.onclick = () => showForm(false);

    okBtn.onclick = async () => {
      const value = String(nameInput.value || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      if (!value) {
        new Notice("请输入文件夹名称");
        return;
      }
      if (value.split("/").some((part) => !part || part === "." || part === "..")) {
        new Notice("路径不合法，请重新填写");
        return;
      }
      const found = this.app.vault.getAbstractFileByPath(value);
      if (found && !Array.isArray(found.children)) {
        new Notice("「" + value + "」已被同名文件占用");
        return;
      }
      if (!found) {
        try {
          await this.ensureFolder(value);
        } catch (error) {
          new Notice("创建失败：" + (error && error.message ? error.message : error));
          return;
        }
      }
      this.close();
      if (this.options.onPick) this.options.onPick(value);
    };
    nameInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") okBtn.click();
    });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const create = foot.createEl("button", {
      cls: "cl-btn cl-btn-accent cl-foldernew-btn",
      text: "新建文件夹"
    });
    create.onclick = () => {
      showForm(true);
      nameInput.focus();
    };
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 归入模块：选一个模块，把选中的笔记和素材一起移到该模块的目录。 */
class ModulePickerModal extends Modal {
  constructor(app, modules, onPick, onCreate) {
    super(app);
    this.modules = modules || [];
    this.onPick = onPick;
    this.onCreate = onCreate;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "归入模块" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "选中的文件会移动到该模块的保存文件夹，并记录归属；笔记同时写入 module 字段。多个模块共用同一文件夹时会自动放进该模块的子目录。"
    });

    const list = contentEl.createDiv({ cls: "cl-picklist" });
    this.modules.forEach((mod) => {
      const item = list.createDiv({ cls: "cl-pickitem" });
      const iconEl = item.createDiv({ cls: "cl-pickicon" });
      iconEl.style.setProperty("--dot-color", mod.color || "var(--interactive-accent)");
      setIcon(iconEl, mod.icon || "file-text");
      item.createDiv({ cls: "cl-pickname", text: mod.name });
      item.onclick = () => {
        this.close();
        if (this.onPick) this.onPick(mod);
      };
    });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const create = foot.createEl("button", { cls: "cl-btn", text: "新建模块…" });
    create.onclick = () => {
      this.close();
      if (this.onCreate) this.onCreate();
    };
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 管理模块：按文件树层级展示，每一级都可以编辑或删除。
 * 删除会把该层的文件和子文件夹整体上移一级，再移除空文件夹。 */
class ModuleManagerModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.expanded = new Set();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "管理模块" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "按文件树层级展示。删除模块时，里面的文件和子文件夹会整体上移一级，不会删除任何内容。"
    });

    this.listEl = contentEl.createDiv({ cls: "cl-picklist cl-modtree" });
    this.renderList();

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const create = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "新建模块" });
    create.onclick = () => {
      this.close();
      if (this.options.onCreate) this.options.onCreate();
    };
    const close = foot.createEl("button", { cls: "cl-btn", text: "关闭" });
    close.onclick = () => this.close();
  }

  renderList() {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const roots = this.options.getRootModules ? this.options.getRootModules() : [];
    if (!roots.length) {
      list.createDiv({ cls: "cl-modal-hint", text: "还没有模块，点下面的「新建模块」。" });
      return;
    }
    // 默认全部收起，和导航保持一致，点箭头才展开
    const all = this.options.getAllModules ? this.options.getAllModules() : roots;

    const draw = (mod, depth) => {
      const key = moduleIdOf(mod);
      const children = this.options.getChildren ? this.options.getChildren(mod) : [];
      const isOpen = this.expanded.has(key);

      const row = list.createDiv({ cls: "cl-modrow" });
      row.style.paddingLeft = 8 + depth * 18 + "px";

      const toggle = row.createDiv({ cls: "cl-modrow-toggle" });
      if (children.length) {
        setIcon(toggle, isOpen ? "chevron-down" : "chevron-right");
        toggle.onclick = () => {
          if (isOpen) this.expanded.delete(key);
          else this.expanded.add(key);
          this.renderList();
        };
      } else {
        toggle.addClass("is-blank");
      }

      // 图标与颜色完全对齐左侧导航：一样的默认图标、一样的预设色板
      const iconEl = row.createDiv({ cls: "cl-pickicon" });
      const index = all.indexOf(mod);
      const tint = index >= 0 ? index % 5 : depth % 5;
      iconEl.addClass("cl-tint-" + tint);
      iconEl.style.setProperty("--dot-color", mod.color || "var(--tint)");
      setIcon(iconEl, mod.icon || (children.length ? "folder" : "file-text"));

      const main = row.createDiv({ cls: "cl-modrow-main" });
      main.createDiv({ cls: "cl-modrow-name", text: mod.name });
      const folder = this.options.getFolder ? this.options.getFolder(mod) : mod.folder || "";
      if (folder) main.createDiv({ cls: "cl-modrow-path", text: folder });

      const edit = row.createEl("button", { cls: "cl-btn", text: "编辑" });
      edit.onclick = () => {
        this.close();
        if (this.options.onEdit) this.options.onEdit(mod);
      };

      const del = row.createEl("button", { cls: "cl-btn cl-btn-danger", text: "删除" });
      del.onclick = async () => {
        if (!this.options.onDissolve) return;
        await this.options.onDissolve(mod);
        this.renderList();
      };

      if (children.length && isOpen) children.forEach((child) => draw(child, depth + 1));
    };

    roots.forEach((mod) => draw(mod, 0));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 轻量命名弹窗：新建子模块这类只需要一个名字的操作。 */
class NamePromptModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: this.options.title || "新建" });
    if (this.options.hint) {
      contentEl.createDiv({ cls: "cl-modal-hint", text: this.options.hint });
    }
    const input = contentEl.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: this.options.placeholder || "请输入名称" }
    });

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();
    const ok = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "创建" });
    ok.onclick = () => {
      const value = String(input.value || "").trim();
      if (!value) {
        new Notice("请输入名称");
        input.focus();
        return;
      }
      this.close();
      if (this.options.onSubmit) this.options.onSubmit(value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") ok.click();
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* 归入文件：从库里挑笔记，移进当前模块（写 module 字段并移动文件）。 */
class AddFilesModal extends Modal {
  constructor(app, files, onConfirm) {
    super(app);
    this.files = files || [];
    this.onConfirm = onConfirm;
    this.selected = new Set();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "归入文件" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "勾选要移进当前模块的笔记，确认后会写入 module 字段并移动到模块文件夹。"
    });

    const filter = contentEl.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: "筛选标题或路径…" }
    });
    const list = contentEl.createDiv({ cls: "cl-picklist" });
    const empty = contentEl.createDiv({ cls: "cl-modal-hint" });

    const draw = () => {
      const q = String(filter.value || "").trim().toLowerCase();
      const rows = this.files.filter((f) => !q || f.path.toLowerCase().includes(q));
      list.empty();
      empty.setText(this.files.length ? "没有匹配的笔记。" : "库里没有可归入的笔记。");
      empty.toggle(rows.length === 0);
      rows.forEach((file) => {
        const row = list.createDiv({ cls: "cl-pickitem" });
        const box = row.createEl("input", { attr: { type: "checkbox" } });
        box.checked = this.selected.has(file.path);
        box.onclick = (event) => {
          event.stopPropagation();
          if (box.checked) this.selected.add(file.path);
          else this.selected.delete(file.path);
        };
        row.createDiv({ cls: "cl-pickname", text: file.path });
        row.onclick = () => {
          box.checked = !box.checked;
          if (box.checked) this.selected.add(file.path);
          else this.selected.delete(file.path);
        };
      });
    };
    filter.addEventListener("input", draw);
    draw();

    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "取消" });
    cancel.onclick = () => this.close();
    const ok = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "归入" });
    ok.onclick = () => {
      const chosen = this.files.filter((file) => this.selected.has(file.path));
      if (!chosen.length) {
        new Notice("请先勾选笔记");
        return;
      }
      this.close();
      if (this.onConfirm) this.onConfirm(chosen);
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CollisView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.active = "home";
    this.focus = false;
    this.navCollapsed = !!(plugin && plugin.settings && plugin.settings.navCollapsed);
    this._mdFiles = [];
    this._contentFiles = [];
    this._ownership = null;
    // 视图不可见时收到的刷新请求：先记成脏状态，等切回本视图再真正刷新
    this._needsRefresh = false;
    this.gallery = null;
    this.notes = null;
    // 左侧模块树里手动展开的节点（当前模块的祖先会自动展开，不依赖这里）
    this._navExpanded = new Set();
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Collis";
  }

  getIcon() {
    return PLUGIN_ICON_ID;
  }

  async onOpen() {
    this.containerEl.addClass("collis-view");
    this.contentEl.addClass("cl-content");
    this.render();
    this.watchWidth();
    // 新建笔记会打开一个新标签，本视图随即被隐藏，那时的刷新只能记成脏状态。
    // 从别的标签切回本视图时补一次刷新，列表就能立刻出现新文件。
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf && this._needsRefresh) this.refresh();
      })
    );
  }

  async onClose() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    document.body.classList.remove("collis-focus");
    this.focus = false;
    this.destroyGallery();
    this.destroyNotes();
  }

  /* 侧栏一展开，视图宽度就变，但窗口宽度不变，所以断点必须量视图自身。
     ResizeObserver 盯着视图容器，实时把宽度换算成三档类名和一个留白变量。 */
  watchWidth() {
    if (this._ro) this._ro.disconnect();
    if (typeof ResizeObserver !== "function") return;
    this._ro = new ResizeObserver(() => this.applyLayout());
    this._ro.observe(this.containerEl);
  }

  applyLayout() {
    const app = this.appEl;
    if (!app) return;
    let w = 0;
    try {
      w = this.containerEl.clientWidth || 0;
    } catch (e) {
      w = 0;
    }
    if (w < 40) return;
    app.classList.toggle("is-compact", w < 1120);
    app.classList.toggle("is-mini", w < 940);
    app.classList.toggle("is-nav-collapsed", !!this.navCollapsed);
    // 左右留白跟着宽度连续变化：宽视图 28px，窄视图收到 12px，两边始终对称
    const pad = Math.max(12, Math.min(28, Math.round(w * 0.026)));
    app.style.setProperty("--cl-pad", pad + "px");
  }

  getModules() {
    const list = this.plugin.settings.modules;
    // 空数组是合法状态：用户可以把模块全删掉，不能回落到内置模块
    if (Array.isArray(list)) return list;
    return DEFAULT_MODULES;
  }

  contentFiles() {
    return this._contentFiles.length
      ? this._contentFiles
      : this.app.vault.getMarkdownFiles().filter(isContentFile);
  }

  /* 收件箱 / 模块归属用的全量清单：
   * 整个 vault 的 Markdown 都算，只排除卡片笔记的月度聚合文件。
   * 白板是 .collis，不在 getMarkdownFiles() 里，天然被排除。
   * 不再按顶层文件夹白名单过滤，避免文件在文件树里一挪位置就“消失”。 */
  vaultFiles() {
    return this.app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          !isIgnoredPath(file.path) && !file.path.startsWith(CARD_FOLDER + "/")
      );
  }

  moduleKeys(mod) {
    return [mod.id, mod.module, mod.name]
      .filter(Boolean)
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
  }

  // frontmatter 的 module 字段：英文 id 和中文名都认，数组写法也认。
  explicitModule(fm) {
    const raw = fm ? fm.module : null;
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
    }
    const value = raw === null || raw === undefined ? "" : String(raw).trim().toLowerCase();
    return value ? [value] : [];
  }

  /* 素材归属表只作为「归入」的附加记录（path -> 模块 id）。
   * 模块内容以文件夹为准；这张表服务于后续可切换的 unassigned 收件箱策略。 */
  ownershipMap() {
    const settings = this.plugin.settings;
    if (!settings.inboxAssigned || typeof settings.inboxAssigned !== "object") {
      settings.inboxAssigned = {};
    }
    return settings.inboxAssigned;
  }

  // 模块没有单独设置文件夹时，用模块名建一个同名目录。
  moduleTargetFolder(mod) {
    const raw = String((mod && (mod.folder || mod.name || mod.id || mod.module)) || "").trim();
    return raw.replace(/^\/+|\/+$/g, "").replace(/[\\:*?"<>|]/g, "_");
  }

  // 目标同名时加 -1 / -2，避免覆盖模块目录里已有的文件。
  uniqueFilePath(dir, file) {
    const ext = file.extension ? "." + file.extension : "";
    const name = file.basename || file.name || "未命名";
    const prefix = dir ? dir + "/" : "";
    let path = prefix + name + ext;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = prefix + name + "-" + n + ext;
      n += 1;
    }
    return path;
  }

  /* 模块页收录范围（与 Obsidian 文件树一致）：
   *   - 只认模块文件夹里「直接」存放的文件；
   *   - 子文件夹的内容属于子模块，不向上汇总；
   *   - 不再按 frontmatter / type / 标签猜归属，文件放在哪个文件夹就属于哪个模块。 */
  moduleFiles(mod) {
    return this.folderFiles(this.moduleTargetFolder(mod), false);
  }

  /* 读取文件夹下的直接子文件。folder 不存在时返回空数组，不报错。 */
  folderFiles(dir, includeChildren) {
    const target = String(dir || "").replace(/^\/+|\/+$/g, "");
    if (!target) return [];
    const node = this.app.vault.getAbstractFileByPath(target);
    if (!node || !Array.isArray(node.children)) return [];
    const out = [];
    const walk = (folder) => {
      (folder.children || []).forEach((child) => {
        if (Array.isArray(child.children)) {
          if (includeChildren) walk(child);
          return;
        }
        if (!isIgnoredPath(child.path)) out.push(child);
      });
    };
    walk(node);
    return out;
  }

  /* ---------------- 模块层级（完全跟随文件树） ----------------
   * 模块 = 文件夹；子模块 = 该文件夹下真实存在的直接子文件夹。
   * 不再依赖 settings 里的 parent 字段，文件夹移到哪，层级就跟到哪。
   * 模块页只统计笔记，附件一律不参与计数、也不在模块页展示。 */
  isHiddenModuleFolder(path) {
    const dir = String(path || "").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!dir) return false;
    return (this.plugin.settings.hiddenModuleFolders || []).some(
      (item) => String(item || "").replace(/^\/+|\/+$/g, "").toLowerCase() === dir
    );
  }

  // 只排除工具/AI 目录、速记卡目录和用户手动删掉的目录；
  // 附件、媒体文件夹同样是模块，按文件树正常显示
  isModuleFolderIgnored(path) {
    const dir = String(path || "").replace(/^\/+|\/+$/g, "");
    if (!dir) return true;
    if (dir === CARD_FOLDER) return true;
    if (this.isCanvasModuleFolder(dir)) return true;
    if (isToolFolder(dir)) return true;
    return this.isHiddenModuleFolder(dir);
  }

  /* 画布文件夹归白板工作区使用，不再作为模块出现在导航里。
   * 路径跟随画布子插件的设置，默认「画布」。 */
  isCanvasModuleFolder(path) {
    const folder = this.plugin.canvasFolderPath();
    return String(path || "").replace(/^\/+|\/+$/g, "").toLowerCase() === folder.toLowerCase();
  }

  /* 文件夹 → 模块：优先复用 settings 里的配置（名称/图标/颜色），
   * 没有配置时生成一个临时模块（id = dir:路径），文件树里的文件夹也能直接进入。 */
  moduleForFolder(path) {
    const dir = String(path || "").replace(/^\/+|\/+$/g, "");
    if (!dir) return null;
    if (this.isCanvasModuleFolder(dir)) return null;
    const configured = this.getModules().find(
      (mod) =>
        this.moduleTargetFolder(mod).toLowerCase() === dir.toLowerCase()
    );
    if (configured) return configured;
    if (this.isModuleFolderIgnored(dir)) return null;
    if (!this.app.vault.getAbstractFileByPath(dir)) return null;
    const name = dir.split("/").pop();
    return {
      id: "dir:" + dir,
      module: "dir:" + dir,
      name,
      folder: dir,
      icon: "folder",
      implicit: true
    };
  }

  // 文件属于哪个模块：从文件所在文件夹逐级往上找，命中的最近一层就是归属
  // （包含没写进配置的隐式子文件夹，保证深层笔记也能在首页/归入逻辑里定位）
  moduleForFile(file) {
    if (!file) return null;
    let dir = String(file.path || "").split("/").slice(0, -1).join("/");
    while (dir) {
      const mod = this.moduleForFolder(dir);
      if (mod) return mod;
      dir = dir.split("/").slice(0, -1).join("/");
    }
    return null;
  }

  moduleById(id) {
    const direct = this.getModules().find((mod) => moduleIdOf(mod) === id);
    if (direct) return direct;
    const value = String(id || "");
    if (value.startsWith("dir:")) return this.moduleForFolder(value.slice(4));
    return null;
  }

  submodulesOf(mod) {
    const dir = this.moduleTargetFolder(mod);
    if (!dir) return [];
    const node = this.app.vault.getAbstractFileByPath(dir);
    if (!node || !Array.isArray(node.children)) return [];
    return node.children
      .filter((child) => Array.isArray(child.children))
      .filter((child) => !this.isModuleFolderIgnored(child.path))
      .map((child) => this.moduleForFolder(child.path))
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
  }

  moduleNoteFiles(mod) {
    return this.moduleFiles(mod).filter(
      (file) => String(file.extension || "").toLowerCase() === "md"
    );
  }

  // 含所有后代的笔记数；循环引用时用 visited 兜底，避免死循环
  moduleTreeNoteFiles(mod, visited) {
    const seenIds = visited || new Set();
    const id = moduleIdOf(mod);
    if (!id || seenIds.has(id)) return [];
    seenIds.add(id);
    const out = this.moduleNoteFiles(mod).slice();
    this.submodulesOf(mod).forEach((child) => {
      out.push(...this.moduleTreeNoteFiles(child, seenIds));
    });
    return out;
  }

  /* 导航根节点：没有被别的模块文件夹包含的配置模块。
   * 顶层模块是用户挑出来的「入口」，入口以下则完全镜像文件树。 */
  rootModules() {
    const mods = this.getModules();
    const dirs = mods
      .map((mod) => this.moduleTargetFolder(mod))
      .filter(Boolean);
    return mods.filter((mod) => {
      const dir = this.moduleTargetFolder(mod);
      if (dir && this.isCanvasModuleFolder(dir)) return false;
      if (!dir) return true;
      return !dirs.some((other) => other && other !== dir && dir.startsWith(other + "/"));
    });
  }

  // 从根模块到当前文件夹的链路，用于面包屑和导航展开
  modulePath(mod) {
    const dir = this.moduleTargetFolder(mod);
    if (!dir) return [mod];
    let root = null;
    this.rootModules().forEach((candidate) => {
      const cdir = this.moduleTargetFolder(candidate);
      if (!cdir) return;
      if (dir !== cdir && !dir.startsWith(cdir + "/")) return;
      if (!root || cdir.length > this.moduleTargetFolder(root).length) root = candidate;
    });
    if (!root) return [mod];
    const rootDir = this.moduleTargetFolder(root);
    const chain = [root];
    if (dir !== rootDir) {
      let acc = rootDir;
      dir
        .slice(rootDir.length + 1)
        .split("/")
        .filter(Boolean)
        .forEach((seg) => {
          acc += "/" + seg;
          const node = this.moduleForFolder(acc);
          if (node) chain.push(node);
        });
      const last = chain[chain.length - 1];
      if (last && last.id !== mod.id) chain.push(mod);
    } else if (root.id !== mod.id) {
      chain[0] = mod;
    }
    return chain;
  }

  promptSubmodule(parent) {
    const parentDir = this.moduleTargetFolder(parent);
    new NamePromptModal(this.app, {
      title: "新建子模块",
      hint:
        "会在「" + (parentDir || "库根目录") + "」下新建同名文件夹；子模块跟随文件夹，不会重复存层级配置。",
      placeholder: "例如：客户",
      onSubmit: async (raw) => {
        const name = sanitizeFolderName(raw);
        if (!name) return;
        const dir = parentDir ? parentDir + "/" + name : name;
        // 该文件夹已经有模块配置时直接进入，避免两个模块指向同一个目录
        const existing = this.getModules().find(
          (mod) => this.moduleTargetFolder(mod) === dir
        );
        if (existing) {
          this.go(moduleIdOf(existing));
          return;
        }
        try {
          await ensureVaultFolder(this.app, dir);
        } catch (error) {
          new Notice("创建文件夹失败：" + (error && error.message ? error.message : error));
          return;
        }
        const id = "mod-" + Date.now().toString(36);
        const list = this.getModules().slice();
        list.push({
          id,
          module: id,
          name,
          folder: dir,
          icon: "folder",
          color: parent.color || undefined
        });
        this.plugin.settings.modules = list;
        // 重新建出来的文件夹要能从「已隐藏」里恢复
        this.plugin.settings.hiddenModuleFolders = (
          this.plugin.settings.hiddenModuleFolders || []
        ).filter((path) => path !== dir);
        this._ownership = null;
        await this.plugin.saveSettings();
        this.go(id);
      }
    }).open();
  }

  addFilesToModule(mod) {
    const dir = this.moduleTargetFolder(mod);
    const own = new Set(this.folderFiles(dir, false).map((file) => file.path));
    const candidates = this.app.vault
      .getFiles()
      .filter((file) => !own.has(file.path) && this.isInboxFile(file))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    new AddFilesModal(this.app, candidates, (files) => this.assignToModule(files, mod)).open();
  }

  // 收件箱也收录附件：图片 / 视频 / PDF / 音频等，排除白板和隐藏目录。
  // 只收白名单里的扩展名，白板的历史备份（xxx.volis.json、xxx.collis.bak）
  // 这类复合后缀不会再混进来。
  vaultAttachments() {
    return this.app.vault.getFiles().filter((file) => {
      if (file.extension === "md") return false;
      // 新旧白板与 Obsidian 原生 canvas 都属于画布，不当作附件素材
      if (["collis", "volis", "canvas"].includes(file.extension.toLowerCase())) return false;
      const lower = file.path.toLowerCase();
      if (lower.includes(".volis.") || lower.includes(".collis.")) return false;
      if (!ATTACHMENT_EXTENSIONS.has(file.extension.toLowerCase())) return false;
      return !isIgnoredPath(file.path);
    });
  }

  /* 收件箱策略接口：
   *   root       —— 默认。只收库根目录下散落的文件（不在任何文件夹里的）；
   *   unassigned —— 旧口径：按 frontmatter module 是否已归属来判断；
   *   all        —— 全库文件。
   * 后续要改规则，只改 inboxPolicy 的返回值和对应分支即可。 */
  inboxPolicy() {
    const value = String(this.plugin.settings.inboxPolicy || "").toLowerCase();
    return value === "unassigned" || value === "all" ? value : "root";
  }

  // 库根目录文件：路径里没有 "/"（也就是不在任何文件夹里）
  rootFiles() {
    return this.app.vault.getFiles().filter((file) => String(file.path).indexOf("/") === -1);
  }

  isInboxFile(file) {
    if (!file) return false;
    const ext = String(file.extension || "").toLowerCase();
    if (["collis", "volis", "canvas"].includes(ext)) return false;
    const lower = file.path.toLowerCase();
    if (lower.includes(".volis.") || lower.includes(".collis.")) return false;
    if (isIgnoredPath(file.path)) return false;
    if (file.path.startsWith(CARD_FOLDER + "/")) return false;
    return true;
  }

  inboxFiles() {
    const policy = this.inboxPolicy();

    if (policy === "root") {
      // 与文件树一致：只看根目录里没被文件夹收走的文件，
      // 不再关心 frontmatter / 附件归属表。
      return this.rootFiles()
        .filter((file) => this.isInboxFile(file))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    if (policy === "all") {
      return this.app.vault
        .getFiles()
        .filter((file) => this.isInboxFile(file))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    // unassigned：保留旧口径，方便以后切回“按归属判断”
    const md = this.vaultFiles();
    const known = new Set();
    this.getModules().forEach((mod) => {
      this.moduleKeys(mod).forEach((k) => known.add(k));
    });
    const pending = md.filter((file) => {
      const explicit = this.explicitModule(getFm(this.app, file));
      if (!explicit.length) return true;
      return !explicit.some((v) => known.has(v));
    });
    const assigned = this.ownershipMap();
    const attachments = this.vaultAttachments().filter((file) => {
      const owner = assigned[file.path];
      return !(owner && known.has(String(owner).trim().toLowerCase()));
    });
    return pending
      .concat(attachments)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  // 文件里写了 module，但没有任何模块配置认领这个值（且用户没点过忽略）。
  unknownModuleValues() {
    const known = new Set();
    this.getModules().forEach((mod) => this.moduleKeys(mod).forEach((k) => known.add(k)));
    const ignored = new Set(
      (this.plugin.settings.ignoredModuleValues || []).map((v) => String(v).toLowerCase())
    );
    const groups = new Map();
    for (const file of this.vaultFiles()) {
      const values = this.explicitModule(getFm(this.app, file));
      values.forEach((value) => {
        if (known.has(value) || ignored.has(value)) return;
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(file);
      });
    }
    return groups;
  }

  openFile(file) {
    if (!file) return;
    this.app.workspace.getLeaf("tab").openFile(file);
  }

  /* 删除模块只删配置，不动磁盘文件。
   * 文件夹还在，所以要记进 hiddenModuleFolders，否则会被当成隐式模块又冒出来。 */
  async removeModuleConfig(target) {
    const folder = this.moduleTargetFolder(target);
    const list = this.getModules().filter((m) => m.id !== target.id);
    this.plugin.settings.modules = list;
    if (folder && !list.some((m) => this.moduleTargetFolder(m) === folder)) {
      const hidden = new Set(this.plugin.settings.hiddenModuleFolders || []);
      hidden.add(folder);
      this.plugin.settings.hiddenModuleFolders = Array.from(hidden);
    }
    if (this.active === target.id) this.active = "home";
    this._ownership = null;
    await this.plugin.saveSettings();
  }

  // 上移时遇到同名文件/文件夹就加序号，绝不覆盖已有内容
  uniqueVaultPath(parentPath, name, isFolder) {
    const base = parentPath ? parentPath + "/" : "";
    const text = String(name || "");
    const dot = isFolder ? -1 : text.lastIndexOf(".");
    const stem = dot > 0 ? text.slice(0, dot) : text;
    const ext = dot > 0 ? text.slice(dot) : "";
    let candidate = base + text;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = base + stem + " (" + index + ")" + ext;
      index += 1;
    }
    return candidate;
  }

  /* 删除模块 = 把这一层溶解到上一级：
   * 直接文件与子文件夹整体上移，再移除模块配置并清掉空文件夹。不删除任何内容。 */
  async dissolveModule(target) {
    const folder = this.moduleTargetFolder(target);
    if (!folder) return;
    const node = this.app.vault.getAbstractFileByPath(folder);
    const parentPath = folder.indexOf("/") === -1 ? "" : folder.slice(0, folder.lastIndexOf("/"));
    const parentLabel = parentPath ? parentPath.split("/").pop() : "库根目录";

    // 文件夹已经不存在：只清理配置和隐藏记录
    if (!node || !Array.isArray(node.children)) {
      await this.removeModuleConfig(target);
      new Notice("已移除模块「" + target.name + "」");
      this.render();
      return;
    }

    const children = node.children.slice();
    const files = children.filter((child) => !Array.isArray(child.children));
    const folders = children.filter((child) => Array.isArray(child.children));

    const confirmed = await new Promise((resolve) => {
      new DissolveModuleModal(
        this.app,
        {
          name: target.name,
          parentLabel,
          fileCount: files.length,
          folderCount: folders.length
        },
        resolve
      ).open();
    });
    if (!confirmed) return;

    let movedFiles = 0;
    let movedFolders = 0;
    try {
      for (const child of files) {
        const dest = this.uniqueVaultPath(parentPath, child.name, false);
        await this.app.fileManager.renameFile(child, dest);
        movedFiles += 1;
      }
      for (const child of folders) {
        const oldPath = child.path;
        const dest = this.uniqueVaultPath(parentPath, child.name, true);
        await this.app.fileManager.renameFile(child, dest);
        // 子文件夹里的模块配置跟着换路径，上移后仍然是模块
        this.plugin.remapModuleFolder(oldPath, dest);
        movedFolders += 1;
      }
    } catch (error) {
      new Notice("上移失败：" + (error && error.message ? error.message : error));
      await this.plugin.saveSettings();
      this.render();
      return;
    }

    // 移除这一层的模块配置（子级配置已随目录迁移）
    const remain = this.getModules().filter(
      (mod) => this.moduleTargetFolder(mod).toLowerCase() !== folder.toLowerCase()
    );
    // 迁移过程中文件树事件可能补出自动模块，这里按文件夹去重，优先保留自定义配置
    const byFolder = new Map();
    const deduped = [];
    remain.forEach((mod) => {
      const key = this.moduleTargetFolder(mod).toLowerCase() || "id:" + mod.id;
      const prev = byFolder.get(key);
      if (!prev) {
        byFolder.set(key, mod);
        deduped.push(mod);
        return;
      }
      const prevAuto = String(prev.id || "").startsWith("dir:");
      const nextAuto = String(mod.id || "").startsWith("dir:");
      if (prevAuto && !nextAuto) {
        const index = deduped.indexOf(prev);
        if (index >= 0) deduped[index] = mod;
        byFolder.set(key, mod);
      }
    });
    this.plugin.settings.modules = deduped;
    this.plugin.settings.hiddenModuleFolders = (
      this.plugin.settings.hiddenModuleFolders || []
    ).filter((path) => String(path).toLowerCase() !== folder.toLowerCase());
    if (this.active === target.id) this.active = "home";
    this._ownership = null;

    // 目录已空：移入回收站，保持文件树干净
    try {
      const left = this.app.vault.getAbstractFileByPath(folder);
      if (left && Array.isArray(left.children) && !left.children.length) {
        if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") {
          await this.app.fileManager.trashFile(left);
        } else {
          await this.app.vault.trash(left, true);
        }
      }
    } catch (error) {
      // 空目录删除失败不影响模块移除，保留即可
    }

    await this.plugin.saveSettings();
    this.render();
    new Notice(
      "已删除模块「" + target.name + "」：" +
        (movedFiles ? movedFiles + " 个文件" : "无文件") +
        (movedFolders ? "、" + movedFolders + " 个文件夹" : "") +
        "已上移到" + parentLabel
    );
  }

  /* 模块右键菜单：和文件树一样，就地重命名或删除，操作同步到文件夹。 */
  showModuleMenu(mod, event) {
    if (!mod) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("重命名…").setIcon("pencil").onClick(() => this.renameModule(mod))
    );
    menu.addItem((item) =>
      item.setTitle("编辑模块…").setIcon("settings").onClick(() => this.openModuleEditor(mod))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("删除模块…")
        .setIcon("trash")
        .onClick(() => {
          void this.dissolveModule(mod);
        })
    );
    menu.showAtMouseEvent(event);
  }

  renameModule(mod) {
    if (!mod) return;
    const oldFolder = this.moduleTargetFolder(mod);
    new RenameModuleModal(this.app, mod.name || oldFolder.split("/").pop(), async (value) => {
      const name = sanitizeFolderName(value);
      if (!name) {
        new Notice("名称不能为空，也不能包含 \\ / : * ? \" < > | 等字符。");
        return;
      }
      const parent =
        oldFolder.indexOf("/") === -1 ? "" : oldFolder.slice(0, oldFolder.lastIndexOf("/"));
      const newFolder = parent ? parent + "/" + name : name;
      if (!oldFolder) {
        mod.name = name;
        mod.folder = newFolder;
        await this.plugin.saveSettings();
        this.render();
        return;
      }
      if (newFolder === oldFolder && name === mod.name) return;
      // Windows 上大小写不敏感，只有真正换了路径才检查重名
      if (newFolder.toLowerCase() !== oldFolder.toLowerCase()) {
        if (this.app.vault.getAbstractFileByPath(newFolder)) {
          new Notice("已存在同名文件夹：" + newFolder);
          return;
        }
      }
      const node = this.app.vault.getAbstractFileByPath(oldFolder);
      if (node) {
        try {
          await this.app.fileManager.renameFile(node, newFolder);
        } catch (error) {
          new Notice("重命名失败：" + (error && error.message ? error.message : error));
          return;
        }
      }
      this.plugin.remapModuleFolder(oldFolder, newFolder);
      mod.name = name;
      mod.folder = newFolder;

      // 隐式模块的 id 跟着路径走，当前选中和展开状态也要迁移
      const oldId = "dir:" + oldFolder;
      const newId = "dir:" + newFolder;
      const remapId = (id) => {
        if (id === oldId) return newId;
        if (id.indexOf(oldId + "/") === 0) return newId + id.slice(oldId.length);
        return id;
      };
      this.active = remapId(this.active);
      const expanded = new Set();
      this._navExpanded.forEach((id) => expanded.add(remapId(id)));
      this._navExpanded = expanded;

      await this.plugin.saveSettings();
      this.render();
      new Notice("已重命名为「" + name + "」");
    }).open();
  }

  openModuleEditor(mod, initialName) {
    const mods = this.getModules();
    const index = mod ? mods.findIndex((m) => m.id === mod.id) : -1;
    new ModuleEditorModal(this.app, {
      module: mod,
      initialName: initialName || "",
      modules: mods,
      // 内置模块没有 color 字段，打开编辑器时用它在导航里的预设色，避免一编辑就变色
      initialColor: index >= 0 ? MODULE_COLORS[index % MODULE_COLORS.length] : MODULE_COLORS[0],
      onSave: async (next) => {
        const folder = this.moduleTargetFolder(next);
        try {
          // 模块 = 文件夹：保存时同步创建，父模块同样会出现在文件树里
          await ensureVaultFolder(this.app, folder);
        } catch (error) {
          new Notice("创建模块文件夹失败：" + (error && error.message ? error.message : error));
          return;
        }
        next.folder = folder;
        this.plugin.settings.hiddenModuleFolders = (
          this.plugin.settings.hiddenModuleFolders || []
        ).filter((path) => path !== folder);

        const list = this.getModules().slice();
        let idx = list.findIndex((m) => m.id === next.id);
        // 同一文件夹只保留一个模块：新建时撞到已有目录就合并到那条配置上
        if (idx < 0) {
          idx = list.findIndex((m) => this.moduleTargetFolder(m) === folder);
        }
        if (idx >= 0) list[idx] = next;
        else list.push(next);
        this.plugin.settings.modules = list;
        this._ownership = null;
        await this.plugin.saveSettings();
        new Notice("已保存模块「" + next.name + "」");

        // 从“归入模块 → 新建模块…”进来的：建完直接把待归入的笔记写进去
        const pending = this._pendingAssign;
        this._pendingAssign = null;
        if (pending && pending.length) this.assignToModule(pending, next);
        else if (!mod) this.go(next.id);
      },
      onDelete: mod
        ? async (target) => {
            await this.removeModuleConfig(target);
            new Notice("已删除模块「" + target.name + "」，笔记文件未受影响");
          }
        : null
    }).open();
  }

  openModuleManager() {
    new ModuleManagerModal(this.app, {
      getRootModules: () => this.rootModules(),
      getChildren: (mod) => this.submodulesOf(mod),
      getAllModules: () => this.getModules(),
      getFolder: (mod) => this.moduleTargetFolder(mod),
      onCreate: () => this.openModuleEditor(null),
      onEdit: (mod) => this.openModuleEditor(mod),
      onDissolve: async (mod) => {
        await this.dissolveModule(mod);
      }
    }).open();
  }

  openModulePicker(files) {
    if (!files || !files.length) return;
    new ModulePickerModal(
      this.app,
      this.getModules(),
      (mod) => this.assignToModule(files, mod),
      () => {
        this._pendingAssign = files;
        this.openModuleEditor(null);
      }
    ).open();
  }

  // 等 Obsidian 的元数据缓存刷新，避免刚写完 module 又被旧缓存判成未归类
  waitForMetadata(file, timeout = 800) {
    const cache = this.app.metadataCache;
    return new Promise((resolve) => {
      let done = false;
      let ref = null;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          if (ref) cache.offref(ref);
        } catch (e) {
          // 事件引用已失效时忽略
        }
        resolve();
      };
      ref = cache.on("changed", (changed) => {
        if (changed && changed.path === file.path) finish();
      });
      setTimeout(finish, timeout);
    });
  }

  /* 归入模块（与文件树一致）：
   *   - 文件直接移动到模块文件夹，归入后自然出现在该模块页；
   *   - 笔记顺手写 module 字段（只是元数据，模块归属仍以文件夹为准）；
   *   - 素材在归属表里留一条记录，兼容后续切回 unassigned 收件箱策略。 */
  async assignToModule(files, mod) {
    if (!files || !files.length) return;
    const rawId = moduleIdOf(mod);
    const value = String(rawId).startsWith("dir:") ? mod.name : rawId;
    const dir = this.moduleTargetFolder(mod);
    try {
      if (dir) await ensureVaultFolder(this.app, dir);
    } catch (e) {
      new Notice("无法创建模块文件夹「" + dir + "」：" + (e.message || e));
      return;
    }
    let done = 0;
    let moved = 0;
    let failed = 0;
    let firstError = "";
    const assigned = this.ownershipMap();
    for (const file of files) {
      try {
        const oldPath = file.path;
        const isNote = String(file.extension || "").toLowerCase() === "md";
        // 媒体文件没有 frontmatter，只有 Markdown 需要写归属字段。
        if (isNote) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.module = value;
          });
          await this.waitForMetadata(file);
        }
        const target = this.uniqueFilePath(dir, file);
        if (target && oldPath !== target) {
          await this.app.fileManager.renameFile(file, target);
          moved += 1;
          // 附件靠这份记录离开收件箱；旧路径的记录一并清掉
          if (!isNote) {
            delete assigned[oldPath];
            assigned[target] = value;
          }
        } else if (!isNote) {
          assigned[oldPath] = value;
        }
        done += 1;
      } catch (e) {
        // 单个文件失败不阻塞其余文件，但要把原因带出来，避免"看起来没反应"
        failed += 1;
        if (!firstError) firstError = (e && e.message) || String(e);
      }
    }
    await this.plugin.saveSettings();
    this._ownership = null;
    this._inboxSel = new Set();
    new Notice(
      "已归入「" + mod.name + "」：" + done + " 项" + (moved ? "（移动 " + moved + " 项）" : "") +
        (failed ? "；失败 " + failed + " 项：" + firstError : "")
    );
    this.render();
  }

  // 按标签 / 文件夹名 / 文件名给未归类笔记猜一个模块，只做建议，不自动改文件
  suggestModuleFor(file) {
    if (file.extension !== "md") return null;
    const fm = getFm(this.app, file);
    const tags = getTags(fm).map((t) => t.toLowerCase());
    const segs = file.parent ? file.parent.path.split("/").map((s) => s.toLowerCase()) : [];
    const base = file.basename.toLowerCase();

    for (const mod of this.getModules()) {
      const names = [mod.name, mod.id, mod.module]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      if (tags.some((t) => names.some((n) => t === n || t.startsWith(n + "/")))) return mod;
      if (segs.some((s) => names.some((n) => s === n))) return mod;

      const keywords = (mod.keywords || []).map((k) => String(k).toLowerCase()).filter(Boolean);
      if (tags.some((t) => keywords.some((k) => t === k || t.startsWith(k + "/")))) return mod;
      if (keywords.some((k) => k.length >= 2 && base.includes(k))) return mod;
    }
    return null;
  }

  // 一次性采纳收集箱里的全部归属建议
  async applyAllSuggestions(files) {
    // 与文件树一致：归入 = 真正把文件移进模块文件夹，而不是只写 frontmatter。
    const groups = new Map();
    for (const file of files) {
      if (file.extension !== "md") continue;
      const mod = this.suggestModuleFor(file);
      if (!mod) continue;
      const key = moduleIdOf(mod);
      if (!groups.has(key)) groups.set(key, { mod, files: [] });
      groups.get(key).files.push(file);
    }
    if (!groups.size) {
      new Notice("没有可归入的笔记");
      return;
    }
    for (const group of groups.values()) {
      await this.assignToModule(group.files, group.mod);
    }
  }

  // 删除收集箱条目：笔记和附件都移入系统回收站，可随时恢复
  deleteFiles(files, onDone) {
    if (!files || !files.length) return;
    new DeleteFilesModal(this.app, files, async () => {
      let done = 0;
      for (const file of files) {
        try {
          if (this.app.fileManager && this.app.fileManager.trashFile) {
            await this.app.fileManager.trashFile(file);
          } else {
            await this.app.vault.trash(file, true);
          }
          done += 1;
          if (this._inboxSel) this._inboxSel.delete(file.path);
          if (this.plugin.settings.inboxAssigned) {
            delete this.plugin.settings.inboxAssigned[file.path];
          }
        } catch (e) {
          // 单个文件失败不阻塞其余
        }
      }
      await this.plugin.saveSettings();
      this._ownership = null;
      new Notice("已删除 " + done + " 个文件，可在回收站恢复");
      if (typeof onDone === "function") onDone(done);
      else this.render();
    }).open();
  }

  ignoreModuleValue(value) {
    const list = (this.plugin.settings.ignoredModuleValues || []).slice();
    if (!list.includes(value)) list.push(value);
    this.plugin.settings.ignoredModuleValues = list;
    this.plugin.saveSettings();
  }

  runCommand(id) {
    try {
      return this.app.commands.executeCommandById(id);
    } catch (e) {
      return false;
    }
  }

  openCollis() {
    const ok = this.runCommand("collis:open-cards");
    if (ok) return;
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      leaf.setViewState({ type: "qm-cards-view", active: true });
      this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("没有找到 Collis 视图");
    }
  }

  quickCapture() {
    if (!this.runCommand("collis:quick-capture")) {
      new Notice("未找到 Collis 的快速记录命令");
    }
  }

  // 画布集现在就是「白板」页本身，所有入口都切到这一页，不再开新标签。
  openCollisGallery() {
    this.go("canvas");
  }

  openSettings() {
    try {
      this.app.setting.open();
      this.app.setting.openTabById(this.plugin.manifest.id);
    } catch (e) {
      new Notice("请手动打开设置 → Collis");
    }
  }

  setFocus(on) {
    this.focus = on;
    document.body.classList.toggle("collis-focus", on);
    this.render();
  }

  setNavCollapsed(on) {
    this.navCollapsed = !!on;
    this.plugin.settings.navCollapsed = this.navCollapsed;
    if (this.plugin.persistSettings) this.plugin.persistSettings();
    this.applyLayout();
  }

  refresh() {
    if (!this.containerEl) return;
    const shown =
      typeof this.containerEl.isShown === "function"
        ? this.containerEl.isShown()
        : this.containerEl.offsetParent !== null;
    if (!shown) {
      // 视图在别的标签页：先记为待刷新，切回本视图时由 active-leaf-change 补刷
      this._needsRefresh = true;
      return;
    }
    this._needsRefresh = false;
    // 文件增删改后归属会变，旧缓存必须清掉，否则新笔记会被旧归属表挡在外面
    this._ownership = null;
    // 白板页是 Collis 画布集本体的实时镜像；卡片笔记页直接刷新面板，
    // 都不重建整页，避免滚动位置和输入内容丢失。
    if (this.active === "canvas" && this.gallery) {
      this.gallery.refresh();
      return;
    }
    if (this.active === "notes" && this.notes) {
      this.notes.refresh();
      return;
    }
    this.render();
  }

  go(id) {
    if (this.active === "canvas" && id !== "canvas") this.destroyGallery();
    if (this.active === "notes" && id !== "notes") this.destroyNotes();
    const mod = this.moduleById(id);
    const builtin = ["home", "inbox", "canvas", "notes"].includes(id);
    if (!mod && !builtin) {
      // 文件夹被删除 / 改名后，原 id 失效，回首页而不是停在空白页
      this.active = "home";
    } else {
      this.active = id;
      // 只在“进入模块”时展开祖先链路（不含自身）：自身是否展开由点击行为决定，
      // 这样父模块点击第二次才能折叠（否则这里会把自身又塞回展开集合）。
      if (mod) {
        this.modulePath(mod)
          .slice(0, -1)
          .forEach((node) => this._navExpanded.add(moduleIdOf(node)));
      }
    }
    this.render();
  }

  destroyGallery() {
    if (this.gallery) this.gallery.destroy();
  }

  destroyNotes() {
    if (this.notes) this.notes.destroy();
  }

  getBoardFiles() {
    return this.app.vault
      .getFiles()
      .filter((f) => f.extension === BOARD_EXT)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getCardFiles() {
    return this.app.vault
      .getFiles()
      .filter((f) => f.extension === "md" && f.path.startsWith(CARD_FOLDER + "/"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  // 卡片总数只有读文件才知道，导航先渲染，数字到了再补进徽标。
  fillCardCount(item) {
    const collis =
      (this.plugin.childPlugins && this.plugin.childPlugins.collis) ||
      (this.app.plugins.plugins && this.app.plugins.plugins.collis);
    if (!collis || typeof collis.readAllCards !== "function") return;
    collis
      .readAllCards()
      .then((cards) => {
        const total = Array.isArray(cards) ? cards.length : 0;
        this._cardCount = total;
        if (!item.isConnected) return;
        let badge = item.querySelector(".cl-navcount");
        if (!total) {
          if (badge) badge.remove();
          return;
        }
        if (!badge) badge = item.createDiv({ cls: "cl-navcount" });
        badge.setText(String(total));
      })
      .catch(() => {
        // 读取失败就不显示数字，不影响导航本身
      });
  }

  parseCards(text, file) {
    const lines = text.split(/\r?\n/);
    const cards = [];
    let date = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const heading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
      if (heading) {
        date = heading[1];
        continue;
      }

      const start = line.match(/^-\s+(\d{2}:\d{2})\s+(.*)$/);
      if (!start) continue;

      let body = start[2];
      let j = i + 1;
      while (
        j < lines.length &&
        !/^-\s+\d{2}:\d{2}\s+/.test(lines[j]) &&
        !/^##\s+/.test(lines[j])
      ) {
        body += "\n" + lines[j];
        j++;
      }
      i = j - 1;

      let id = "";
      const idMatch = body.match(/\s\^([A-Za-z0-9]+)\s*$/);
      if (idMatch) {
        id = idMatch[1];
        body = body.replace(/\s*\^[A-Za-z0-9]+\s*$/, "");
      }

      const tags = [];
      body = body
        .replace(/#([^\s#]+)/g, (all, tag) => {
          tags.push(tag);
          return "";
        })
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      cards.push({
        date,
        time: start[1],
        text: body,
        tags,
        id,
        file,
        sortKey: date + " " + start[1]
      });
    }

    return cards;
  }

  async getRecentCards(limit) {
    const files = this.getCardFiles().slice(0, 3);
    let cards = [];
    for (const file of files) {
      let text = "";
      try {
        text = await this.app.vault.cachedRead(file);
      } catch (e) {
        continue;
      }
      cards = cards.concat(this.parseCards(text, file));
    }
    cards.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
    return cards.slice(0, limit || 6);
  }

  openCard(card) {
    if (!card) return;
    const sub = card.id ? "#^" + card.id : "";
    this.app.workspace.openLinkText(card.file.path + sub, "", true);
  }

  /** 首页速记卡片：切到卡片笔记页，并定位到具体这一条。 */
  openCardInNotes(card) {
    if (!card) return;
    this.go("notes");
    if (this.notes) this.notes.focusCard(card);
  }

  async readBoard(file) {
    try {
      const text = await this.app.vault.cachedRead(file);
      const data = JSON.parse(text);
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const edges = Array.isArray(data.edges) ? data.edges : [];
      const first = nodes.find((n) => n && n.type === "text" && n.text);
      const preview = first
        ? String(first.text).replace(/\s+/g, " ").slice(0, 26)
        : "空白白板";
      return {
        nodes: nodes.length,
        edges: edges.length,
        summary: nodes.length + " 个节点 · " + preview
      };
    } catch (e) {
      return { nodes: 0, edges: 0, summary: "无法读取白板" };
    }
  }

  render() {
    this._mdFiles = this.app.vault.getMarkdownFiles();
    this._contentFiles = this._mdFiles.filter(isContentFile);
    if (this.active !== "canvas") this.destroyGallery();
    if (this.active !== "notes") this.destroyNotes();
    this.contentEl.empty();
    this.contentEl.addClass("cl-content");

    const root = this.contentEl.createDiv({ cls: "cl-app" });
    this.appEl = root;
    this.renderNav(root);

    const main = root.createDiv({ cls: "cl-main" });

    // 侧栏收起后从主区域左上角浮出，用来恢复导航
    const restore = main.createDiv({ cls: "cl-navrestore" });
    restore.setAttribute("aria-label", "展开 Collis 侧栏");
    setIcon(restore, "chevrons-right");
    restore.onclick = () => this.setNavCollapsed(false);

    const scroll = main.createDiv({ cls: "cl-scroll" });
    if (this.active === "inbox") {
      this.renderInbox(scroll);
    } else if (this.active === "canvas") {
      this.renderCanvas(scroll);
    } else if (this.active === "notes") {
      this.renderNotes(scroll);
    } else if (this.active === "home") {
      this.renderHome(scroll);
    } else {
      const mod = this.moduleById(this.active);
      if (mod) this.renderModule(scroll, mod);
      else this.renderHome(scroll);
    }
    this.applyLayout();
  }

  renderNav(root) {
    const nav = root.createDiv({ cls: "cl-nav" });

    const brand = nav.createDiv({ cls: "cl-brand" });
    brand.createDiv({ cls: "cl-mark", text: "C" });
    const brandName = this.plugin.settings.workspaceName || "个人工作台";
    const brandText = brand.createDiv({ cls: "cl-brand-txt" });
    brandText.createDiv({ cls: "cl-brand-name", text: brandName });
    brandText.createDiv({
      cls: "cl-brand-sub",
      text: brandName === "个人工作台" ? "Collis Workspace" : "个人工作台"
    });

    // 收起按钮固定在品牌行右侧：导航的开关放在导航的起始位置
    const collapseBtn = brand.createDiv({ cls: "cl-navtoggle" });
    collapseBtn.setAttribute("aria-label", "收起 Collis 侧栏");
    setIcon(collapseBtn, "chevrons-left");
    collapseBtn.onclick = () => this.setNavCollapsed(true);

    const navList = nav.createDiv({ cls: "cl-navlist" });

    // 分为三组：总览 / 模块 / 工作区。组标题只是视觉分层，不参与交互。
    const group = (caption) => {
      const g = navList.createDiv({ cls: "cl-navgroup" });
      g.createDiv({ cls: "cl-navcap", text: caption });
      return g;
    };

    // 统一的行工厂：count 为 0 时不渲染数字，避免像文件树那样一列 0。
    // chevron / depth 用来画模块层级（父模块 → 子模块），其他入口不传即可。
    const addItem = (parent, { label, icon, tile, color, active, count, onClick, onContextMenu, depth = 0, chevron = false, hasChildren = false, expanded = false, onToggle }) => {
      const item = parent.createDiv({
        cls: "cl-navitem" + (active ? " is-active" : "") + (depth > 0 ? " is-sub" : "")
      });
      item.setAttribute("aria-label", label);
      if (depth > 0) item.style.paddingLeft = 9 + depth * 14 + "px";
      if (chevron) {
        const chev = item.createDiv({ cls: "cl-navchev" + (hasChildren ? "" : " is-blank") });
        if (hasChildren) {
          setIcon(chev, expanded ? "chevron-down" : "chevron-right");
          chev.onclick = (event) => {
            event.stopPropagation();
            if (onToggle) onToggle();
          };
        }
      }
      const iconEl = item.createDiv({
        cls: "cl-navicon" + (tile ? " cl-navtile " + tile : "")
      });
      // 自定义模块用自己选的颜色；内置模块仍按顺序取预设色
      if (color) iconEl.style.setProperty("--tint", color);
      setIcon(iconEl, icon);
      item.createDiv({ cls: "cl-navlabel", text: label });
      if (count > 0) item.createDiv({ cls: "cl-navcount", text: String(count) });
      item.onclick = onClick;
      if (onContextMenu) {
        item.oncontextmenu = (event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event);
        };
      }
      return item;
    };

    const overview = group("OVERVIEW");
    addItem(overview, {
      label: "首页",
      icon: "home",
      active: this.active === "home",
      onClick: () => this.go("home")
    });
    addItem(overview, {
      label: "收集箱",
      icon: "inbox",
      active: this.active === "inbox",
      count: this.inboxFiles().length,
      onClick: () => this.go("inbox")
    });

    // 模块组的标题行右侧放「新建」「管理」两个小按钮，像 Notion 一样收在标题里
    const modules = navList.createDiv({ cls: "cl-navgroup" });
    const capRow = modules.createDiv({ cls: "cl-navcap-row" });
    capRow.createDiv({ cls: "cl-navcap", text: "MODULES" });
    const capActs = capRow.createDiv({ cls: "cl-navcap-acts" });

    const addModule = capActs.createDiv({ cls: "cl-navcap-btn" });
    addModule.setAttribute("aria-label", "新建模块");
    setIcon(addModule, "plus");
    addModule.onclick = () => this.openModuleEditor(null);

    const manageModule = capActs.createDiv({ cls: "cl-navcap-btn" });
    manageModule.setAttribute("aria-label", "管理模块");
    setIcon(manageModule, "more-horizontal");
    manageModule.onclick = () => this.openModuleManager();

    const allModules = this.getModules();
    // 顶层 = 没有被别的模块文件夹包住的模块；下面完全镜像真实子文件夹。
    // 默认全部收起，只有用户点击模块行或箭头时才展开。
    const roots = this.rootModules();
    const drawModule = (mod, depth) => {
      const key = moduleIdOf(mod);
      const children = this.submodulesOf(mod);
      const expanded = this._navExpanded.has(key);
      const index = allModules.indexOf(mod);
      addItem(modules, {
        label: mod.name,
        icon: mod.icon || (children.length ? "folder" : "file-text"),
        tile: "cl-tint-" + (index >= 0 ? index % 5 : depth % 5),
        color: mod.color,
        active: this.active === key,
        count: this.moduleNoteFiles(mod).length,
        depth,
        chevron: true,
        hasChildren: children.length > 0,
        expanded,
        onContextMenu: (event) => this.showModuleMenu(mod, event),
        onToggle: () => {
          if (expanded) this._navExpanded.delete(key);
          else this._navExpanded.add(key);
          this.render();
        },
        // 与文件树一致：有子模块时，点击模块名本身就展开/折叠；没有子模块则只做导航
        onClick: () => {
          if (children.length) {
            if (expanded) this._navExpanded.delete(key);
            else this._navExpanded.add(key);
          }
          this.go(key);
        }
      });
      if (expanded) children.forEach((child) => drawModule(child, depth + 1));
    };
    roots.forEach((mod) => drawModule(mod, 0));

    const workspace = group("WORKSPACE");
    addItem(workspace, {
      label: "画布",
      icon: "presentation",
      active: this.active === "canvas",
      count: this.getBoardFiles().length,
      onClick: () => this.go("canvas")
    });
    const cardsItem = addItem(workspace, {
      label: "卡片笔记",
      icon: "sticky-note",
      active: this.active === "notes",
      count: this._cardCount || 0,
      onClick: () => this.go("notes")
    });
    this.fillCardCount(cardsItem);

    const foot = nav.createDiv({ cls: "cl-navfoot" });

    const focusBtn = foot.createDiv({ cls: "cl-navitem" });
    focusBtn.setAttribute("aria-label", this.focus ? "退出专注" : "专注模式");
    const focusIcon = focusBtn.createDiv({ cls: "cl-navicon" });
    setIcon(focusIcon, this.focus ? "minimize" : "maximize");
    focusBtn.createDiv({ cls: "cl-navlabel", text: this.focus ? "退出专注" : "专注模式" });
    focusBtn.onclick = () => this.setFocus(!this.focus);

    const settingsBtn = foot.createDiv({ cls: "cl-navitem" });
    settingsBtn.setAttribute("aria-label", "设置");
    const settingsIcon = settingsBtn.createDiv({ cls: "cl-navicon" });
    setIcon(settingsIcon, "settings");
    settingsBtn.createDiv({ cls: "cl-navlabel", text: "设置" });
    settingsBtn.onclick = () => this.openSettings();
  }

  renderHome(el) {
    el.addClass("cl-hm-scroll");
    const page = el.createDiv({ cls: "cl-hm-page" });
    const aurora = page.createDiv({ cls: "cl-hm-aurora" });
    aurora.createEl("i", { cls: "cl-hm-a1" });
    aurora.createEl("i", { cls: "cl-hm-a2" });
    aurora.createEl("i", { cls: "cl-hm-a3" });

    const boards = this.getBoardFiles();
    const inbox = this.inboxFiles();
    const modules = this.getModules();
    const workspaceName = this.plugin.settings.workspaceName || "个人工作台";

    const now = new Date();
    const hour = now.getHours();
    const greet =
      hour < 5 ? "凌晨好"
        : hour < 9 ? "早上好"
          : hour < 12 ? "上午好"
            : hour < 14 ? "中午好"
              : hour < 18 ? "下午好" : "晚上好";
    const WEEKNAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const MONTHNAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    let captureInput = null;

    /* 顶栏：面包屑 / 快速记录 / 设置 / 身份 */
    const top = page.createDiv({ cls: "cl-hm-top" });
    const crumb = top.createDiv({ cls: "cl-hm-crumb" });
    crumb.createEl("b", { text: "总览" });
    crumb.createSpan({ text: " / 首页" });
    top.createDiv({ cls: "cl-hm-topspace" });

    const cmd = top.createDiv({ cls: "cl-hm-cmd" });
    setIcon(cmd.createDiv({ cls: "cl-hm-cmdico" }), "search");
    cmd.createSpan({ text: "快速记一条" });
    cmd.createDiv({ cls: "cl-hm-kbd", text: "↵" });
    cmd.onclick = () => {
      if (captureInput) captureInput.focus();
    };

    const gear = top.createDiv({ cls: "cl-hm-iconbtn" });
    gear.setAttribute("aria-label", "设置");
    setIcon(gear, "settings");
    gear.onclick = () => this.openSettings();

    top.createDiv({
      cls: "cl-hm-avatar",
      text: workspaceName.slice(0, 2) || "C"
    });

    const grid = page.createDiv({ cls: "cl-hm-bento" });

    /* Hero：日期 + 问候 + 内联速记 */
    const hero = grid.createDiv({ cls: "cl-hm-card cl-hm-hero cl-hm-s5" });
    hero.createDiv({ cls: "cl-hm-bigdate", text: String(now.getDate()) });

    const heroTop = hero.createDiv({ cls: "cl-hm-herotop" });
    heroTop.createDiv({ cls: "cl-hm-live" });
    heroTop.createSpan({ text: WEEKNAMES[now.getDay()] + " · " + MONTHNAMES[now.getMonth()] + " " + now.getDate() });

    const heroMid = hero.createDiv({ cls: "cl-hm-heromid" });
    const hello = heroMid.createEl("h1", { cls: "cl-hm-hello" });
    hello.createSpan({ text: greet + "，" });
    hello.createSpan({ cls: "cl-hm-gradtext", text: workspaceName });

    const meta = heroMid.createDiv({ cls: "cl-hm-herometa" });
    const metaPart = (value, label) => {
      meta.createSpan({ text: "" }).createEl("b", { text: String(value) });
      meta.createSpan({ text: " " + label });
    };
    metaPart(modules.length, "个模块");
    meta.createDiv({ cls: "cl-hm-sep" });
    metaPart(boards.length, "块白板");
    meta.createDiv({ cls: "cl-hm-sep" });
    metaPart(inbox.length, "条待整理");

    const capture = hero.createDiv({ cls: "cl-hm-capture" });
    setIcon(capture.createDiv({ cls: "cl-hm-captico" }), "plus");
    captureInput = capture.createEl("input", {
      cls: "cl-hm-captinput",
      attr: { type: "text", placeholder: "记一条速记，回车保存…" }
    });
    const sendBtn = capture.createDiv({ cls: "cl-hm-go" });
    setIcon(sendBtn, "arrow-right");

    const submitCapture = async () => {
      const text = String(captureInput.value || "").trim();
      if (!text) {
        captureInput.focus();
        return;
      }
      const collis = this.plugin.childPlugins && this.plugin.childPlugins.collis;
      if (collis && typeof collis.appendCard === "function") {
        const ok = await collis.appendCard(text);
        if (ok) {
          captureInput.value = "";
          window.setTimeout(() => {
            if (this.active === "home") this.refresh();
          }, 320);
        }
      } else {
        this.quickCapture();
      }
    };
    captureInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submitCapture();
      }
    });
    sendBtn.onclick = submitCapture;

    /* 本周节奏：12 周热力图 */
    const weekCard = grid.createDiv({ cls: "cl-hm-card cl-hm-week cl-hm-s4" });
    const weekHead = weekCard.createDiv({ cls: "cl-hm-head" });
    weekHead.createDiv({ cls: "cl-hm-title", text: "本周节奏" });
    weekHead.createDiv({ cls: "cl-hm-sub", text: "过去 12 周" });

    const dayMs = 86400000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    const monday = todayTime - ((today.getDay() + 6) % 7) * dayMs;

    const buckets = new Map();
    let recentCount = 0;
    let prevCount = 0;
    const recentFrom = todayTime - 6 * dayMs;
    const prevFrom = todayTime - 13 * dayMs;
    for (const file of [...this._contentFiles, ...boards]) {
      const d = new Date(file.stat.mtime);
      d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      buckets.set(key, (buckets.get(key) || 0) + 1);
      if (key >= recentFrom) recentCount += 1;
      else if (key >= prevFrom) prevCount += 1;
    }

    const trend = prevCount ? Math.round(((recentCount - prevCount) / prevCount) * 100) : null;
    const weekNum = weekCard.createDiv({ cls: "cl-hm-weeknum" });
    weekNum.createEl("strong", { text: String(recentCount) });
    weekNum.createSpan({ text: "次编辑" });
    const trendEl = weekNum.createDiv({
      cls: "cl-hm-trend" + (trend !== null && trend < 0 ? " is-down" : ""),
      text: trend === null ? "—" : (trend > 0 ? "+" : "") + trend + "%"
    });

    const heat = weekCard.createDiv({ cls: "cl-hm-heat" });
    const levels = [0, 1, 2, 4, 6];
    for (let i = 0; i < 84; i++) {
      const weekIndex = Math.floor(i / 7);
      const weekday = i % 7;
      const time = monday - (11 - weekIndex) * 7 * dayMs + weekday * dayMs;
      const cell = heat.createEl("i");
      if (time > todayTime) {
        cell.addClass("is-future");
      } else {
        const count = buckets.get(time) || 0;
        let level = 0;
        for (let k = 1; k < levels.length; k++) {
          if (count >= levels[k]) level = k;
        }
        if (level) cell.addClass("l" + level);
      }
    }
    const heatFoot = weekCard.createDiv({ cls: "cl-hm-heatfoot" });
    heatFoot.createSpan({ text: "少" });
    const legend = heatFoot.createDiv({ cls: "cl-hm-legend" });
    for (let i = 0; i < 5; i++) legend.createEl("i", { cls: "l" + i });
    heatFoot.createSpan({ text: "多" });

    /* 收件箱 */
    const inboxCard = grid.createDiv({ cls: "cl-hm-card cl-hm-inbox cl-hm-s3" });
    const inboxHead = inboxCard.createDiv({ cls: "cl-hm-head" });
    inboxHead.createDiv({ cls: "cl-hm-title", text: "收件箱" });
    inboxHead.createDiv({ cls: "cl-hm-sub", text: "未归属" });
    const inboxMore = inboxHead.createDiv({ cls: "cl-hm-more", text: "全部 ›" });
    inboxMore.onclick = () => this.go("inbox");

    const mdTotal = this.vaultFiles().length;
    const inboxMd = inbox.filter((f) => f.extension === "md").length;
    const handled = Math.max(0, mdTotal - inboxMd);
    const pct = mdTotal ? Math.max(6, Math.round((handled / mdTotal) * 100)) : 100;

    const ringWrap = inboxCard.createDiv({ cls: "cl-hm-ringwrap" });
    const ring = ringWrap.createDiv({ cls: "cl-hm-ring" });
    ring.style.setProperty("--p", pct + "%");
    ring.createEl("b", { text: String(inbox.length) });
    const ringSide = ringWrap.createDiv({ cls: "cl-hm-ringside" });
    const ringK = ringSide.createDiv({ cls: "cl-hm-ringk" });
    ringK.createDiv({ text: "条笔记" });
    ringK.createEl("strong", { text: "等你决定去向" });

    const first = inbox[0];
    const firstMod = first ? this.suggestModuleFor(first) : null;
    if (first) {
      const item = inboxCard.createDiv({ cls: "cl-hm-inboxitem" });
      item.createDiv({ cls: "cl-hm-inboxname", text: first.basename });
      if (firstMod) {
        const pill = item.createDiv({ cls: "cl-hm-pill" });
        pill.createDiv({ cls: "cl-hm-pilldot" });
        pill.createSpan({ text: firstMod.name });
      }
      item.onclick = () => this.go("inbox");
    } else {
      inboxCard.createDiv({ cls: "cl-hm-inboxempty", text: "收件箱已清空，今天很干净。" });
    }

    const inboxLink = inboxCard.createDiv({ cls: "cl-hm-inboxlink" });
    if (inbox.length) {
      inboxLink.createSpan({ text: "按建议归入 " });
      inboxLink.createEl("b", { text: inbox.length + " 条" });
      inboxLink.createSpan({ text: " →" });
      inboxLink.onclick = () => {
        const list = inbox.slice();
        const suggestions = list.filter((f) => this.suggestModuleFor(f));
        if (suggestions.length) this.applyAllSuggestions(suggestions);
        else this.go("inbox");
      };
    } else {
      inboxLink.createSpan({ text: "打开收集箱 →" });
      inboxLink.onclick = () => this.go("inbox");
    }

    /* 继续：2×2 文件卡 */
    const resumeCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s6" });
    const resumeHead = resumeCard.createDiv({ cls: "cl-hm-head" });
    resumeHead.createDiv({ cls: "cl-hm-title", text: "继续" });
    resumeHead.createDiv({ cls: "cl-hm-sub", text: "最近编辑" });

    const resumeGrid = resumeCard.createDiv({ cls: "cl-hm-resumes" });
    const recentFiles = [...this._contentFiles, ...boards]
      .filter((file) => !/^未命名笔记/.test(file.basename))
      .filter((file) => !file.path.startsWith(CARD_FOLDER + "/"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 4);

    if (!recentFiles.length) {
      resumeGrid.createDiv({ cls: "cl-hm-empty", text: "还没有可继续的内容。" });
    }

    for (const file of recentFiles) {
      const isBoard = file.extension === "collis";
      const mod = isBoard ? null : this.moduleForFile(file);
      const color = isBoard ? "#9b8cff" : (mod && mod.color) || "#3f7fd1";
      const fm = isBoard ? {} : getFm(this.app, file);
      const typeText = isBoard
        ? "BOARD"
        : fm && fm.status ? String(fm.status).toUpperCase() : "NOTE";

      const cell = resumeGrid.createDiv({ cls: "cl-hm-file" });
      cell.style.setProperty("--hm-c", color);
      cell.style.setProperty("--hm-cb", hmRgba(color, 0.16));

      const cellTop = cell.createDiv({ cls: "cl-hm-filetop" });
      const iconWrap = cellTop.createDiv({ cls: "cl-hm-fileico" });
      setIcon(iconWrap, isBoard ? "presentation" : "file-text");
      cellTop.createDiv({ cls: "cl-hm-filetype", text: typeText });

      cell.createDiv({ cls: "cl-hm-filetree", text: file.basename });

      const fileMeta = cell.createDiv({ cls: "cl-hm-filemeta" });
      const modSpan = fileMeta.createDiv({ cls: "cl-hm-filemod" });
      const dot = modSpan.createDiv({ cls: "cl-hm-filedot" });
      dot.style.background = color;
      modSpan.createSpan({ text: isBoard ? "白板" : (mod && mod.name) || "未归属" });
      fileMeta.createDiv({ cls: "cl-hm-filedtime", text: formatTime(file.stat.mtime) });

      cell.onclick = () => this.openFile(file);
    }

    /* 模块脉搏：彩色拼图 */
    const modCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s6" });
    const modHead = modCard.createDiv({ cls: "cl-hm-head" });
    modHead.createDiv({ cls: "cl-hm-title", text: "模块脉搏" });
    modHead.createDiv({ cls: "cl-hm-sub", text: "按活跃度" });
    const modMore = modHead.createDiv({ cls: "cl-hm-more", text: "管理 ›" });
    modMore.onclick = () => this.openSettings();

    const modGrid = modCard.createDiv({ cls: "cl-hm-mods" });
    const ranked = modules
      .map((mod) => {
        const files = this.moduleNoteFiles(mod);
        const active = files.filter((f) =>
          ACTIVE_STATUSES.includes(String(getFm(this.app, f).status || "").toLowerCase())
        ).length;
        return { mod, total: files.length, active };
      })
      .sort((a, b) => b.active - a.active || b.total - a.total)
      .slice(0, 5);

    ranked.forEach((entry, index) => {
      const color = entry.mod.color || MODULE_COLORS[index % MODULE_COLORS.length];
      const tile = modGrid.createDiv({ cls: "cl-hm-mod" });
      tile.style.setProperty("--hm-c", color);
      tile.style.setProperty("--hm-wash", hmRgba(color, 0.16));
      const icon = tile.createDiv({ cls: "cl-hm-modico" });
      setIcon(icon, entry.mod.icon || "file");
      tile.createDiv({ cls: "cl-hm-modname", text: entry.mod.name });
      const row = tile.createDiv({ cls: "cl-hm-modrow" });
      row.createEl("span", {
        cls: "cl-hm-modcount",
        text: String(entry.total).padStart(2, "0")
      });
      row.createSpan({ cls: "cl-hm-modunit", text: "篇" });
      row.createSpan({ cls: "cl-hm-modlive", text: entry.active + " 进行中" });
      const bar = tile.createDiv({ cls: "cl-hm-modbar" });
      const fill = bar.createEl("i");
      fill.style.width = (entry.total ? Math.round((entry.active / entry.total) * 100) : 0) + "%";
      tile.onclick = () => this.go(entry.mod.id);
    });

    const addTile = modGrid.createDiv({ cls: "cl-hm-mod cl-hm-modadd" });
    setIcon(addTile.createDiv(), "plus");
    addTile.createSpan({ text: "新建模块" });
    addTile.onclick = () => this.openModuleEditor(null);

    /* 最近白板 */
    const boardCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s7" });
    const boardHead = boardCard.createDiv({ cls: "cl-hm-head" });
    boardHead.createDiv({ cls: "cl-hm-title", text: "最近白板" });
    boardHead.createDiv({ cls: "cl-hm-sub", text: boards.length + " 块" });
    const boardMore = boardHead.createDiv({ cls: "cl-hm-more", text: "画布集 ›" });
    boardMore.onclick = () => this.openCollisGallery();

    const boardGrid = boardCard.createDiv({ cls: "cl-hm-boards" });
    const boardEls = [];
    boards.slice(0, 3).forEach((file, index) => {
      const board = boardGrid.createDiv({ cls: "cl-hm-board" });
      const art = board.createDiv({ cls: "cl-hm-art" });
      this.renderBoardArt(art, index % 3);
      board.createDiv({ cls: "cl-hm-shade" });
      const badge = board.createDiv({ cls: "cl-hm-badge", text: "读取中…" });
      const info = board.createDiv({ cls: "cl-hm-boardinfo" });
      info.createDiv({ cls: "cl-hm-boardname", text: file.basename });
      const metaEl = info.createDiv({ cls: "cl-hm-boardmeta", text: "读取中…" });
      board.onclick = () => this.openFile(file);
      boardEls.push({ file, badge, metaEl });
    });

    if (!boards.length) {
      boardGrid.createDiv({ cls: "cl-hm-empty", text: "还没有白板，去画布集新建一张。" });
    }

    /* 速记卡片 */
    const noteCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s5" });
    const noteHead = noteCard.createDiv({ cls: "cl-hm-head" });
    noteHead.createDiv({ cls: "cl-hm-title", text: "速记" });
    noteHead.createDiv({ cls: "cl-hm-sub", text: (this._cardCount || 0) + " 条卡片" });
    const noteMore = noteHead.createDiv({ cls: "cl-hm-more", text: "打开 ›" });
    noteMore.onclick = () => this.go("notes");
    const noteWrap = noteCard.createDiv({ cls: "cl-hm-notes" });

    page.createDiv({ cls: "cl-hm-foot", text: "数据实时读取 · Collis v" + this.plugin.manifest.version });

    this.fillHomeBoards(boardEls);
    this.fillHomeCards(noteWrap);
  }

  /* 白板封面：三种抽象画布缩略图，纯 SVG，不依赖外部资源。 */
  renderBoardArt(wrap, variant) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 160 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const art = [
      `<defs>
        <linearGradient id="hmg0" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1b2a24"/><stop offset="1" stop-color="#0d1113"/>
        </linearGradient>
        <linearGradient id="hmn0" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#9fe870"/><stop offset="1" stop-color="#7de3c3"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="url(#hmg0)"/>
      <circle cx="132" cy="18" r="34" fill="rgba(125,227,195,.16)"/>
      <rect x="18" y="20" width="56" height="26" rx="6" fill="rgba(255,255,255,.07)" stroke="url(#hmn0)" stroke-width=".8"/>
      <rect x="84" y="30" width="40" height="20" rx="5" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.18)" stroke-width=".7"/>
      <rect x="34" y="58" width="40" height="18" rx="5" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.14)" stroke-width=".7"/>
      <path d="M74 33 L84 38" stroke="rgba(125,227,195,.5)" stroke-width="1"/>
      <path d="M56 46 L50 58" stroke="rgba(255,255,255,.2)" stroke-width="1"/>`,
      `<defs>
        <linearGradient id="hmg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#221a2e"/><stop offset="1" stop-color="#0c0d12"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="url(#hmg1)"/>
      <circle cx="26" cy="26" r="30" fill="rgba(155,140,255,.18)"/>
      <circle cx="48" cy="34" r="15" fill="rgba(155,140,255,.12)" stroke="rgba(155,140,255,.5)" stroke-width=".8"/>
      <rect x="76" y="18" width="50" height="24" rx="6" fill="rgba(255,255,255,.05)" stroke="rgba(217,131,74,.55)" stroke-width=".8"/>
      <rect x="66" y="58" width="60" height="18" rx="5" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.15)" stroke-width=".7"/>
      <path d="M63 34 L76 28" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
      <path d="M101 42 L98 58" stroke="rgba(255,255,255,.2)" stroke-width="1"/>`,
      `<defs>
        <linearGradient id="hmg2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#13202c"/><stop offset="1" stop-color="#0b0e11"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="url(#hmg2)"/>
      <circle cx="126" cy="70" r="30" fill="rgba(63,127,209,.18)"/>
      <rect x="14" y="38" width="38" height="30" rx="6" fill="rgba(63,127,209,.16)" stroke="rgba(63,127,209,.5)" stroke-width=".8"/>
      <rect x="64" y="18" width="38" height="22" rx="5" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.16)" stroke-width=".7"/>
      <rect x="108" y="34" width="34" height="26" rx="5" fill="rgba(159,232,112,.12)" stroke="rgba(159,232,112,.4)" stroke-width=".8"/>
      <path d="M52 50 L64 30" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
      <path d="M102 33 L108 42" stroke="rgba(255,255,255,.18)" stroke-width="1"/>`
    ];
    svg.innerHTML = art[variant % art.length];
    wrap.appendChild(svg);
  }

  async fillHomeBoards(items) {
    for (const item of items) {
      const data = await this.readBoard(item.file);
      if (!item.metaEl.isConnected) return;
      item.badge.setText(data.nodes + " 节点");
      item.metaEl.setText(
        (data.edges ? data.edges + " 条连线 · " : "") + formatTime(item.file.stat.mtime)
      );
    }
  }

  async fillHomeCards(container) {
    const cards = await this.getRecentCards(2);
    if (!container.isConnected || this.active !== "home") return;
    container.empty();

    if (!cards.length) {
      container.createDiv({
        cls: "cl-hm-empty",
        text: "还没有速记卡片。在上面记一条，它会出现在这里。"
      });
      return;
    }

    for (const card of cards) {
      const row = container.createDiv({ cls: "cl-hm-note" });
      const meta = row.createDiv({ cls: "cl-hm-notedate" });
      meta.createSpan({ text: card.date ? card.date.slice(5) : "" });
      if (card.time) meta.createSpan({ text: " " + card.time });
      row.createDiv({ cls: "cl-hm-notetext", text: card.text });
      if (card.tags && card.tags.length) {
        row.createDiv({ cls: "cl-hm-notetag", text: "#" + card.tags[0] });
      }
      row.onclick = () => this.openCardInNotes(card);
    }
  }

  makePanel(parent, title, actionText, onAction) {
    const panel = parent.createDiv({ cls: "cl-panel" });
    const head = panel.createDiv({ cls: "cl-panel-head" });
    head.createDiv({ cls: "cl-panel-title", text: title });
    head.createDiv({ cls: "cl-spacer" });
    if (actionText) {
      const action = head.createDiv({ cls: "cl-panel-action", text: actionText });
      if (onAction) action.onclick = onAction;
    }
    return panel;
  }

  async fillTasks(container) {
    const app = this.app;
    let files = this._contentFiles
      .filter((f) => f.path.startsWith("00-Inbox/"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 15);
    if (!files.length) {
      files = [...this._contentFiles]
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, 15);
    }

    const tasks = [];
    for (const file of files) {
      let text = "";
      try {
        text = await app.vault.cachedRead(file);
      } catch (e) {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*[-*]\s*\[ \]\s+(.+)/);
        if (m) {
          tasks.push({ text: m[1].trim(), file });
          if (tasks.length >= 6) break;
        }
      }
      if (tasks.length >= 6) break;
    }

    if (!container.isConnected || this.active !== "home") return;
    container.empty();

    if (!tasks.length) {
      container.createDiv({ cls: "cl-empty", text: "没有未完成任务，收件箱是空的。" });
      return;
    }

    for (const task of tasks) {
      const row = container.createDiv({ cls: "cl-task" });
      row.createDiv({ cls: "cl-check" });
      row.createDiv({ cls: "cl-task-text", text: task.text });
      row.onclick = () => this.openFile(task.file);
    }
  }

  async fillCards(container) {
    const cards = await this.getRecentCards(6);
    if (!container.isConnected || this.active !== "home") return;
    container.empty();

    if (!cards.length) {
      container.createDiv({
        cls: "cl-empty",
        text: "还没有速记卡片。用 Collis 记一条，它会出现在这里。"
      });
      return;
    }

    for (const card of cards) {
      const row = container.createDiv({ cls: "cl-feed" });
      const meta = row.createDiv({ cls: "cl-feed-meta" });
      meta.createSpan({ cls: "cl-feed-date", text: card.date ? card.date.slice(5) : "" });
      meta.createSpan({ cls: "cl-feed-time", text: card.time });
      row.createDiv({ cls: "cl-feed-text", text: card.text });
      if (card.tags.length) {
        const tagRow = row.createDiv({ cls: "cl-feed-tags" });
        card.tags.slice(0, 3).forEach((tag) => {
          tagRow.createSpan({ cls: "cl-tag", text: "#" + tag });
        });
      }
      row.onclick = () => this.openCard(card);
    }
  }

  fillBoards(container, limit) {
    const boards = this.getBoardFiles().slice(0, limit || 6);
    container.empty();

    if (!boards.length) {
      container.createDiv({
        cls: "cl-empty",
        text: "还没有 .collis 白板。去画布集新建一张。"
      });
      return;
    }

    for (const file of boards) {
      const row = container.createDiv({ cls: "cl-board-row" });
      const icon = row.createDiv({ cls: "cl-board-icon" });
      setIcon(icon, "presentation");
      const info = row.createDiv({ cls: "cl-board-info" });
      info.createDiv({ cls: "cl-board-name", text: file.basename });
      const sub = info.createDiv({ cls: "cl-board-sub", text: "读取中…" });
      row.onclick = () => this.openFile(file);
      this.readBoard(file).then((data) => {
        if (sub.isConnected) sub.setText(data.summary);
      });
    }
  }

  renderInbox(el) {
    const files = this.inboxFiles();
    if (!this._inboxSel) this._inboxSel = new Set();
    const alive = new Set(files.map((f) => f.path));
    Array.from(this._inboxSel).forEach((p) => {
      if (!alive.has(p)) this._inboxSel.delete(p);
    });

    const suggestions = new Map();
    files.forEach((f) => {
      const mod = this.suggestModuleFor(f);
      if (mod) suggestions.set(f.path, mod);
    });

    el.addClass("cl-inbox-scroll");
    const page = el.createDiv({ cls: "cl-inbox-page" });

    const head = page.createDiv({ cls: "cl-inbox-head" });
    const headMain = head.createDiv({ cls: "cl-inbox-head-main" });
    const titleRow = headMain.createDiv({ cls: "cl-inbox-title-row" });
    titleRow.createEl("h1", { text: "收件箱" });
    if (files.length) {
      titleRow.createDiv({ cls: "cl-inbox-count", text: files.length + " 待处理" });
    }
    headMain.createDiv({
      cls: "cl-inbox-sub",
      text: "只显示散落在库根目录、还没进任何文件夹的文件；归入模块后自动离开"
    });
    const headActions = head.createDiv({ cls: "cl-inbox-head-actions" });
    const refreshBtn = headActions.createEl("button", { cls: "cl-inbox-refresh" });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.setAttribute("aria-label", "刷新收件箱");
    refreshBtn.onclick = () => this.refresh();

    const weekCount = files.filter(
      (f) => Date.now() - f.stat.mtime < 7 * 86400000
    ).length;
    const stats = page.createDiv({ cls: "cl-inbox-stats" });
    [
      ["根目录待处理", files.length],
      ["有归属建议", suggestions.size],
      ["本周新增", weekCount]
    ].forEach(([label, value]) => {
      const cell = stats.createDiv({ cls: "cl-inbox-stat" });
      cell.createDiv({ cls: "cl-inbox-stat-value", text: String(value) });
      cell.createDiv({ cls: "cl-inbox-stat-label", text: label });
    });

    const controls = page.createDiv({ cls: "cl-inbox-controls" });
    const search = controls.createDiv({ cls: "cl-inbox-search" });
    setIcon(search.createDiv({ cls: "cl-inbox-searchico" }), "search");
    const query = search.createEl("input", {
      cls: "cl-inbox-query",
      attr: { type: "text", placeholder: "筛选标题或路径" }
    });
    query.value = this._inboxQuery || "";

    const seg = controls.createDiv({ cls: "cl-inbox-seg" });
    const kinds = [
      ["all", "全部"],
      ["note", "笔记"],
      ["image", "图片"],
      ["video", "视频"],
      ["doc", "文档"],
      ["audio", "音频"],
      ["other", "其他"]
    ];
    const segButtons = new Map();
    kinds.forEach(([key, label]) => {
      const btn = seg.createEl("button", { cls: "cl-inbox-segbtn", text: label });
      btn.onclick = () => {
        this._inboxFilter = key;
        segButtons.forEach((b, k) => b.classList.toggle("is-active", k === key));
        paint();
      };
      segButtons.set(key, btn);
    });
    if (!this._inboxFilter) this._inboxFilter = "all";
    segButtons.get(this._inboxFilter).classList.add("is-active");

    // 视图切换：和模块页保持一致，列表 / 网格
    const viewSeg = controls.createDiv({ cls: "cl-inbox-viewseg" });
    const viewButtons = new Map();
    [
      ["list", "列表"],
      ["grid", "网格"]
    ].forEach(([key, label]) => {
      const btn = viewSeg.createEl("button", { cls: "cl-inbox-segbtn", text: label });
      btn.onclick = () => {
        this._inboxView = key;
        syncView();
        paint();
      };
      viewButtons.set(key, btn);
    });
    if (!this._inboxView) this._inboxView = "list";
    const syncView = () => {
      const mode = this._inboxView || "list";
      viewButtons.forEach((btn, key) => btn.classList.toggle("is-active", key === mode));
    };
    syncView();

    const sortWrap = controls.createDiv({ cls: "cl-inbox-sort" });
    const sortBtn = sortWrap.createEl("button", { cls: "cl-inbox-sortbtn" });
    const sortLabel = sortBtn.createSpan({
      text: (this._inboxSort || "recent") === "name" ? "名称" : "最近更新"
    });
    setIcon(sortBtn.createSpan({ cls: "cl-inbox-sortico" }), "chevron-down");
    sortBtn.onclick = () => {
      const menu = new Menu();
      [["recent", "最近更新"], ["name", "名称"]].forEach(([value, label]) => {
        menu.addItem((item) => {
          item
            .setTitle(label)
            .setChecked((this._inboxSort || "recent") === value)
            .onClick(() => {
              this._inboxSort = value;
              sortLabel.setText(label);
              paint();
            });
        });
      });
      anchorMenuBelow(menu, sortBtn);
    };

    const banners = page.createDiv({ cls: "cl-inbox-banners" });
    banners.hidden = true;

    const bulk = page.createDiv({ cls: "cl-inbox-bulk" });
    bulk.hidden = true;
    const bulkLabel = bulk.createSpan({ cls: "cl-inbox-bulkcount" });
    setIcon(bulkLabel.createSpan({ cls: "cl-inbox-bulkico" }), "check");
    bulkLabel.createSpan({ text: "已选 " });
    const bulkNum = bulkLabel.createEl("b", { text: "0" });
    bulkLabel.createSpan({ text: " 项" });
    bulk.createDiv({ cls: "cl-inbox-bulkspace" });
    const bulkAssign = bulk.createEl("button", {
      cls: "cl-btn cl-btn-accent",
      text: "归入选中"
    });
    const bulkDelete = bulk.createEl("button", {
      cls: "cl-btn cl-inbox-danger",
      text: "删除选中"
    });

    const list = page.createDiv({ cls: "cl-inbox-list" });
    const foot = page.createDiv({ cls: "cl-inbox-foot" });
    foot.createSpan({
      text:
        this.inboxPolicy() === "root"
          ? "库根目录 " + this.rootFiles().length + " 个文件 · 文件夹内的文件不进入收件箱"
          : "全库扫描 " + (this.vaultFiles().length + this.vaultAttachments().length) + " 个文件"
    });
    foot.createSpan({
      cls: "cl-inbox-footright",
      text: "共 " + files.length + " 条待处理"
    });

    const selectedFiles = () => files.filter((f) => this._inboxSel.has(f.path));

    bulkAssign.onclick = () => {
      // 笔记和素材都允许批量归入：素材没有 frontmatter，归入时移到模块文件夹。
      const chosen = selectedFiles();
      if (chosen.length) this.openModulePicker(chosen);
    };
    bulkDelete.onclick = () => this.deleteFiles(selectedFiles());
    query.oninput = () => {
      this._inboxQuery = query.value;
      paint();
    };

    if (!files.length) bulk.remove();

    const typeInfo = (file) => {
      const key = fileKind(file);
      const ext = String(file.extension || "").toLowerCase();
      let icon = {
        note: "file-text", image: "image", video: "video",
        audio: "music", doc: "file-text", other: "file"
      }[key] || "file";
      if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) icon = "archive";
      return { key, icon };
    };

    const groupFor = (ts) => {
      const now = new Date();
      const date = new Date(ts);
      if (date.toDateString() === now.toDateString()) return "今天";
      if (now.getTime() - ts < 7 * 86400000) return "本周";
      return "更早";
    };

    let current = [];

    const matches = (file) => {
      const kind = this._inboxFilter || "all";
      if (kind !== "all" && typeInfo(file).key !== kind) return false;
      const q = String(this._inboxQuery || "").trim().toLowerCase();
      if (!q) return true;
      return (
        file.basename.toLowerCase().includes(q) ||
        file.path.toLowerCase().includes(q)
      );
    };

    const updateBulk = () => {
      const n = this._inboxSel.size;
      bulk.hidden = n === 0;
      bulkNum.setText(String(n));
      bulkAssign.disabled = n === 0;
      bulkDelete.disabled = n === 0;
    };

    // 网格视图：和模块页同一套缩略图与卡片结构，额外挂选择框、建议和建议采纳、
    // 悬停操作（归入 / 打开 / 删除），保证收件箱原有的操作在网格里也能完成。
    const renderGrid = (parent, items) => {
      const grid = parent.createDiv({ cls: "cl-md-grid" });
      items.forEach((file) => {
        const info = typeInfo(file);
        const selected = this._inboxSel.has(file.path);
        const tile = grid.createDiv({
          cls: "cl-md-tile cl-inbox-tile cl-md-kind-" + info.key + (selected ? " is-selected" : "")
        });
        const thumb = tile.createDiv({ cls: "cl-md-thumb" });
        if (info.key === "note") {
          paintNoteThumb(this.app, thumb, file);
        } else if (info.key === "image" || info.key === "video") {
          paintMediaThumb(this.app, thumb, file, info.key);
        } else {
          setIcon(thumb, info.icon);
        }

        const check = tile.createDiv({ cls: "cl-inbox-tilecheck" });
        const box = check.createEl("input", {
          attr: { type: "checkbox", "aria-label": "选择 " + file.basename }
        });
        box.checked = selected;
        box.onclick = (evt) => {
          evt.stopPropagation();
          if (box.checked) this._inboxSel.add(file.path);
          else this._inboxSel.delete(file.path);
          tile.classList.toggle("is-selected", box.checked);
          updateBulk();
        };

        tile.createDiv({ cls: "cl-md-tilename", text: file.basename });
        const tileMeta = tile.createDiv({ cls: "cl-md-tilemeta" });
        tileMeta.createSpan({ text: THUMB_KIND_LABELS[info.key] || "文件" });
        tileMeta.createSpan({ text: formatTime(file.stat.mtime) });

        const suggest = suggestions.get(file.path);
        if (suggest) {
          const sug = tile.createDiv({ cls: "cl-inbox-tilesug" });
          const chip = sug.createSpan({ cls: "cl-inbox-suggest" });
          const dot = chip.createSpan({ cls: "cl-inbox-dot" });
          dot.style.setProperty("--dot", suggest.color || "var(--interactive-accent)");
          chip.createSpan({ text: "建议 · " + suggest.name });
          const accept = sug.createEl("button", {
            cls: "cl-inbox-adopt",
            attr: { "aria-label": "采纳建议：" + suggest.name }
          });
          setIcon(accept, "check");
          accept.onclick = (evt) => {
            evt.stopPropagation();
            this.assignToModule([file], suggest);
          };
        }

        const acts = tile.createDiv({ cls: "cl-inbox-tileacts" });
        if (file.extension === "md") {
          const assign = acts.createEl("button", { cls: "cl-inbox-act" });
          setIcon(assign, "folder");
          assign.setAttribute("aria-label", "归入模块");
          assign.onclick = (evt) => {
            evt.stopPropagation();
            this.openModulePicker([file]);
          };
        }
        const open = acts.createEl("button", { cls: "cl-inbox-act" });
        setIcon(open, "corner-up-right");
        open.setAttribute("aria-label", "打开");
        open.onclick = (evt) => {
          evt.stopPropagation();
          this.openFile(file);
        };
        const remove = acts.createEl("button", { cls: "cl-inbox-act is-danger" });
        setIcon(remove, "trash-2");
        remove.setAttribute("aria-label", "删除");
        remove.onclick = (evt) => {
          evt.stopPropagation();
          this.deleteFiles([file]);
        };

        tile.onclick = () => this.openFile(file);
      });
    };

    const paint = () => {
      current = files.filter(matches).slice();
      const sortBy = this._inboxSort || "recent";
      current.sort((a, b) =>
        sortBy === "name"
          ? a.basename.localeCompare(b.basename, "zh")
          : b.stat.mtime - a.stat.mtime
      );
      while (list.firstChild) list.removeChild(list.firstChild);
      const gridMode = (this._inboxView || "list") === "grid";
      list.classList.toggle("is-grid", gridMode);

      if (!files.length) {
        const empty = list.createDiv({ cls: "cl-inbox-empty" });
        const art = empty.createDiv({ cls: "cl-inbox-emptyart" });
        setIcon(art, "inbox");
        empty.createEl("h2", { text: "收件箱已清空" });
        empty.createDiv({
          cls: "cl-inbox-emptysub",
          text: "所有笔记都已归入模块。新的散落文件会自动出现在这里。"
        });
        const acts = empty.createDiv({ cls: "cl-inbox-emptyacts" });
        const home = acts.createEl("button", { cls: "cl-btn cl-btn-accent", text: "回到首页" });
        home.onclick = () => this.go("home");
        const again = acts.createEl("button", { cls: "cl-btn", text: "刷新" });
        again.onclick = () => this.refresh();
        updateBulk();
        return;
      }

      if (!current.length) {
        const none = list.createDiv({ cls: "cl-inbox-nomatch" });
        none.createSpan({ text: "没有匹配的条目" });
        const clear = none.createEl("button", { cls: "cl-inbox-clear", text: "清除筛选" });
        clear.onclick = () => {
          this._inboxQuery = "";
          this._inboxFilter = "all";
          this.render();
        };
        updateBulk();
        return;
      }

      if (gridMode) {
        renderGrid(list, current);
        updateBulk();
        return;
      }

      const buckets = [["今天", []], ["本周", []], ["更早", []]];
      current.forEach((file) => {
        const bucket = buckets.find((b) => b[0] === groupFor(file.stat.mtime));
        if (bucket) bucket[1].push(file);
      });

      buckets.forEach(([label, items]) => {
        if (!items.length) return;
        const group = list.createDiv({ cls: "cl-inbox-group" });
        const groupHead = group.createDiv({ cls: "cl-inbox-group-head" });
        groupHead.createSpan({ cls: "cl-inbox-group-name", text: label });
        groupHead.createSpan({ cls: "cl-inbox-group-count", text: String(items.length) });
        groupHead.createSpan({ cls: "cl-inbox-group-line" });

        items.forEach((file) => {
          const selected = this._inboxSel.has(file.path);
          const card = group.createDiv({
            cls: "cl-inbox-card" + (selected ? " is-selected" : "")
          });

          const check = card.createDiv({ cls: "cl-inbox-check" });
          const box = check.createEl("input", {
            attr: { type: "checkbox", "aria-label": "选择 " + file.basename }
          });
          box.checked = selected;
          box.onclick = (evt) => {
            evt.stopPropagation();
            if (box.checked) this._inboxSel.add(file.path);
            else this._inboxSel.delete(file.path);
            card.classList.toggle("is-selected", box.checked);
            updateBulk();
          };

          const info = typeInfo(file);
          const ico = card.createDiv({ cls: "cl-inbox-type is-" + info.key });
          setIcon(ico, info.icon);

          const main = card.createDiv({ cls: "cl-inbox-main" });
          main.createDiv({ cls: "cl-inbox-name", text: file.basename });
          main.createDiv({ cls: "cl-inbox-path", text: file.path });

          const swap = card.createDiv({ cls: "cl-inbox-suggestwrap" });
          const suggest = suggestions.get(file.path);
          if (suggest) {
            const chip = swap.createSpan({ cls: "cl-inbox-suggest" });
            const dot = chip.createSpan({ cls: "cl-inbox-dot" });
            dot.style.setProperty("--dot", suggest.color || "var(--interactive-accent)");
            chip.createSpan({ text: "建议 · " + suggest.name });
            const accept = swap.createEl("button", {
              cls: "cl-inbox-adopt",
              attr: { "aria-label": "采纳建议：" + suggest.name }
            });
            setIcon(accept, "check");
            accept.onclick = (evt) => {
              evt.stopPropagation();
              this.assignToModule([file], suggest);
            };
          } else {
            swap.createSpan({ cls: "cl-inbox-nosug", text: "暂无建议" });
          }

          card.createDiv({ cls: "cl-inbox-time", text: formatTime(file.stat.mtime) });

          const acts = card.createDiv({ cls: "cl-inbox-actions" });

          if (file.extension === "md") {
            const assign = acts.createEl("button", { cls: "cl-inbox-act" });
            setIcon(assign, "folder");
            assign.setAttribute("aria-label", "归入模块");
            assign.onclick = (evt) => {
              evt.stopPropagation();
              this.openModulePicker([file]);
            };
          }

          const open = acts.createEl("button", { cls: "cl-inbox-act" });
          setIcon(open, "corner-up-right");
          open.setAttribute("aria-label", "打开");
          open.onclick = (evt) => {
            evt.stopPropagation();
            this.openFile(file);
          };

          const remove = acts.createEl("button", { cls: "cl-inbox-act is-danger" });
          setIcon(remove, "trash-2");
          remove.setAttribute("aria-label", "删除");
          remove.onclick = (evt) => {
            evt.stopPropagation();
            this.deleteFiles([file]);
          };

          card.onclick = () => this.openFile(file);
        });
      });

      updateBulk();
    };

    paint();
  }

  // 未知 module 值：不自动建导航，只在这里提示，让用户显式决定。
  renderUnknownBanners(el) {
    const groups = this.unknownModuleValues();
    groups.forEach((groupFiles, value) => {
      const banner = el.createDiv({ cls: "cl-banner" });
      banner.createDiv({
        cls: "cl-banner-text",
        text: "未知模块值「" + value + "」· " + groupFiles.length + " 篇"
      });
      const actions = banner.createDiv({ cls: "cl-banner-actions" });

      const create = actions.createEl("button", {
        cls: "cl-btn cl-btn-accent",
        text: "新建模块"
      });
      create.onclick = () => this.openModuleEditor(null, value);

      const pick = actions.createEl("button", { cls: "cl-btn", text: "归入现有模块" });
      pick.onclick = () => this.openModulePicker(groupFiles);

      const ignore = actions.createEl("button", { cls: "cl-btn", text: "忽略" });
      ignore.onclick = () => {
        this.ignoreModuleValue(value);
        this.render();
      };
    });
  }

  renderModule(el, mod) {
    const allNotes = this.moduleNoteFiles(mod).sort((a, b) => b.stat.mtime - a.stat.mtime);
    const children = this.submodulesOf(mod);
    const mods = this.getModules();
    const tintPalette = ["#b394af", "#e9c77e", "#ce7379", "#7fa9b6", "#5d86a4"];
    const modIndex = mods.findIndex((m) => m.id === mod.id);
    const tint = mod.color || tintPalette[(modIndex < 0 ? 0 : modIndex) % tintPalette.length];
    const childHue = (child, index) =>
      child.color || tintPalette[(Math.max(modIndex, 0) + 1 + index) % tintPalette.length];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();
    const weekTs = todayTs - 6 * 86400000;
    const groupOf = (ts) => (ts >= todayTs ? "今天" : ts >= weekTs ? "本周" : "更早");
    const pad2 = (n) => String(n).padStart(2, "0");
    const fmtDate = (ts) => {
      const d = new Date(ts);
      if (ts >= todayTs) return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
      return d.getMonth() + 1 + "-" + pad2(d.getDate());
    };
    const fmtSize = (bytes) => {
      const n = Number(bytes || 0);
      if (!n) return "—";
      if (n < 1024) return n + " B";
      const units = ["KB", "MB", "GB", "TB"];
      let value = n / 1024;
      let i = 0;
      while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
      }
      return (value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")) + " " + units[i];
    };

    let mode = mod.view === "grid" ? "grid" : "list";
    let query = "";
    let searching = false;
    const liveToday = allNotes.some((file) => file.stat.mtime >= todayTs);

    // 多选状态挂到视图上：打开笔记再切回来时仍然保留；换模块自动清空
    if (this._mdSelModule !== mod.id) {
      this._mdSelModule = mod.id;
      this._mdMulti = false;
      this._mdSel = new Set();
    }
    const selected = this._mdSel;
    const toggleSelect = (path) => {
      if (selected.has(path)) selected.delete(path);
      else selected.add(path);
      draw();
    };

    el.empty();
    el.addClass("cl-md-scroll");
    const page = el.createDiv({ cls: "cl-md-page cl-mdv" });

    /* ---------- 面包屑 ---------- */
    const crumbs = page.createDiv({ cls: "cl-mdv-crumbs" });
    const homeChip = crumbs.createSpan({
      cls: "cl-mdv-chip",
      text: this.plugin.settings.workspaceName || "工作台"
    });
    homeChip.onclick = () => this.go("home");
    const chain = this.modulePath(mod);
    chain.forEach((node, index) => {
      crumbs.createSpan({ cls: "cl-mdv-csep", text: "/" });
      if (index === chain.length - 1) {
        crumbs.createEl("b", { text: node.name });
      } else {
        const chip = crumbs.createSpan({ cls: "cl-mdv-chip", text: node.name });
        chip.onclick = () => this.go(node.id);
      }
    });

    /* ---------- 标题区 ---------- */
    const head = page.createDiv({ cls: "cl-mdv-head" });
    const headMain = head.createDiv({ cls: "cl-mdv-headmain" });
    const titleRow = headMain.createDiv({ cls: "cl-mdv-title" });
    titleRow.createEl("h1", { text: mod.name });
    titleRow.createSpan({ cls: "cl-mdv-num", text: "本层 " + allNotes.length + " 篇" });
    if (liveToday) {
      const live = titleRow.createSpan({ cls: "cl-mdv-live" });
      live.createEl("i");
      live.appendText("今天有更新");
    }

    const treeNotes = children.length ? this.moduleTreeNoteFiles(mod).length : allNotes.length;
    const newest = allNotes.length
      ? allNotes.reduce((max, file) => Math.max(max, file.stat.mtime), 0)
      : 0;
    const meta = headMain.createDiv({ cls: "cl-mdv-meta" });
    const metaPart = (text) => meta.createSpan({ text });
    const metaDot = () => meta.createSpan({ cls: "cl-mdv-dotsep", text: "·" });
    metaPart(children.length + " 个子模块");
    if (children.length) {
      metaDot();
      metaPart("含子模块 " + treeNotes + " 篇");
    } else if (newest) {
      metaDot();
      metaPart("最后活动 " + fmtDate(newest));
    }

    const acts = head.createDiv({ cls: "cl-mdv-acts" });
    const searchBtn = acts.createDiv({
      cls: "cl-mdv-ibtn" + (searching ? " is-on" : ""),
      attr: { "aria-label": "筛选笔记", role: "button" }
    });
    setIcon(searchBtn, "search");

    const moreBtn = acts.createDiv({
      cls: "cl-mdv-ibtn",
      attr: { "aria-label": "更多操作", role: "button" }
    });
    setIcon(moreBtn, "more-horizontal");
    moreBtn.onclick = () => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("编辑模块").setIcon("settings").onClick(() => this.openModuleEditor(mod))
      );
      menu.addItem((item) =>
        item.setTitle("重命名模块…").setIcon("pencil").onClick(() => this.renameModule(mod))
      );
      menu.addItem((item) =>
        item.setTitle("删除模块…").setIcon("trash").onClick(() => {
          void this.dissolveModule(mod);
        })
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(this._mdMulti ? "退出多选" : "多选删除")
          .setIcon("list-checks")
          .setChecked(this._mdMulti)
          .onClick(() => {
            this._mdMulti = !this._mdMulti;
            if (!this._mdMulti) this._mdSel.clear();
            draw();
          })
      );
      menu.addItem((item) =>
        item.setTitle("管理模块").setIcon("folder-cog").onClick(() => this.openModuleManager())
      );
      anchorMenuBelow(menu, moreBtn);
    };

    const newBtn = acts.createEl("button", { cls: "cl-mdv-btn is-primary" });
    setIcon(newBtn.createSpan({ cls: "cl-mdv-btnico" }), "plus");
    newBtn.appendText("新建");
    setIcon(newBtn.createSpan({ cls: "cl-mdv-caret" }), "chevron-down");
    newBtn.onclick = () => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("新建笔记").setIcon("file-plus").onClick(() => this.createModuleNote(mod))
      );
      menu.addItem((item) =>
        item.setTitle("新建子模块").setIcon("folder-plus").onClick(() => this.promptSubmodule(mod))
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("归入文件").setIcon("download").onClick(() => this.addFilesToModule(mod))
      );
      anchorMenuBelow(menu, newBtn);
    };

    /* 搜索条：默认收起，点放大镜才出现 */
    const searchWrap = page.createDiv({ cls: "cl-mdv-search" + (searching ? " is-on" : "") });
    const queryInput = searchWrap.createEl("input", {
      cls: "cl-mdv-searchinput",
      attr: { type: "text", placeholder: "筛选本层笔记…" }
    });
    queryInput.addEventListener("input", () => {
      query = queryInput.value;
      draw();
    });
    searchBtn.onclick = () => {
      searching = !searching;
      searchWrap.classList.toggle("is-on", searching);
      searchBtn.classList.toggle("is-on", searching);
      if (searching) queryInput.focus();
    };

    /* ---------- 子模块 ---------- */
    const subSec = page.createDiv({ cls: "cl-mdv-sec" });
    subSec.createEl("h3", { text: "子模块" });
    subSec.createSpan({ cls: "cl-mdv-count", text: String(children.length) });
    subSec.createSpan({ cls: "cl-mdv-line" });
    if (children.length) {
      const manage = subSec.createSpan({ cls: "cl-mdv-secact", text: "管理" });
      manage.onclick = () => this.openModuleManager();
    }

    if (children.length) {
      const grid = page.createDiv({ cls: "cl-mdv-mods" });
      children.forEach((child, index) => {
        const childTree = this.moduleTreeNoteFiles(child);
        const childNewest = childTree.length
          ? childTree.reduce((max, file) => Math.max(max, file.stat.mtime), 0)
          : 0;
        const card = grid.createDiv({ cls: "cl-mdv-modcard" });
        card.style.setProperty("--hue", childHue(child, index));
        card.createDiv({ cls: "cl-mdv-wash" });
        card.createDiv({ cls: "cl-mdv-hair" });
        const top = card.createDiv({ cls: "cl-mdv-mctop" });
        top.createSpan({ cls: "cl-mdv-huedot" });
        top.createSpan({ cls: "cl-mdv-mcname", text: child.name });
        const num = card.createDiv({ cls: "cl-mdv-mcnum" });
        num.appendText(String(this.moduleNoteFiles(child).length));
        num.createSpan({ text: "篇" });
        card.createDiv({
          cls: "cl-mdv-mcmeta",
          text: childNewest ? "最近 " + fmtDate(childNewest) : "暂无笔记"
        });
        card.onclick = () => this.go(child.id);
        card.oncontextmenu = (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showModuleMenu(child, event);
        };
      });
      const addCard = grid.createDiv({ cls: "cl-mdv-modcard is-add" });
      const addInner = addCard.createDiv({ cls: "cl-mdv-addinner" });
      setIcon(addInner.createSpan({ cls: "cl-mdv-addicon" }), "plus");
      addInner.appendText("新建子模块");
      addCard.onclick = () => this.promptSubmodule(mod);
    } else {
      const shelf = page.createDiv({ cls: "cl-mdv-shelf" });
      const shelfIcon = shelf.createDiv({ cls: "cl-mdv-shelf-icon" });
      setIcon(shelfIcon, "folder-plus");
      const shelfText = shelf.createDiv({ cls: "cl-mdv-shelf-text" });
      shelfText.createDiv({ cls: "cl-mdv-shelf-title", text: "还没有子模块" });
      shelfText.createDiv({
        cls: "cl-mdv-shelf-sub",
        text: "子模块就是文件夹，用来继续分层。也可以不建，直接在这一层写笔记。"
      });
      const shelfBtn = shelf.createEl("button", { cls: "cl-mdv-shelf-btn" });
      setIcon(shelfBtn.createSpan({ cls: "cl-mdv-addicon" }), "plus");
      shelfBtn.appendText("新建子模块");
      shelfBtn.onclick = () => this.promptSubmodule(mod);
    }

    /* ---------- 本层笔记 ---------- */
    const noteSec = page.createDiv({ cls: "cl-mdv-sec" });
    noteSec.createEl("h3", { text: "本层笔记" });
    const noteCount = noteSec.createSpan({ cls: "cl-mdv-count", text: String(allNotes.length) });
    noteSec.createSpan({ cls: "cl-mdv-line" });
    const viewSw = noteSec.createSpan({ cls: "cl-mdv-viewsw" });
    const listBtn = viewSw.createSpan({ text: "列表" });
    const gridBtn = viewSw.createSpan({ text: "卡片" });

    const body = page.createDiv({ cls: "cl-md-body cl-mdv-body" });

    /* 多选悬浮条：挂到滚动容器上，absolute 固定在面板底部，不随笔记滚动 */
    const selBar = el.createDiv({ cls: "cl-md-selbar" });
    const selCount = selBar.createSpan({ cls: "cl-md-selcount" });
    const selCancel = selBar.createEl("button", { cls: "cl-md-btn", text: "取消" });
    selCancel.onclick = () => {
      this._mdMulti = false;
      this._mdSel.clear();
      draw();
    };
    const selDelete = selBar.createEl("button", { cls: "cl-md-btn cl-md-btn-danger", text: "删除所选" });
    selDelete.onclick = () => {
      const chosen = allNotes.filter((file) => this._mdSel.has(file.path));
      if (!chosen.length) return;
      this.deleteFiles(chosen, () => {
        this._mdMulti = false;
        this._mdSel.clear();
        this.refresh();
      });
    };

    const renderList = (items) => {
      const groups = new Map([["今天", []], ["本周", []], ["更早", []]]);
      items.forEach((file) => groups.get(groupOf(file.stat.mtime)).push(file));
      groups.forEach((list, name) => {
        if (!list.length) return;
        body.createDiv({ cls: "cl-mdv-glabel", text: name });
        list.forEach((file) => {
          const picked = this._mdSel.has(file.path);
          const row = body.createDiv({
            cls: "cl-mdv-row" + (this._mdMulti && picked ? " is-selected" : "")
          });
          row.style.setProperty("--hue", tint);
          const glyph = row.createDiv({ cls: "cl-mdv-glyph" });
          if (this._mdMulti) {
            const box = glyph.createEl("input", {
              attr: { type: "checkbox", "aria-label": "选择 " + file.basename }
            });
            box.checked = picked;
            box.onclick = (event) => {
              event.stopPropagation();
              toggleSelect(file.path);
            };
          } else {
            setIcon(glyph, "file-text");
          }
          const main = row.createDiv({ cls: "cl-mdv-rowmain" });
          main.createDiv({ cls: "cl-mdv-rowtitle", text: file.basename });
          main.createDiv({ cls: "cl-mdv-rowsub", text: file.path });
          row.createDiv({ cls: "cl-mdv-tag", text: mod.name });
          row.createDiv({ cls: "cl-mdv-date", text: fmtDate(file.stat.mtime) });
          if (!this._mdMulti) {
            const del = row.createDiv({
              cls: "cl-mdv-del",
              attr: { "aria-label": "删除 " + file.basename, role: "button" }
            });
            setIcon(del, "trash-2");
            del.onclick = (event) => {
              event.stopPropagation();
              this.deleteFiles([file]);
            };
          }
          row.onclick = () => {
            if (this._mdMulti) toggleSelect(file.path);
            else this.openFile(file);
          };
        });
      });
    };

    /* 网格视图：沿用原有 .cl-md-grid / .cl-md-tile，外观保持不变 */
    const renderGrid = (items) => {
      const grid = body.createDiv({ cls: "cl-md-grid" });
      items.forEach((file) => {
        const picked = this._mdSel.has(file.path);
        const tile = grid.createDiv({
          cls: "cl-md-tile cl-md-kind-note" + (this._mdMulti && picked ? " is-selected" : "")
        });
        const thumb = tile.createDiv({ cls: "cl-md-thumb" });
        paintNoteThumb(this.app, thumb, file);
        if (this._mdMulti) {
          const check = tile.createDiv({ cls: "cl-md-tilecheck" });
          const box = check.createEl("input", {
            attr: { type: "checkbox", "aria-label": "选择 " + file.basename }
          });
          box.checked = picked;
          box.onclick = (event) => {
            event.stopPropagation();
            toggleSelect(file.path);
          };
        }
        tile.createDiv({ cls: "cl-md-tilename", text: file.basename });
        const tileMeta = tile.createDiv({ cls: "cl-md-tilemeta" });
        tileMeta.createSpan({ text: "笔记" });
        tileMeta.createSpan({ text: fmtSize(file.stat.size) });
        if (!this._mdMulti) {
          const del = tile.createEl("button", {
            cls: "cl-md-tiledel",
            attr: { "aria-label": "删除 " + file.basename }
          });
          setIcon(del, "trash-2");
          del.onclick = (event) => {
            event.stopPropagation();
            this.deleteFiles([file]);
          };
        }
        tile.onclick = () => {
          if (this._mdMulti) toggleSelect(file.path);
          else this.openFile(file);
        };
      });
    };

    const draw = () => {
      listBtn.classList.toggle("is-on", mode === "list");
      gridBtn.classList.toggle("is-on", mode === "grid");
      selBar.classList.toggle("is-on", !!this._mdMulti && allNotes.length > 0);
      selCount.setText("已选 " + selected.size + " 项");
      selDelete.disabled = selected.size === 0;
      noteCount.setText(String(allNotes.length));

      const q = query.trim().toLowerCase();
      const items = allNotes.filter((file) => !q || file.path.toLowerCase().includes(q));
      body.empty();
      if (!allNotes.length) {
        const blank = body.createDiv({ cls: "cl-mdv-blank" });
        const blankIcon = blank.createDiv({ cls: "cl-mdv-blank-icon" });
        setIcon(blankIcon, "file-text");
        const blankText = blank.createDiv({ cls: "cl-mdv-blank-text" });
        blankText.createDiv({ cls: "cl-mdv-blank-title", text: "这一层还没有笔记" });
        blankText.createDiv({
          cls: "cl-mdv-blank-sub",
          text: "直接在父模块写可以；也可以点上面的子模块继续分层。"
        });
        const blankBtn = blank.createEl("button", { cls: "cl-mdv-blank-btn", text: "新建笔记" });
        blankBtn.onclick = () => this.createModuleNote(mod);
        return;
      }
      if (!items.length) {
        body.createDiv({ cls: "cl-mdv-nomatch", text: "没有匹配的笔记" });
        return;
      }
      if (mode === "grid") renderGrid(items);
      else renderList(items);
    };

    listBtn.onclick = () => {
      mode = "list";
      mod.view = "list";
      this.plugin.persistSettings();
      draw();
    };
    gridBtn.onclick = () => {
      mode = "grid";
      mod.view = "grid";
      this.plugin.persistSettings();
      draw();
    };

    draw();
  }

  // 在模块里新建笔记：用模块的文件夹，不存在就补建。
  async createModuleNote(mod) {
    // 模块 = 文件夹：文件夹不存在就直接补建，避免“模块还在、文件没地方放”
    const dir = this.moduleTargetFolder(mod);
    if (!dir) {
      this.pickModuleFolder(mod);
      return;
    }
    try {
      await ensureVaultFolder(this.app, dir);
    } catch (error) {
      new Notice("创建模块文件夹失败：" + (error && error.message ? error.message : error));
      return;
    }
    this.createNoteInFolder(mod, dir);
  }

  pickModuleFolder(mod) {
    new FolderPickerModal(this.app, {
      current: String(mod.folder || ""),
      onPick: (path) => {
        // 选过一次就记到模块上，下次新建不再追问
        mod.folder = path;
        this.plugin.persistSettings();
        this.createNoteInFolder(mod, path);
      }
    }).open();
  }

  async createNoteInFolder(mod, dir) {
    const folder = String(dir || "").replace(/^\/+|\/+$/g, "");

    const now = new Date();
    const stamp =
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0");

    let path = folder + "/未命名笔记 " + stamp + ".md";
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = folder + "/未命名笔记 " + stamp + "-" + n + ".md";
      n += 1;
    }

    const moduleValue = String(mod.id || "").startsWith("dir:") ? mod.name : mod.id || mod.name;
    const content =
      "---\nmodule: " +
      moduleValue +
      "\nstatus: 草稿\ncreated: " +
      now.toISOString().slice(0, 10) +
      "\n---\n\n";

    try {
      const file = await this.app.vault.create(path, content);
      // 新建文件会改变模块归属，先清缓存；若此时视图被新标签挡住，
      // 刷新会记为待刷新，切回本视图时立即重建列表。
      this._ownership = null;
      await this.app.workspace.getLeaf("tab").openFile(file);
      // 等元数据缓存索引完成后再刷新，避免新笔记暂时不出现
      setTimeout(() => this.refresh(), 350);
    } catch (e) {
      new Notice("新建笔记失败：" + (e && e.message ? e.message : e));
    }
  }

  renderCanvas(el) {
    el.addClass("cl-scroll-canvas");
    const collisBoard =
      this.plugin.childPlugins && this.plugin.childPlugins["collis-board"];

    if (!collisBoard) {
      const head = el.createDiv({ cls: "cl-pagehead" });
      head.createEl("h1", { text: "白板" });
      head.createDiv({
        cls: "cl-sub",
        text: "Collis 画布集没有加载成功，请打开控制台查看 [collis] 日志。"
      });
      return;
    }

    if (!this.gallery) this.gallery = new CollisGalleryPanel(this.app, collisBoard);
    this.gallery.mount(el);
  }

  renderNotes(el) {
    el.addClass("cl-scroll-notes");
    const collis =
      (this.plugin.childPlugins && this.plugin.childPlugins.collis) ||
      (this.app.plugins.plugins && this.app.plugins.plugins.collis);

    if (!collis) {
      const head = el.createDiv({ cls: "cl-pagehead" });
      head.createEl("h1", { text: "卡片笔记" });
      head.createDiv({
        cls: "cl-sub",
        text: "Collis 没有加载成功，请打开控制台查看 [collis] 日志。"
      });
      return;
    }

    if (!this.notes) this.notes = new CollisNotesPanel(this.app, collis, this);
    this.notes.mount(el);
  }
}

class CollisSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // ---- 常规 ----
    new Setting(containerEl).setName("常规").setHeading();

    new Setting(containerEl)
      .setName("工作台名称")
      .setDesc("显示在左侧导航顶部的名称。留空则使用「个人工作台」。")
      .addText((text) =>
        text
          .setPlaceholder("个人工作台")
          .setValue(this.plugin.settings.workspaceName || "")
          .onChange(async (value) => {
            this.plugin.settings.workspaceName = value.trim() || "个人工作台";
            await this.plugin.persistSettings();
            // 名称直接影响导航，需要重建视图
            this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
              if (leaf.view && leaf.view.render) leaf.view.render();
            });
          })
      );

    new Setting(containerEl)
      .setName("打开时进入专注模式")
      .setDesc("隐藏左侧栏、标签栏和状态栏，保留右侧栏，方便同时使用 Collis 和其他面板。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.focusOnOpen).onChange(async (value) => {
          this.plugin.settings.focusOnOpen = value;
          await this.plugin.saveSettings();
        })
      );

    // ---- 模块 ----
    new Setting(containerEl).setName("模块").setHeading();

    new Setting(containerEl)
      .setName("模块与文件树")
      .setDesc(
        "模块与文件夹一一对应：模块页只显示该文件夹下直接存放的笔记，子文件夹会自动成为子模块。新建模块时会同步创建同名文件夹。"
      );

    new Setting(containerEl)
      .setName("管理模块")
      .setDesc("新建、编辑、删除模块，或查看模块对应的文件树层级。")
      .addButton((button) =>
        button.setButtonText("打开模块管理").onClick(() => {
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
          if (leaf && leaf.view && leaf.view.openModuleManager) {
            leaf.view.openModuleManager();
          } else {
            new Notice("请先打开 Collis 工作台，再管理模块。");
          }
        })
      );

    // ---- 收件箱 ----
    new Setting(containerEl).setName("收件箱").setHeading();

    new Setting(containerEl)
      .setName("收录范围")
      .setDesc("决定收件箱显示哪些文件。默认只显示库根目录中散落的文件。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("root", "仅库根目录（推荐）")
          .addOption("unassigned", "旧版未归属笔记（兼容）")
          .addOption("all", "全库所有文件（谨慎）")
          .setValue(this.plugin.settings.inboxPolicy || "root")
          .onChange(async (value) => {
            this.plugin.settings.inboxPolicy = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      cls: "cl-settings-hint",
      text: "文件移入模块文件夹后会自动离开收件箱。该策略保留为可切换接口，后续规则可以继续扩展。"
    });

    // ---- 卡片笔记 ----
    new Setting(containerEl).setName("卡片笔记").setHeading();

    new Setting(containerEl)
      .setName("卡片存放位置")
      .setDesc(
        "所有卡片和从画布转换的卡片都写入这个文件夹。固定路径可以避免卡片散落、被算进模块，或在不同设备上分成两处。"
      )
      .addText((text) => text.setValue(CARD_FOLDER).setDisabled(true));

    containerEl.createEl("p", {
      cls: "cl-settings-hint",
      text: "该目录不会出现在模块导航里，也不会进入收件箱。把卡片文件移出这个目录，它就会变成普通笔记。"
    });

    // ---- 画布 ----
    new Setting(containerEl).setName("画布").setHeading();

    const board =
      this.plugin.childPlugins && this.plugin.childPlugins["collis-board"];
    if (!board) {
      containerEl.createEl("p", {
        cls: "cl-settings-hint",
        text: "画布组件未加载，暂时无法配置画布和 AI。请重载插件后再试。"
      });
      return;
    }

    let boardFolderTimer = null;
    new Setting(containerEl)
      .setName("画布文件夹")
      .setDesc("新建画布时保存到这个文件夹，默认「画布」。修改后该文件夹不会作为模块出现。")
      .addText((text) =>
        text
          .setPlaceholder("画布")
          .setValue((board.settings.collis && board.settings.collis.boardFolder) || "")
          .onChange((value) => {
            if (boardFolderTimer) window.clearTimeout(boardFolderTimer);
            boardFolderTimer = window.setTimeout(async () => {
              board.settings.collis = board.settings.collis || {};
              board.settings.collis.boardFolder = value.trim();
              await board.saveSettings();
              if (this.plugin.syncModulesFromVault()) {
                await this.plugin.persistSettings();
              }
              this.plugin.refreshAll();
            }, 600);
          })
      );

    new Setting(containerEl)
      .setName("节点角标")
      .setDesc("在画布卡片节点上显示日期角标，只影响画布显示，不改动卡片正文。")
      .addToggle((toggle) =>
        toggle.setValue(!!board.settings.showBadge).onChange(async (value) => {
          board.settings.showBadge = value;
          await board.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("角标内容")
      .setDesc("精简只显示日期；完整显示标签、日期和时间。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("date", "精简（11-11）")
          .addOption("full", "完整（#标签 11-11 11:08）")
          .setValue(board.settings.badgeFormat === "full" ? "full" : "date")
          .onChange(async (value) => {
            board.settings.badgeFormat = value === "full" ? "full" : "date";
            await board.saveSettings();
          })
      );

    // AI 配置沿用画布组件原有的设置界面（启用、思考模式、模型配置、内容分配）
    const boardTab = board._settingTab;
    if (boardTab && typeof boardTab.renderAI === "function") {
      boardTab.renderAI(containerEl);
    } else {
      containerEl.createEl("p", {
        cls: "cl-settings-hint",
        text: "AI 设置界面未就绪，请重载插件后再试。"
      });
    }
  }
}

module.exports = class CollisPlugin extends Plugin {
  async onload() {
    const saved = await this.readHostData();
    // 全新安装：从文件树同步模块，不预置占位模块
    const firstRun = !saved || !Array.isArray(saved.modules);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    let settingsDirty = false;
    if (!Array.isArray(this.settings.modules)) {
      this.settings.modules = [];
    } else {
      this.settings.modules = this.settings.modules.map((mod) => {
        const base = DEFAULT_MODULES.find((d) => d.id === mod.id);
        const merged = Object.assign({}, base || {}, mod);
        // 老配置只有 name、没有 folder：补成同名目录，保证模块与文件树的映射完整
        if (!merged.folder) merged.folder = sanitizeFolderName(merged.name);
        return merged;
      });
      // 清理上一版自动同步进来的工具/AI 目录（id 以 dir: 开头的是自动生成的模块）
      const kept = this.settings.modules.filter(
        (mod) => !(String(mod.id || "").startsWith("dir:") && isToolFolder(mod.folder))
      );
      if (kept.length !== this.settings.modules.length) {
        this.settings.modules = kept;
        settingsDirty = true;
      }
      // 同一个文件夹只保留一条模块配置，避免导航里出现重复入口
      const seenFolders = new Set();
      const deduped = this.settings.modules.filter((mod) => {
        const key = String(mod.folder || "").replace(/^\/+|\/+$/g, "").toLowerCase();
        if (!key) return true;
        if (seenFolders.has(key)) return false;
        seenFolders.add(key);
        return true;
      });
      if (deduped.length !== this.settings.modules.length) {
        this.settings.modules = deduped;
        settingsDirty = true;
      }
    }

    // 每次启动都补齐文件树里新增的文件夹；已删除的模块靠 hiddenModuleFolders 保持隐藏
    if (this.syncModulesFromVault()) settingsDirty = true;
    // 库里没有任何可用文件夹时，给一组默认入口
    if (firstRun && !this.settings.modules.length) {
      this.settings.modules = DEFAULT_MODULES;
      settingsDirty = true;
    }
    if (settingsDirty) await this.persistSettings();

    this.requestRefresh = debounce(() => this.refreshAll(), 700, true);

    this.registerView(VIEW_TYPE, (leaf) => new CollisView(leaf, this));

    // 先注册图标，addRibbonIcon 和视图标签页才认得这个名字
    if (PLUGIN_ICON_SVG) addIcon(PLUGIN_ICON_ID, PLUGIN_ICON_SVG);

    this.addRibbonIcon(PLUGIN_ICON_ID, "打开 Collis", () => this.activateView());

    this.addCommand({
      id: "open-collis",
      name: "打开 Collis",
      callback: () => this.activateView()
    });

    this.addCommand({
      id: "open-collis-focus",
      name: "打开 Collis（专注模式）",
      callback: () => this.activateView(true)
    });

    this.addCommand({
      id: "toggle-collis-focus",
      name: "切换 Collis 专注模式",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.setFocus) {
          leaf.view.setFocus(!leaf.view.focus);
        }
      }
    });

    this.addCommand({
      id: "toggle-collis-nav",
      name: "切换 Collis 侧栏",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.setNavCollapsed) {
          leaf.view.setNavCollapsed(!leaf.view.navCollapsed);
        }
      }
    });

    this.addCommand({
      id: "open-collis-notes",
      name: "打开卡片笔记",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.go) leaf.view.go("notes");
      }
    });

    this.addCommand({
      id: "quick-capture",
      name: "快速记一条（Collis）",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.quickCapture) leaf.view.quickCapture();
      }
    });

    this.addCommand({
      id: "open-canvas-gallery",
      name: "打开 Collis 画布集",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.go) leaf.view.go("canvas");
      }
    });

    this.addSettingTab(new CollisSettingTab(this.app, this));

    await this.loadBundledPlugins();

    // 画布子插件加载后才能读到自定义画布目录，再同步一次，避免它被当成模块
    if (this.syncModulesFromVault()) await this.persistSettings();

    // 提示框去重：监听本插件视图里 title 属性的增改与节点插入，统一转成
    // aria-label，去掉浏览器原生的白色提示框，只留 Obsidian 的黑色提示框。
    this._ttObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === "attributes") {
          wbNormalizeTitle(m.target);
        } else if (m.type === "childList" && m.addedNodes) {
          const nodes = m.addedNodes;
          for (let j = 0; j < nodes.length; j++) {
            const n = nodes[j];
            if (n && n.nodeType === 1) wbNormalizeTree(n);
          }
        }
      }
    });
    this._ttObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"]
    });
    this.register(() => {
      if (this._ttObserver) {
        this._ttObserver.disconnect();
        this._ttObserver = null;
      }
    });
    this.app.workspace.onLayoutReady(() => wbNormalizeTree(document.body));

    // 旧版独立插件留下的旧视图，重启时收掉；
    // 卡片笔记的 qm-cards-view 是正式侧栏，不在这里处理。
    this.app.workspace.onLayoutReady(() => this.closeLegacyViews());

    // 白板后缀由 .volis 统一迁到 .collis，只需在布局就绪后跑一次。
    this.app.workspace.onLayoutReady(() => this.migrateBoardExtension());

    // 卡片笔记右侧栏：跟随上次退出时的状态恢复。用户主动关掉后不会再自己弹出来。
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncCollisSidebarState())
    );
    this.app.workspace.onLayoutReady(() => this.restoreCollisSidebar());

    this.registerEvent(this.app.vault.on("modify", () => this.requestRefresh()));
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.requestRefresh();
        const path = String((file && file.path) || "");
        // 文件树里新建顶层文件夹时，同步成模块，不用重启插件
        if (file && Array.isArray(file.children) && path && path.indexOf("/") === -1) {
          // 重建了以前删过的同名文件夹：解除隐藏，让它重新成为模块
          const hidden = this.settings.hiddenModuleFolders || [];
          if (hidden.includes(path)) {
            this.settings.hiddenModuleFolders = hidden.filter((item) => item !== path);
          }
          if (this.syncModulesFromVault()) this.persistSettings();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.dropOwnership(file.path);
        // 删掉文件夹时，对应的自动模块一起收掉
        if (file && Array.isArray(file.children) && this.pruneMissingAutoModules()) {
          this.persistSettings();
        }
        this.requestRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.remapOwnership(oldPath, file.path);
        this.remapModuleFolder(oldPath, file.path);
        this.requestRefresh();
      })
    );
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.requestRefresh()));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const type = leaf && leaf.view ? leaf.view.getViewType() : null;
        if (type === VIEW_TYPE) {
          if (leaf.view.focus) document.body.classList.add("collis-focus");
        } else {
          document.body.classList.remove("collis-focus");
        }
      })
    );
  }

  // 素材归属表跟着文件改名 / 删除走，避免记录指向不存在的旧路径。
  remapOwnership(oldPath, newPath) {
    const map = this.settings && this.settings.inboxAssigned;
    if (!map || !oldPath || !newPath || oldPath === newPath) return;
    if (!(oldPath in map)) return;
    map[newPath] = map[oldPath];
    delete map[oldPath];
    this.saveSettings();
  }

  dropOwnership(path) {
    const map = this.settings && this.settings.inboxAssigned;
    if (!map || !path || !(path in map)) return;
    delete map[path];
    this.saveSettings();
  }

  // 模块的保存文件夹被整体改名 / 移动时，同步更新配置里的路径。
  remapModuleFolder(oldPath, newPath) {
    const modules = (this.settings && this.settings.modules) || [];
    if (!oldPath || !newPath || oldPath === newPath) return;
    let changed = false;
    for (const mod of modules) {
      const folder = String(mod.folder || "");
      if (!folder) continue;
      if (folder === oldPath) {
        mod.folder = newPath;
        changed = true;
      } else if (folder.indexOf(oldPath + "/") === 0) {
        mod.folder = newPath + folder.slice(oldPath.length);
        changed = true;
      }
    }
    // 隐藏列表也按同样的路径规则迁移，否则改名后旧目录会被当成新模块冒出来
    const hidden = (this.settings && this.settings.hiddenModuleFolders) || [];
    const nextHidden = hidden.map((path) => {
      const value = String(path || "");
      if (value === oldPath) return newPath;
      if (value.indexOf(oldPath + "/") === 0) return newPath + value.slice(oldPath.length);
      return value;
    });
    if (nextHidden.join("\n") !== hidden.join("\n")) {
      this.settings.hiddenModuleFolders = nextHidden;
      changed = true;
    }
    if (changed) this.saveSettings();
  }

  onunload() {
    document.body.classList.remove("collis-focus");
    this.unloadBundledPlugins();
  }

  // 清理旧版插件残留的独立视图，避免启动后右侧栏还挂着旧画布视图。
  // 注意：qm-cards-view 现在是内置 Collis 的正式右侧栏，不能再当旧视图清掉，
  // 否则每次启动都会把上次开着的卡片笔记关掉。
  closeLegacyViews() {
    const types = ["volis-board", "volis-workbench"];
    for (const type of types) {
      try {
        this.app.workspace.detachLeavesOfType(type);
      } catch (error) {
        console.error("[collis] 清理旧视图失败: " + type, error);
      }
    }
  }

  /* 卡片笔记右侧栏的启动恢复。
   * Obsidian 本身会保存工作区布局，但自定义视图注册较晚时可能被丢掉，
   * 所以这里再用一个布尔标记兜底：上次开着就恢复，上次关了就不动。 */
  restoreCollisSidebar() {
    this._collisLayoutReady = true;
    const leaves = this.app.workspace.getLeavesOfType(QM_VIEW_TYPE);
    if (leaves.length) {
      // 已经由 Obsidian 恢复，只需确保右侧栏是展开状态
      if (!this.settings.collisSidebarOpen) {
        this.settings.collisSidebarOpen = true;
        this.persistSettings();
      }
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    if (!this.settings.collisSidebarOpen) return;
    this.openCollisSidebar();
  }

  syncCollisSidebarState() {
    if (!this._collisLayoutReady) return;
    const open = this.app.workspace.getLeavesOfType(QM_VIEW_TYPE).length > 0;
    if (open === !!this.settings.collisSidebarOpen) return;
    this.settings.collisSidebarOpen = open;
    this.persistSettings();
  }

  openCollisSidebar() {
    try {
      if (this.app.commands.executeCommandById("collis:open-cards")) return;
    } catch (error) {
      // 命令不存在时走下面的兜底
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    leaf.setViewState({ type: QM_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /* 一次性迁移：插件更名为 Collis 后，白板后缀从 .volis 改成 .collis。
   * 只改扩展名，不碰文件内容；目标同名文件已存在时跳过，避免覆盖。 */
  async migrateBoardExtension() {
    const legacy = this.app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === "volis");
    if (!legacy.length) return;
    let moved = 0;
    let skipped = 0;
    for (const file of legacy) {
      const next = file.path.replace(/\.volis$/i, ".collis");
      if (this.app.vault.getAbstractFileByPath(next)) {
        skipped += 1;
        continue;
      }
      try {
        await this.app.fileManager.renameFile(file, next);
        moved += 1;
      } catch (error) {
        skipped += 1;
        console.error("[collis] 白板后缀迁移失败: " + file.path, error);
      }
    }
    if (moved) {
      new Notice("已把 " + moved + " 张白板的扩展名更新为 .collis");
    }
    if (skipped) {
      console.warn("[collis] 有 " + skipped + " 张白板未能迁移，请检查同名文件");
    }
  }

  async readHostData() {
    if (!this.hostData) this.hostData = (await this.loadData()) || {};
    return this.hostData;
  }

  async writeHostData() {
    await this.saveData(this.hostData || {});
  }

  async loadBundledPlugins() {
    this.bundled = [];
    await this.migrateLegacySettings();
    for (const spec of BUNDLED_PLUGINS) {
      await this.loadBundledPlugin(spec);
    }
  }

  // 旧版独立插件的设置分别在各自文件夹的 data.json。
  // 第一次启动时搬进 collis/data.json，搬完后那两个文件夹可以随时删掉。
  async migrateLegacySettings() {
    const data = await this.readHostData();
    let dirty = false;
    // 旧目录名是工具链临时起的，正式版改为 collis；把旧设置搬过来，已存在的键不覆盖。
    try {
      const legacyRaw = await this.app.vault.adapter.read(
        this.app.vault.configDir + "/plugins/workbench/data.json"
      );
      const legacy = JSON.parse(legacyRaw);
      if (legacy && typeof legacy === "object") {
        for (const [key, value] of Object.entries(legacy)) {
          if (!(key in data)) {
            data[key] = value;
            dirty = true;
          }
        }
      }
    } catch (error) {
      // 没有旧目录数据就跳过
    }
    // 画布子插件内部 id 从 volis 更名为 collis-board：搬运旧设置，避免丢配置。
    if (!data["collis-board"] && data.volis) {
      data["collis-board"] = data.volis;
      delete data.volis;
      dirty = true;
    }
    for (const spec of BUNDLED_PLUGINS) {
      // 宿主现在也叫 collis，不能把自己当成旧独立插件的配置读进来。
      if (spec.id === this.manifest.id) continue;
      if (data[spec.id]) continue;
      const path = this.app.vault.configDir + "/plugins/" + spec.id + "/data.json";
      try {
        const raw = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          data[spec.id] = parsed;
          dirty = true;
        }
      } catch (error) {
        // 没有旧数据就交给子插件使用自己的默认值
      }
    }
    if (dirty) await this.writeHostData();
  }

  isStandaloneEnabled(id) {
    try {
      // 宿主 id 已改成 collis，和内置速记卡片子模块同名；必须排除自身，
      // 否则会被误判为“旧独立插件已启用”，整个卡片模块就不加载了。
      if (id === this.manifest.id) return false;
      const plugins = this.app.plugins && this.app.plugins.plugins;
      return !!(plugins && plugins[id] && plugins[id] !== this);
    } catch (error) {
      return false;
    }
  }

  // 子插件的读写重定向到 collis 的 data.json，键名分别是 collis / collis-board。
  attachChildSettings(child, id) {
    child.loadData = async () => {
      const data = await this.readHostData();
      return data[id] || null;
    };
    child.saveData = async (value) => {
      const data = await this.readHostData();
      data[id] = value;
      await this.writeHostData();
    };
  }

  async loadBundledPlugin(spec) {
    if (this.isStandaloneEnabled(spec.id)) {
      console.log("[collis] 独立插件已启用，跳过内置 " + spec.id);
      return;
    }
    try {
      const PluginClass = resolvePluginClass(spec.bundle, spec.className);
      if (typeof PluginClass !== "function") {
        throw new Error("未找到可用的插件类");
      }
      const manifest = Object.assign({}, spec.manifest);
      manifest.dir = this.manifest.dir || this.app.vault.configDir + "/plugins/collis";
      const child = new PluginClass(this.app, manifest);
      this.attachChildSettings(child, spec.id);
      // 内置子插件只作为功能模块存在，不再单独出现在界面上：
      // 不挂 ribbon 图标、状态栏；设置页不单独注册，但保留实例，
      // 由 Collis 设置页复用画布组件原有的 AI 配置界面。
      const noElement = () => document.createElement("div");
      child.addRibbonIcon = noElement;
      child.addStatusBarItem = noElement;
      child.addSettingTab = (tab) => {
        child._settingTab = tab;
      };
      // 手动托管的组件不会走 Obsidian 的启用流程，先标记录入状态，
      // 这样 onunload 时 Component.unload() 才能正确清理事件与视图。
      child._loaded = true;
      this.bundled.push(child);
      await child.onload();
      this.childPlugins = this.childPlugins || {};
      this.childPlugins[spec.id] = child;
      console.log("[collis] 已加载内置插件 " + manifest.id);
    } catch (error) {
      console.error("[collis] 内置插件启动失败: " + spec.id, error);
      new Notice("Collis：内置 " + spec.id + " 启动失败，请查看控制台");
    }
  }

  unloadBundledPlugins() {
    const list = this.bundled || [];
    this.bundled = [];
    for (const child of list) {
      try {
        child.unload();
      } catch (error) {
        console.error("[collis] 内置插件卸载失败", error);
      }
    }
  }

  /* 画布文件夹路径：跟随画布子插件的设置，未加载时按默认「画布」。 */
  canvasFolderPath() {
    const board = this.childPlugins && this.childPlugins["collis-board"];
    const folder = String((board && board.collisFolder) || "画布").replace(/^\/+|\/+$/g, "");
    return folder || "画布";
  }

  /* 启动同步：把库根目录下已有的文件夹同步成模块入口。
   * 只跳过工具/AI/构建目录（vault-scripts、node_modules、.claude …）和画布目录；
   * 附件、媒体文件等普通文件夹同样同步。子文件夹由模块页按文件树自动生成，
   * 用户手动删除的模块记录在 hiddenModuleFolders 里，不会被重新加回。 */
  syncModulesFromVault() {
    const root = this.app.vault.getRoot && this.app.vault.getRoot();
    if (!root || !Array.isArray(root.children)) return false;
    const normalize = (value) => String(value || "").replace(/^\/+|\/+$/g, "");
    // 路径比较统一忽略大小写，兼容 Windows 上大小写不一致的旧配置
    const keyOf = (value) => normalize(value).toLowerCase();
    // 画布文件夹归白板工作区，任何情况下都不作为模块；顺手清掉历史自动配置
    const canvasKey = keyOf(this.canvasFolderPath());
    const beforeCount = (this.settings.modules || []).length;
    this.settings.modules = (this.settings.modules || []).filter(
      (mod) => keyOf(mod.folder) !== canvasKey
    );
    let changed = this.settings.modules.length !== beforeCount;
    const hidden = new Set((this.settings.hiddenModuleFolders || []).map(keyOf));
    const configured = new Set(
      (this.settings.modules || []).map((mod) => keyOf(mod.folder)).filter(Boolean)
    );
    root.children
      .filter((child) => child && Array.isArray(child.children))
      .filter((child) => {
        const path = String(child.path || "");
        if (!path || path.split("/").some((part) => part.startsWith("."))) return false;
        if (keyOf(path) === canvasKey) return false;
        return !isToolFolder(path);
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"))
      .forEach((folder) => {
        const path = normalize(folder.path);
        const key = keyOf(path);
        if (!path || configured.has(key) || hidden.has(key)) return;
        this.settings.modules.push({
          id: "dir:" + path,
          name: folder.name,
          icon: "folder",
          folder: path
        });
        configured.add(key);
        changed = true;
      });
    return changed;
  }

  /* 文件树里的文件夹被删掉后，清掉对应的自动模块；
   * 手动创建的模块保留配置，等文件夹恢复后还能继续用。 */
  pruneMissingAutoModules() {
    const before = (this.settings.modules || []).length;
    this.settings.modules = (this.settings.modules || []).filter((mod) => {
      const id = String(mod.id || "");
      if (!id.startsWith("dir:")) return true;
      const folder = String(mod.folder || "").replace(/^\/+|\/+$/g, "");
      if (!folder) return true;
      return Boolean(this.app.vault.getAbstractFileByPath(folder));
    });
    return this.settings.modules.length !== before;
  }

  async persistSettings() {
    const data = await this.readHostData();
    data.modules = this.settings.modules;
    data.focusOnOpen = this.settings.focusOnOpen;
    data.workspaceName = this.settings.workspaceName;
    data.navCollapsed = !!this.settings.navCollapsed;
    data.collisSidebarOpen = !!this.settings.collisSidebarOpen;
    data.ignoredModuleValues = this.settings.ignoredModuleValues || [];
    data.inboxAssigned = this.settings.inboxAssigned || {};
    data.inboxPolicy = this.settings.inboxPolicy || "root";
    data.hiddenModuleFolders = this.settings.hiddenModuleFolders || [];
    await this.writeHostData();
  }

  async saveSettings() {
    await this.persistSettings();
    this.refreshAll();
  }

  refreshAll() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view && leaf.view.refresh) leaf.view.refresh();
    });
  }

  async activateView(forceFocus) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);

    if ((forceFocus || this.settings.focusOnOpen) && leaf.view && leaf.view.setFocus) {
      leaf.view.setFocus(true);
    }
  }
};
