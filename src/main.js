var {
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
var NovalBundle = require("../vendor/noval-notes-core.js");
var NovalBoardBundle = require("../vendor/noval-board-core.js");
var { NovalGalleryPanel } = require("./noval-gallery.js");
var { NovalNotesPanel } = require("./noval-notes.js");
var NovalAiTag = require("./noval-ai-tag.js");
var RenameFileModal = class extends Modal {
  constructor(app, initial, onSubmit, heading) {
    super(app);
    this.initial = initial;
    this.onSubmit = onSubmit;
    this.heading = heading || "\u91CD\u547D\u540D";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.heading });
    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.initial;
    input.addClass("noval-rename-input");
    input.focus();
    input.select();
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      this.onSubmit(value);
    };
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        this.close();
      }
    });
    new Setting(contentEl).addButton(
      (button) => button.setButtonText("\u91CD\u547D\u540D").setCta().onClick(submit)
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
function resolvePluginClass(bundle, fallbackName) {
  if (typeof bundle === "function") return bundle;
  if (bundle && typeof bundle.default === "function") return bundle.default;
  if (bundle && typeof bundle[fallbackName] === "function") return bundle[fallbackName];
  return null;
}
var NOTES_ID = "noval-notes";
var BOARD_ID = "noval-board";
var BUNDLED_PLUGINS = [
  {
    id: NOTES_ID,
    className: "QuickMemoPlugin",
    bundle: NovalBundle,
    manifest: {
      id: NOTES_ID,
      name: "Noval",
      version: "2.0.5",
      minAppVersion: "1.4.0",
      description: "\u5728\u77E5\u8BC6\u5E93\u91CC\u901F\u8BB0\uFF1A\u4E0D\u5EFA\u6587\u4EF6\u3001\u4E0D\u8D77\u6807\u9898\uFF0C\u6309\u6708\u5B58\u8FDB\u672C\u5730 Markdown\u3002",
      author: "Lak",
      isDesktopOnly: false
    }
  },
  {
    id: BOARD_ID,
    className: "NovalBoardPlugin",
    bundle: NovalBoardBundle,
    manifest: {
      id: BOARD_ID,
      name: "Noval",
      version: "0.7.9",
      minAppVersion: "1.13.0",
      description: "Canvas \u601D\u8003\u5DE5\u4F5C\u53F0\uFF1A\u753B\u5E03\u96C6\u3001\u8BED\u4E49\u8FDE\u7EBF\u3001\u5927\u7EB2\u3001Markdown \u5BFC\u51FA\u4E0E AI\u3002",
      author: "Lak",
      isDesktopOnly: true
    }
  }
];
var VIEW_TYPE = "noval-view";
var QM_VIEW_TYPE = "qm-cards-view";
var PLUGIN_ICON_ID = NovalBundle && NovalBundle.ICON_ID || "noval-mark";
var PLUGIN_ICON_SVG = NovalBundle && NovalBundle.ICON_MARK || "";
var CARD_FOLDER = "00-Inbox/\u901F\u8BB0";
var BOARD_EXT = "noval";
var LEGACY = {
  // 旧版 data.json 里的设置键，也是旧独立插件的目录名
  notesId: "collis",
  boardId: "collis-board",
  sidebarKey: "collisSidebarOpen",
  // 旧白板后缀：volis 是合并前的，collis 是更名前的
  boardExt: ["collis", "volis"],
  // 旧标签页类型：升级后先把残留标签页关掉，避免留下打不开的空标签
  viewTypes: ["collis-view", "collis-board", "collis-gallery"]
};
var ATTACHMENT_EXTENSIONS = /* @__PURE__ */ new Set([
  // 图片
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "heic",
  "heif",
  "ico",
  "tif",
  "tiff",
  // 视频
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "m4v",
  "flv",
  "wmv",
  "mpeg",
  "mpg",
  // 音频
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "aac",
  "opus",
  "wma",
  "aiff",
  // 文档
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "epub",
  "odt",
  "ods",
  "odp",
  "rtf",
  "txt",
  // 压缩包
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  // 其他常见素材
  "excalidraw",
  "base"
]);
var EXCLUDED_DIR_NAMES = /* @__PURE__ */ new Set([
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
var EXCLUDED_FILE_NAMES = /* @__PURE__ */ new Set([
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
function sanitizeFolderName(value) {
  return String(value || "").trim().replace(/[\\/:*?"<>|]/g, "_").replace(/[. ]+$/, "").replace(/^\/+|\/+$/g, "");
}
function isToolFolder(path) {
  const dir = String(path || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!dir) return false;
  return dir.split("/").some((part) => EXCLUDED_DIR_NAMES.has(part));
}
function moduleFolderOf(mod) {
  const raw = String(mod && (mod.folder || mod.name || mod.id || mod.module) || "").trim();
  return raw.replace(/^\/+|\/+$/g, "").replace(/[\\:*?"<>|]/g, "_");
}
var FILE_TREE_COLLATOR = new Intl.Collator(void 0, {
  usage: "sort",
  sensitivity: "base",
  numeric: true
});
function compareVaultNodes(a, b) {
  return FILE_TREE_COLLATOR.compare(String(a && a.name || ""), String(b && b.name || ""));
}
function vaultNodeRank(app, dir, cache) {
  const store = cache || /* @__PURE__ */ new Map();
  const path = String(dir || "").replace(/^\/+|\/+$/g, "");
  if (!path) return [];
  const key = path.toLowerCase();
  if (store.has(key)) return store.get(key);
  store.set(key, null);
  const vault = app && app.vault;
  if (!vault) return null;
  const node = vault.getAbstractFileByPath(path);
  if (!node) return null;
  const parentPath = path.split("/").slice(0, -1).join("/");
  const root = typeof vault.getRoot === "function" ? vault.getRoot() : null;
  const parent = parentPath ? vault.getAbstractFileByPath(parentPath) : root;
  if (!parent || !Array.isArray(parent.children)) return null;
  const parentRank = parentPath ? vaultNodeRank(app, parentPath, store) : [];
  if (!parentRank) return null;
  const siblings = parent.children.filter((child) => Array.isArray(child.children)).sort(compareVaultNodes);
  const index = siblings.indexOf(node);
  if (index < 0) return null;
  const rank = parentRank.concat(index);
  store.set(key, rank);
  return rank;
}
var DEFAULT_MODULES = [
  {
    id: "learning",
    name: "\u5B66\u4E60\u63D0\u5347",
    icon: "graduation-cap",
    module: "learning",
    types: ["topic", "course", "lesson"],
    keywords: ["\u5B66\u4E60", "\u8BFE\u7A0B", "\u4E13\u9898", "\u77E5\u8BC6"]
  },
  {
    id: "reading",
    name: "\u8BFB\u4E66\u9605\u89C8",
    icon: "book-open",
    module: "reading",
    types: ["book", "highlight"],
    folder: "Clippings",
    keywords: ["\u8BFB\u4E66", "\u9605\u8BFB", "\u4E66\u6458", "\u4E66\u8BC4", "\u6458\u5F55"]
  },
  {
    id: "media",
    name: "\u81EA\u5A92\u4F53\u521B\u4F5C",
    icon: "pen-line",
    module: "media",
    types: ["idea", "script", "post"],
    keywords: ["\u81EA\u5A92\u4F53", "\u521B\u4F5C", "\u9009\u9898", "\u811A\u672C", "\u516C\u4F17\u53F7", "\u89C6\u9891"]
  },
  {
    id: "invest",
    name: "\u6295\u8D44\u5B66\u4E60",
    icon: "trending-up",
    module: "invest",
    types: ["company", "investment", "thesis"],
    keywords: ["\u6295\u8D44", "\u7406\u8D22", "\u516C\u53F8", "\u884C\u4E1A", "\u8D22\u62A5"]
  },
  {
    id: "writing",
    name: "\u6587\u7AE0\u5199\u4F5C",
    icon: "file-text",
    module: "writing",
    types: ["article", "draft"],
    keywords: ["\u5199\u4F5C", "\u6587\u7AE0", "\u8349\u7A3F", "\u957F\u6587"]
  }
];
var DEFAULT_SETTINGS = {
  modules: DEFAULT_MODULES,
  focusOnOpen: false,
  workspaceName: "\u4E2A\u4EBA\u5DE5\u4F5C\u53F0",
  navCollapsed: false,
  // 上次退出时卡片笔记右侧栏是否开着，用于重启后恢复
  novalSidebarOpen: false,
  // 用户点过“忽略”的未知 module 值，避免同一提示反复出现
  ignoredModuleValues: [],
  // 收件箱策略：root = 只收库根目录里散落的文件；unassigned / all 作为后续扩展接口
  inboxPolicy: "root",
  // 已从导航删除、但文件仍保留在磁盘上的文件夹模块
  hiddenModuleFolders: [],
  // 素材归属表：路径 -> 模块 id。
  // 素材没有 frontmatter，归入模块后靠这张表记住归属；
  // 收件箱据此判断是否已处理，模块页据此决定素材属于谁。
  inboxAssigned: {},
  // 画布集封面配色覆盖：画布路径 -> 色板 key；缺省时按所在文件夹自动取色
  boardTints: {},
  // 画布收藏：画布路径 -> true
  boardStars: {}
};
var ACTIVE_STATUSES = [
  "active",
  "reading",
  "draft",
  "idea",
  "doing",
  "in-progress",
  "\u8FDB\u884C\u4E2D",
  "\u5728\u8BFB",
  "\u8349\u7A3F"
];
function getFm(app, file) {
  try {
    const cache = app.metadataCache.getFileCache(file);
    return cache && cache.frontmatter || {};
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
    return tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
  }
  return [];
}
function formatTime(ts) {
  const diff = (Date.now() - ts) / 1e3;
  if (diff < 60) return "\u521A\u521A";
  if (diff < 3600) return Math.floor(diff / 60) + " \u5206\u949F\u524D";
  if (diff < 86400) return Math.floor(diff / 3600) + " \u5C0F\u65F6\u524D";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + " \u5929\u524D";
  const d = new Date(ts);
  return d.getMonth() + 1 + "-" + d.getDate();
}
function hmRgba(hex, alpha) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return "rgba(255,255,255," + alpha + ")";
  const n = parseInt(value, 16);
  return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + alpha + ")";
}
function isContentFile(file) {
  return !isIgnoredPath(file.path);
}
var THUMB_IMAGE_EXT = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "heic",
  "heif",
  "ico",
  "tif",
  "tiff"
]);
var THUMB_VIDEO_EXT = /* @__PURE__ */ new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "m4v",
  "flv",
  "wmv",
  "mpeg",
  "mpg"
]);
var THUMB_AUDIO_EXT = /* @__PURE__ */ new Set([
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "aac",
  "opus",
  "wma",
  "aiff"
]);
var THUMB_DOC_EXT = /* @__PURE__ */ new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "epub",
  "odt",
  "ods",
  "odp",
  "rtf",
  "txt"
]);
var THUMB_KIND_LABELS = {
  note: "\u7B14\u8BB0",
  image: "\u56FE\u7247",
  video: "\u89C6\u9891",
  audio: "\u97F3\u9891",
  doc: "\u6587\u6863",
  other: "\u6587\u4EF6"
};
function fileKind(file) {
  const ext = String(file && file.extension || "").toLowerCase();
  if (ext === "md") return "note";
  if (THUMB_IMAGE_EXT.has(ext)) return "image";
  if (THUMB_VIDEO_EXT.has(ext)) return "video";
  if (THUMB_AUDIO_EXT.has(ext)) return "audio";
  if (THUMB_DOC_EXT.has(ext)) return "doc";
  return "other";
}
function stripNoteBody(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return fm ? text.slice(fm[0].length) : text;
}
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
function findNoteMedia(app, body, sourcePath) {
  const re = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  let m;
  while (m = re.exec(body)) {
    let link = String(m[1] || m[2] || "").trim();
    if (!link) continue;
    if (m[2]) {
      try {
        link = decodeURI(link);
      } catch (e) {
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
var WB_TOOLTIP_SCOPE = [
  ".noval-view",
  ".qm-view",
  ".qm-root",
  ".noval-board-leaf",
  ".noval-board-host",
  ".noval-board",
  ".cl-root",
  ".vw-frame",
  ".noval-doctor-content",
  ".noval-export-content",
  ".noval-ai-modal",
  ".noval-settings"
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
    el.setAttribute("aria-label", t);
    el.setAttribute("data-cl-tt", "1");
  } else if (el.getAttribute("data-cl-tt") === "1") {
    el.setAttribute("aria-label", t);
  }
  el.removeAttribute("title");
}
function wbNormalizeTree(root) {
  if (!root || root.nodeType !== 1) return;
  wbNormalizeTitle(root);
  const list = root.querySelectorAll("[title]");
  for (let i = 0; i < list.length; i++) wbNormalizeTitle(list[i]);
}
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
var MODULE_ICONS = [
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
var MODULE_COLORS = [
  "#7c6df2",
  "#3f9c6d",
  "#d9834a",
  "#3f7fd1",
  "#c2568a",
  "#8a6d3b"
];
async function ensureVaultFolder(app, path) {
  const parts = String(path || "").split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? cur + "/" + part : part;
    const found = app.vault.getAbstractFileByPath(cur);
    if (!found) await app.vault.createFolder(cur);
    else if (!Array.isArray(found.children)) throw new Error("\u300C" + cur + "\u300D\u5DF2\u88AB\u540C\u540D\u6587\u4EF6\u5360\u7528");
  }
  return cur;
}
function moduleIdOf(mod) {
  return String(mod && (mod.id || mod.module || mod.name) || "").trim();
}
var ModuleEditorModal = class extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.module = this.options.module || null;
    this.initialName = this.options.initialName || "";
    this.icon = this.module && this.module.icon || MODULE_ICONS[0];
    this.color = this.module && this.module.color || this.options.initialColor || MODULE_COLORS[0];
    this.deleteArmed = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: this.module ? "\u7F16\u8F91\u6A21\u5757" : "\u65B0\u5EFA\u6A21\u5757" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: this.module
        ? "模块就是文件夹：名字改了文件夹跟着改，模块内容始终是那个文件夹里的文件。"
        : "模块就是文件夹：保存时会在库根目录建一个同名文件夹，就像在文件树里新建文件夹一样。"
    });
    let name = this.module ? this.module.name || "" : this.initialName;
    new Setting(contentEl).setName("\u540D\u79F0").setDesc(
      this.module ? "与文件夹同名，保存时一并重命名" : "同时是文件夹名，建在库根目录"
    ).addText(
      (t) => t.setValue(name).setPlaceholder("\u4F8B\u5982\uFF1A\u5065\u8EAB\u8BB0\u5F55").onChange((v) => {
        name = v;
      })
    );
    const iconRow = contentEl.createDiv({ cls: "cl-modalfield" });
    iconRow.createDiv({ cls: "cl-modalfield-label", text: "\u56FE\u6807" });
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
    colorRow.createDiv({ cls: "cl-modalfield-label", text: "\u989C\u8272" });
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
    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    if (this.module && this.options.onDelete) {
      const del = foot.createEl("button", { cls: "cl-btn cl-btn-danger", text: "\u5220\u9664\u6A21\u5757" });
      del.onclick = () => {
        if (!this.deleteArmed) {
          this.deleteArmed = true;
          del.setText("\u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u5220\u9664");
          setTimeout(() => {
            this.deleteArmed = false;
            del.setText("\u5220\u9664\u6A21\u5757");
          }, 3e3);
          return;
        }
        this.close();
        this.options.onDelete(this.module);
      };
    }
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
    const save = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "\u4FDD\u5B58" });
    save.onclick = async () => {
      const finalName = String(name || "").trim();
      if (!finalName) {
        new Notice("\u8BF7\u5148\u586B\u5199\u6A21\u5757\u540D\u79F0");
        return;
      }
      const id = this.module && this.module.id ? this.module.id : "mod-" + Date.now().toString(36);
      const next = Object.assign({}, this.module || {}, {
        id,
        module: this.module && this.module.module ? this.module.module : id,
        name: finalName,
        icon: this.icon,
        color: this.color
      });
      // 新建 = 在库根目录建同名文件夹；已有模块沿用当前文件夹，不在这里改指向
      if (!this.module) next.folder = sanitizeFolderName(finalName);
      else if (!next.folder) next.folder = sanitizeFolderName(this.module.name || finalName);
      if (save.disabled) return;
      save.disabled = true;
      let ok = true;
      try {
        if (this.options.onSave) ok = await this.options.onSave(next);
      } finally {
        save.disabled = false;
      }
      if (ok !== false) this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DeleteFilesModal = class extends Modal {
  constructor(app, files, onConfirm) {
    super(app);
    this.files = files || [];
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", {
      text: this.files.length === 1 ? "\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6\uFF1F" : "\u5220\u9664\u8FD9 " + this.files.length + " \u4E2A\u6587\u4EF6\uFF1F"
    });
    const names = this.files.slice(0, 3).map((f) => f.basename).join("\u3001");
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: this.files.length > 3 ? "\u4F1A\u79FB\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9\uFF1A" + names + " \u7B49 " + this.files.length + " \u4E2A\u6587\u4EF6\u3002" : "\u4F1A\u79FB\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9\uFF1A" + names + "\u3002"
    });
    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
    const remove = foot.createEl("button", { cls: "cl-btn cl-btn-danger", text: "\u5220\u9664" });
    remove.onclick = () => {
      this.close();
      if (this.onConfirm) this.onConfirm();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DeleteModuleModal = class extends Modal {
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
    contentEl.createEl("h2", { text: "\u5220\u9664\u6A21\u5757\u300C" + (this.info.name || "") + "\u300D\uFF1F" });
    const parts = [];
    if (this.info.fileCount) parts.push(this.info.fileCount + " \u4E2A\u6587\u4EF6");
    if (this.info.folderCount) parts.push(this.info.folderCount + " \u4E2A\u5B50\u6587\u4EF6\u5939");
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: parts.length ? "\u4F1A\u8FDE\u540C " + parts.join("\u3001") + "\uFF08\u542B\u5B50\u6A21\u5757\uFF09\u4E00\u8D77\uFF0C\u6309 Obsidian\u300C\u6587\u4EF6\u4E0E\u94FE\u63A5 \u2192 \u5220\u9664\u6587\u4EF6\u300D\u7684\u8BBE\u7F6E\u5904\u7406\u3002" : "\u8FD9\u4E2A\u6A21\u5757\u6587\u4EF6\u5939\u662F\u7A7A\u7684\uFF0C\u4F1A\u6309 Obsidian\u300C\u6587\u4EF6\u4E0E\u94FE\u63A5 \u2192 \u5220\u9664\u6587\u4EF6\u300D\u7684\u8BBE\u7F6E\u5904\u7406\u5E76\u79FB\u9664\u6A21\u5757\u3002"
    });
    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => {
      this.finish(false);
      this.close();
    };
    const ok = foot.createEl("button", { cls: "cl-btn cl-btn-danger", text: "\u5220\u9664\u6587\u4EF6\u5939\u548C\u6A21\u5757" });
    ok.onclick = () => {
      this.finish(true);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
    this.finish(false);
  }
};
var RenameModuleModal = class extends Modal {
  constructor(app, name, onSubmit) {
    super(app);
    this.name = name || "";
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "\u91CD\u547D\u540D\u6A21\u5757" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "\u4F1A\u540C\u6B65\u91CD\u547D\u540D\u6587\u4EF6\u6811\u4E2D\u7684\u6587\u4EF6\u5939\uFF0C\u6A21\u5757\u91CC\u7684\u7B14\u8BB0\u548C\u5B50\u6A21\u5757\u4F1A\u4E00\u8D77\u6539\u540D\u3002"
    });
    let value = this.name;
    let inputEl = null;
    new Setting(contentEl).setName("\u65B0\u540D\u79F0").addText((text) => {
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
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
    const ok = foot.createEl("button", { cls: "cl-btn mod-cta", text: "\u91CD\u547D\u540D" });
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
};
var FolderPickerModal = class extends Modal {
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
    contentEl.createEl("h2", { text: "\u9009\u62E9\u4FDD\u5B58\u6587\u4EF6\u5939" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "\u9009\u4E00\u4E2A\u5DF2\u6709\u7684\u6587\u4EF6\u5939\uFF0C\u6216\u70B9\u4E0B\u9762\u7684\u300C\u65B0\u5EFA\u6587\u4EF6\u5939\u300D\u76F4\u63A5\u5EFA\u4E00\u4E2A\u3002"
    });
    const pickWrap = contentEl.createDiv();
    const input = pickWrap.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: "\u7B5B\u9009\u6587\u4EF6\u5939\u2026" }
    });
    const listEl = pickWrap.createDiv({ cls: "cl-picklist" });
    const empty = pickWrap.createDiv({ cls: "cl-modal-hint" });
    const folders = this.listFolders();
    const draw = () => {
      const q = String(input.value || "").trim().toLowerCase();
      const rows = folders.filter((p) => !q || p.toLowerCase().includes(q));
      listEl.empty();
      empty.setText(
        folders.length ? "\u6CA1\u6709\u5339\u914D\u7684\u6587\u4EF6\u5939\u3002" : "\u5E93\u91CC\u8FD8\u6CA1\u6709\u6587\u4EF6\u5939\uFF0C\u70B9\u4E0B\u9762\u7684\u300C\u65B0\u5EFA\u6587\u4EF6\u5939\u300D\u5EFA\u4E00\u4E2A\u3002"
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
    const form = contentEl.createDiv({ cls: "cl-foldernew is-hidden" });
    form.createDiv({ cls: "cl-modalfield-label", text: "\u65B0\u6587\u4EF6\u5939\u8DEF\u5F84" });
    const nameInput = form.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: "\u4F8B\u5982\uFF1A01-Notes \u6216 10-Modules/\u5065\u8EAB\u8BB0\u5F55" }
    });
    form.createDiv({
      cls: "cl-modal-hint",
      text: "\u652F\u6301\u591A\u7EA7\u8DEF\u5F84\uFF0C\u521B\u5EFA\u540E\u4F1A\u7ACB\u5373\u51FA\u73B0\u5728 Obsidian \u6587\u4EF6\u6811\u91CC\u3002"
    });
    const formFoot = form.createDiv({ cls: "cl-modalfoot" });
    const backBtn = formFoot.createEl("button", { cls: "cl-btn", text: "\u8FD4\u56DE" });
    const okBtn = formFoot.createEl("button", {
      cls: "cl-btn cl-btn-accent",
      text: "\u521B\u5EFA\u5E76\u4F7F\u7528"
    });
    const showForm = (on) => {
      form.classList.toggle("is-hidden", !on);
      pickWrap.classList.toggle("is-hidden", on);
      if (on) nameInput.focus();
    };
    backBtn.onclick = () => showForm(false);
    okBtn.onclick = async () => {
      const value = String(nameInput.value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!value) {
        new Notice("\u8BF7\u8F93\u5165\u6587\u4EF6\u5939\u540D\u79F0");
        return;
      }
      if (value.split("/").some((part) => !part || part === "." || part === "..")) {
        new Notice("\u8DEF\u5F84\u4E0D\u5408\u6CD5\uFF0C\u8BF7\u91CD\u65B0\u586B\u5199");
        return;
      }
      const found = this.app.vault.getAbstractFileByPath(value);
      if (found && !Array.isArray(found.children)) {
        new Notice("\u300C" + value + "\u300D\u5DF2\u88AB\u540C\u540D\u6587\u4EF6\u5360\u7528");
        return;
      }
      if (!found) {
        try {
          await this.ensureFolder(value);
        } catch (error) {
          new Notice("\u521B\u5EFA\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
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
      text: "\u65B0\u5EFA\u6587\u4EF6\u5939"
    });
    create.onclick = () => {
      showForm(true);
      nameInput.focus();
    };
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ModulePickerModal = class extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.expanded = /* @__PURE__ */ new Set();
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "\u5F52\u5165\u6A21\u5757" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "\u6309\u6587\u4EF6\u6811\u5C42\u7EA7\u5C55\u793A\uFF0C\u70B9\u4EFB\u610F\u4E00\u7EA7\u6A21\u5757\u5373\u53EF\u5F52\u5165\u3002\u9009\u4E2D\u7684\u6587\u4EF6\u4F1A\u79FB\u52A8\u5230\u8BE5\u6A21\u5757\u7684\u4FDD\u5B58\u6587\u4EF6\u5939\uFF0C\u5E76\u8BB0\u5F55\u5F52\u5C5E\uFF1B\u7B14\u8BB0\u540C\u65F6\u5199\u5165 module \u5B57\u6BB5\u3002"
    });
    this.listEl = contentEl.createDiv({ cls: "cl-picklist cl-modtree cl-modpick" });
    const expandAll = (mod) => {
      const children = this.options.getChildren ? this.options.getChildren(mod) : [];
      if (!children.length) return;
      this.expanded.add(moduleIdOf(mod));
      children.forEach(expandAll);
    };
    const roots = this.options.getRootModules ? this.options.getRootModules() : [];
    roots.forEach(expandAll);
    this.renderList();
    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const create = foot.createEl("button", { cls: "cl-btn", text: "\u65B0\u5EFA\u6A21\u5757\u2026" });
    create.onclick = () => {
      this.close();
      if (this.options.onCreate) this.options.onCreate();
    };
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
  }
  renderList() {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const roots = this.options.getRootModules ? this.options.getRootModules() : [];
    if (!roots.length) {
      list.createDiv({ cls: "cl-modal-hint", text: "\u8FD8\u6CA1\u6709\u6A21\u5757\uFF0C\u70B9\u4E0B\u9762\u7684\u300C\u65B0\u5EFA\u6A21\u5757\u2026\u300D\u3002" });
      return;
    }
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
        toggle.onclick = (event) => {
          event.stopPropagation();
          if (isOpen) this.expanded.delete(key);
          else this.expanded.add(key);
          this.renderList();
        };
      } else {
        toggle.addClass("is-blank");
      }
      const iconEl = row.createDiv({ cls: "cl-pickicon" });
      const index = all.indexOf(mod);
      const tint = index >= 0 ? index % 5 : depth % 5;
      iconEl.addClass("cl-tint-" + tint);
      iconEl.style.setProperty("--dot-color", mod.color || "var(--tint)");
      setIcon(iconEl, mod.icon || (children.length ? "folder" : "file-text"));
      const main = row.createDiv({ cls: "cl-modrow-main" });
      main.createDiv({ cls: "cl-modrow-name", text: mod.name });
      const folder = this.options.getFolder ? this.options.getFolder(mod) : mod.folder || "";
      if (folder && folder !== mod.name) main.createDiv({ cls: "cl-modrow-path", text: folder });
      row.createDiv({ cls: "cl-modpick-go", text: "\u5F52\u5165" });
      row.onclick = () => {
        this.close();
        if (this.options.onPick) this.options.onPick(mod);
      };
      if (children.length && isOpen) children.forEach((child) => draw(child, depth + 1));
    };
    roots.forEach((mod) => draw(mod, 0));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ModuleManagerModal = class extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.expanded = /* @__PURE__ */ new Set();
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "\u7BA1\u7406\u6A21\u5757" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "\u6309\u6587\u4EF6\u6811\u5C42\u7EA7\u5C55\u793A\u3002\u5220\u9664\u6A21\u5757\u548C Obsidian \u5220\u9664\u6587\u4EF6\u5939\u4E00\u81F4\uFF1A\u6574\u4E2A\u6587\u4EF6\u5939\u8FDE\u540C\u6587\u4EF6\u548C\u5B50\u6587\u4EF6\u5939\uFF08\u542B\u5B50\u6A21\u5757\uFF09\u4E00\u8D77\u6309\u300C\u5220\u9664\u6587\u4EF6\u300D\u8BBE\u7F6E\u5904\u7406\u3002"
    });
    this.listEl = contentEl.createDiv({ cls: "cl-picklist cl-modtree" });
    this.renderList();
    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const create = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "\u65B0\u5EFA\u6A21\u5757" });
    create.onclick = () => {
      this.close();
      if (this.options.onCreate) this.options.onCreate();
    };
    const close = foot.createEl("button", { cls: "cl-btn", text: "\u5173\u95ED" });
    close.onclick = () => this.close();
  }
  renderList() {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const roots = this.options.getRootModules ? this.options.getRootModules() : [];
    if (!roots.length) {
      list.createDiv({ cls: "cl-modal-hint", text: "\u8FD8\u6CA1\u6709\u6A21\u5757\uFF0C\u70B9\u4E0B\u9762\u7684\u300C\u65B0\u5EFA\u6A21\u5757\u300D\u3002" });
      return;
    }
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
      const edit = row.createEl("button", { cls: "cl-btn", text: "\u7F16\u8F91" });
      edit.onclick = () => {
        this.close();
        if (this.options.onEdit) this.options.onEdit(mod);
      };
      const del = row.createEl("button", { cls: "cl-btn cl-btn-danger", text: "\u5220\u9664" });
      del.onclick = async () => {
        if (!this.options.onDelete) return;
        await this.options.onDelete(mod);
        this.renderList();
      };
      if (children.length && isOpen) children.forEach((child) => draw(child, depth + 1));
    };
    roots.forEach((mod) => draw(mod, 0));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NamePromptModal = class extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: this.options.title || "\u65B0\u5EFA" });
    if (this.options.hint) {
      contentEl.createDiv({ cls: "cl-modal-hint", text: this.options.hint });
    }
    const input = contentEl.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: this.options.placeholder || "\u8BF7\u8F93\u5165\u540D\u79F0" }
    });
    const foot = contentEl.createDiv({ cls: "cl-modalfoot" });
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
    const ok = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "\u521B\u5EFA" });
    ok.onclick = () => {
      const value = String(input.value || "").trim();
      if (!value) {
        new Notice("\u8BF7\u8F93\u5165\u540D\u79F0");
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
};
var AddFilesModal = class extends Modal {
  constructor(app, files, onConfirm) {
    super(app);
    this.files = files || [];
    this.onConfirm = onConfirm;
    this.selected = /* @__PURE__ */ new Set();
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("cl-modaleditor");
    contentEl.createEl("h2", { text: "\u5F52\u5165\u6587\u4EF6" });
    contentEl.createDiv({
      cls: "cl-modal-hint",
      text: "\u52FE\u9009\u8981\u79FB\u8FDB\u5F53\u524D\u6A21\u5757\u7684\u7B14\u8BB0\uFF0C\u786E\u8BA4\u540E\u4F1A\u5199\u5165 module \u5B57\u6BB5\u5E76\u79FB\u52A8\u5230\u6A21\u5757\u6587\u4EF6\u5939\u3002"
    });
    const filter = contentEl.createEl("input", {
      cls: "cl-modalfilter",
      attr: { type: "text", placeholder: "\u7B5B\u9009\u6807\u9898\u6216\u8DEF\u5F84\u2026" }
    });
    const list = contentEl.createDiv({ cls: "cl-picklist" });
    const empty = contentEl.createDiv({ cls: "cl-modal-hint" });
    const draw = () => {
      const q = String(filter.value || "").trim().toLowerCase();
      const rows = this.files.filter((f) => !q || f.path.toLowerCase().includes(q));
      list.empty();
      empty.setText(this.files.length ? "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0\u3002" : "\u5E93\u91CC\u6CA1\u6709\u53EF\u5F52\u5165\u7684\u7B14\u8BB0\u3002");
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
    const cancel = foot.createEl("button", { cls: "cl-btn", text: "\u53D6\u6D88" });
    cancel.onclick = () => this.close();
    const ok = foot.createEl("button", { cls: "cl-btn cl-btn-accent", text: "\u5F52\u5165" });
    ok.onclick = () => {
      const chosen = this.files.filter((file) => this.selected.has(file.path));
      if (!chosen.length) {
        new Notice("\u8BF7\u5148\u52FE\u9009\u7B14\u8BB0");
        return;
      }
      this.close();
      if (this.onConfirm) this.onConfirm(chosen);
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
/* ==================== Noval 全局搜索（仅插件内） ====================
   完全独立于 Obsidian 搜索：自绘 Modal、只读插件范围内的文件、
   不注册全局热键、不读写 Obsidian 搜索状态。 */
var NVGS_KIND_LABEL = { note: "笔记", canvas: "画布", card: "速记", module: "模块" };
var NVGS_KIND_ICON = { note: "file-text", canvas: "layout-grid", card: "sticky-note", module: "folder" };

function openGlobalSearch(view) {
  if (!view) return;
  try {
    new NovalGlobalSearchModal(view.app, view).open();
  } catch (e) {
  }
}

/** 跳到模块页后定位到具体笔记，滚动并短暂高亮 */
function nvFocusNote(view, modId, path) {
  if (!view) return;
  view.go(modId);
  const find = () => {
    const nodes = view.contentEl.querySelectorAll(".cl-md-tile[data-path], .cl-mdv-row[data-path]");
    for (const node of nodes) {
      if (node.dataset.path === path) return node;
    }
    return null;
  };
  const attempt = (left) => {
    const el = find();
    if (!el) {
      if (left > 0) window.setTimeout(() => attempt(left - 1), 70);
      return;
    }
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (e) {
      el.scrollIntoView();
    }
    el.classList.add("is-flash");
    new Notice("已定位到笔记「" + String(path.split("/").pop() || "").replace(/\.md$/i, "") + "」");
    window.setTimeout(() => el.classList.remove("is-flash"), 1900);
  };
  window.setTimeout(() => attempt(16), 50);
}

function nvSearchBody(raw) {
  return String(raw || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function nvAsList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,，\s]+/).map((v) => v.trim()).filter(Boolean);
  return [];
}

function nvHighlight(text, words) {
  const raw = String(text == null ? "" : text);
  const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (words || []).filter(Boolean);
  if (!list.length) return esc;
  const pattern = list
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  if (!pattern) return esc;
  try {
    return esc.replace(new RegExp("(" + pattern + ")", "gi"), "<mark>$1</mark>");
  } catch (e) {
    return esc;
  }
}

function nvSearchSnippet(text, words) {
  const raw = String(text || "");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  let at = -1;
  for (const word of words || []) {
    const i = lower.indexOf(String(word).toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return raw.replace(/\s+/g, " ").slice(0, 70);
  const start = Math.max(0, at - 26);
  const end = Math.min(raw.length, at + 44);
  return (start > 0 ? "…" : "") + raw.slice(start, end).replace(/\s+/g, " ") + (end < raw.length ? "…" : "");
}

function nvParseSearchQuery(raw) {
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
  const out = { text: [], tags: [], kinds: [] };
  for (const token of tokens) {
    if (token.startsWith("#") && token.length > 1) {
      out.tags.push(token.slice(1).toLowerCase());
    } else if (/^kind:(note|canvas|card|module)$/i.test(token)) {
      out.kinds.push(token.split(":")[1].toLowerCase());
    } else {
      out.text.push(token.toLowerCase());
    }
  }
  return out;
}

function nvDocScore(doc, q) {
  if (q.kinds.length && !q.kinds.includes(doc.kind)) return -1;
  for (const tag of q.tags) {
    if (!doc.tags.some((item) => String(item).toLowerCase().includes(tag))) return -1;
  }
  let score = 0;
  const title = String(doc.title || "").toLowerCase();
  for (const word of q.text) {
    const inTitle = title.indexOf(word);
    if (inTitle >= 0) {
      score += inTitle === 0 ? (title === word ? 1000 : 800) : 620;
      continue;
    }
    if (doc.aliases.some((item) => item.toLowerCase().includes(word))) { score += 500; continue; }
    if (doc.tags.some((item) => item.toLowerCase().includes(word))) { score += 460; continue; }
    if (doc.headings.some((item) => item.toLowerCase().includes(word))) { score += 420; continue; }
    if (String(doc.path || "").toLowerCase().includes(word)) { score += 280; continue; }
    const body = doc.text || "";
    if (body.indexOf(word) < 0) return -1;
    let hits = 0;
    let from = 0;
    while (hits < 8) {
      const i = body.indexOf(word, from);
      if (i < 0) break;
      hits += 1;
      from = i + word.length;
    }
    score += 160 + hits * 18;
  }
  if (doc.starred) score += 24;
  return score + Math.min(30, Math.max(0, (Number(doc.mtime) || 0) / 1e12 * 4));
}

function nvModuleForPath(view, path, modules) {
  let best = null;
  let bestLen = -1;
  for (const mod of modules || view.getModules()) {
    const folder = String(view.moduleTargetFolder(mod) || "").replace(/^\/+|\/+$/g, "");
    if (!folder) continue;
    if ((path === folder || path.startsWith(folder + "/")) && folder.length > bestLen) {
      best = mod;
      bestLen = folder.length;
    }
  }
  return best;
}

async function nvBuildSearchDocs(view) {
  const app = view.app;
  const plugin = view.plugin;
  const docs = [];
  const seen = new Set();
  const modules = view.getModules();
  const notesPlugin = (plugin && plugin.childPlugins && plugin.childPlugins[NOTES_ID]) ||
    (app.plugins && app.plugins.plugins && app.plugins.plugins[LEGACY.notesId]);
  const cardFolder = String((notesPlugin && notesPlugin.settings && notesPlugin.settings.folderPath) || CARD_FOLDER)
    .replace(/^\/+|\/+$/g, "");

  const addNote = (file) => {
    if (!file || seen.has(file.path)) return;
    if (String(file.extension || "").toLowerCase() !== "md") return;
    if (cardFolder && (file.path === cardFolder || String(file.path || "").startsWith(cardFolder + "/"))) return;
    seen.add(file.path);
    docs.push({
      key: "note:" + file.path,
      kind: "note",
      title: file.basename,
      subtitle: "",
      path: file.path,
      moduleName: "",
      group: "",
      tags: [],
      aliases: [],
      headings: [],
      text: "",
      mtime: (file.stat && file.stat.mtime) || 0,
      file
    });
  };

  for (const mod of modules) {
    docs.push({
      key: "module:" + (mod.id || mod.name),
      kind: "module",
      title: mod.name || mod.folder || mod.id,
      subtitle: "模块",
      path: String(view.moduleTargetFolder(mod) || ""),
      moduleName: mod.name || "",
      group: "",
      tags: [],
      aliases: [],
      headings: [],
      text: String(mod.name || "") + " " + String(mod.folder || ""),
      mtime: 0,
      modId: mod.id,
      mod
    });
    const dir = String(view.moduleTargetFolder(mod) || "");
    if (!dir) continue;
    let files = [];
    try {
      files = view.folderFiles(dir, true);
    } catch (e) {
      files = [];
    }
    for (const file of files) addNote(file);
  }

  try {
    for (const file of view.inboxFiles()) addNote(file);
  } catch (e) {
  }

  const noteDocs = docs.filter((doc) => doc.kind === "note");
  await Promise.all(noteDocs.map(async (doc) => {
    const mod = nvModuleForPath(view, doc.path, modules);
    doc.moduleName = mod ? mod.name : "";
    doc.subtitle = doc.moduleName || "收件箱";
    try {
      const raw = await app.vault.cachedRead(doc.file);
      const body = nvSearchBody(raw);
      doc.text = body.toLowerCase();
      doc.sample = body;
      const cache = app.metadataCache.getFileCache(doc.file);
      const fm = (cache && cache.frontmatter) || {};
      doc.aliases = nvAsList(fm.aliases || fm.alias);
      doc.tags = nvAsList(fm.tags)
        .concat(((cache && cache.tags) || []).map((item) => String((item && item.tag) || "")))
        .map((tag) => tag.replace(/^#/, ""))
        .filter(Boolean);
      doc.headings = ((cache && cache.headings) || [])
        .map((item) => String((item && item.heading) || ""))
        .filter(Boolean);
    } catch (e) {
    }
  }));

  const rootFolder = String((plugin && plugin.novalFolder) || "").replace(/^\/+|\/+$/g, "");
  const boards = app.vault.getFiles().filter((file) => {
    if (String(file.extension || "").toLowerCase() !== BOARD_EXT) return false;
    if (!rootFolder) return true;
    return String(file.path || "").startsWith(rootFolder + "/");
  });
  for (const file of boards) {
    let text = "";
    try {
      const data = JSON.parse(await app.vault.cachedRead(file));
      const list = Array.isArray(data && data.nodes) ? data.nodes : [];
      const parts = [];
      for (const node of list) {
        if (!node) continue;
        if (node.text) parts.push(String(node.text));
        if (node.label) parts.push(String(node.label));
        if (node.file) parts.push(String(node.file));
        if (parts.join(" ").length > 4000) break;
      }
      text = parts.join(" ");
    } catch (e) {
    }
    const rel = rootFolder ? String(file.path || "").slice(rootFolder.length + 1) : String(file.path || "");
    const slash = rel.lastIndexOf("/");
    const group = slash > 0 ? rel.slice(0, slash) : "";
    const stars = (plugin && plugin.settings && plugin.settings.boardStars) || {};
    docs.push({
      key: "canvas:" + file.path,
      kind: "canvas",
      title: file.basename,
      subtitle: group || "画布",
      path: file.path,
      moduleName: "",
      group,
      tags: [],
      aliases: [],
      headings: [],
      text: text.toLowerCase(),
      sample: text,
      mtime: (file.stat && file.stat.mtime) || 0,
      starred: !!stars[file.path],
      file
    });
  }

  try {
    if (notesPlugin && typeof notesPlugin.readAllCards === "function") {
      const cards = await notesPlugin.readAllCards();
      for (const card of cards || []) {
        if (!card) continue;
        const text = String(card.body != null ? card.body : card.text || "").trim();
        const title = text ? text.split(/\n/)[0].slice(0, 46) : "速记 " + (card.date || "") + " " + (card.time || "");
        const stamp = Date.parse(String(card.date || "") + "T" + String(card.time || "00:00")) || 0;
        const filePath = card.filePath || (card.file && card.file.path ? card.file.path : String(card.file || ""));
        docs.push({
          key: "card:" + filePath + ":" + (card.date || "") + ":" + (card.time || "") + ":" + (card.id || ""),
          kind: "card",
          title,
          subtitle: [card.date, card.time].filter(Boolean).join(" "),
          path: filePath,
          moduleName: "速记",
          group: "",
          tags: (card.tags || []).map((tag) => String(tag)),
          aliases: [],
          headings: [],
          text: String(card.bodyLower || text.toLowerCase()),
          sample: text,
          mtime: stamp,
          card
        });
      }
    }
  } catch (e) {
  }

  return docs;
}

async function nvEnsureSearchDocs(view) {
  if (view._nvSearchDocs && !view._nvSearchDirty) return view._nvSearchDocs;
  view._nvSearchDocs = await nvBuildSearchDocs(view);
  view._nvSearchDirty = false;
  return view._nvSearchDocs;
}

var NovalGlobalSearchModal = class extends Modal {
  constructor(app, view) {
    super(app);
    this.view = view;
    this.filter = "all";
    this.docs = null;
    this.query = "";
    this.rows = [];
    this.sel = 0;
    this.loading = false;
  }
  onOpen() {
    this.modalEl.addClass("nvgs-modal");
    this.contentEl.addClass("nvgs-body");
    this.contentEl.empty();

    const head = this.contentEl.createDiv({ cls: "nvgs-head" });
    const headIcon = head.createSpan({ cls: "nvgs-headico" });
    setIcon(headIcon, "search");
    this.input = head.createEl("input", {
      cls: "nvgs-input",
      attr: { type: "text", placeholder: "搜索笔记、画布、速记、模块…", spellcheck: "false" }
    });
    this.countEl = head.createSpan({ cls: "nvgs-headcount" });
    head.createEl("kbd", { cls: "nvgs-esckbd", text: "Esc" });

    const chips = this.contentEl.createDiv({ cls: "nvgs-chips" });
    this.chipEls = new Map();
    for (const item of [
      { key: "all", label: "全部" },
      { key: "note", label: "笔记" },
      { key: "canvas", label: "画布" },
      { key: "card", label: "速记" },
      { key: "module", label: "模块" }
    ]) {
      const chip = chips.createDiv({ cls: "nvgs-chip" + (item.key === "all" ? " is-on" : ""), text: item.label });
      chip.onclick = () => {
        this.filter = item.key;
        this.syncChips();
        this.runQuery();
      };
      this.chipEls.set(item.key, chip);
    }

    this.listEl = this.contentEl.createDiv({ cls: "nvgs-list" });
    this.listEl.createDiv({ cls: "nvgs-empty", text: "正在建立搜索索引…" });

    const foot = this.contentEl.createDiv({ cls: "nvgs-foot" });
    foot.createSpan({ text: "↑↓ 选择" });
    foot.createSpan({ text: "↵ 打开" });
    foot.createSpan({ text: "⌘↵ 新标签" });
    foot.createSpan({ text: "#标签 / kind:note 精确筛选" });

    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.runQuery();
    });
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    window.setTimeout(() => {
      if (this.input) this.input.focus();
    }, 0);
    this.loadIndex();
  }
  onClose() {
    this.contentEl.empty();
    this.input = null;
  }
  syncChips() {
    for (const [key, el] of this.chipEls) el.classList.toggle("is-on", key === this.filter);
  }
  async loadIndex() {
    this.loading = true;
    try {
      this.docs = await nvEnsureSearchDocs(this.view);
    } catch (e) {
      this.docs = [];
    }
    this.loading = false;
    this.runQuery();
  }
  runQuery() {
    if (!this.docs || this.loading) return;
    const q = nvParseSearchQuery(this.query);
    const pool = this.filter === "all" ? this.docs : this.docs.filter((doc) => doc.kind === this.filter);
    const matched = [];
    for (const doc of pool) {
      const score = nvDocScore(doc, q);
      if (score >= 0) matched.push({ doc, score });
    }
    matched.sort((a, b) => b.score - a.score || (Number(b.doc.mtime) || 0) - (Number(a.doc.mtime) || 0));
    const limited = [];
    const perKind = {};
    for (const item of matched) {
      const kind = item.doc.kind;
      perKind[kind] = perKind[kind] || 0;
      if (perKind[kind] >= 8) continue;
      limited.push(item.doc);
      perKind[kind] += 1;
      if (limited.length >= 48) break;
    }
    this.rows = limited;
    this.sel = 0;
    this.renderList(q.text);
  }
  renderList(words) {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const hasQuery = !!String(this.query || "").trim();
    this.countEl.setText(hasQuery ? String(this.rows.length) + " 项" : "");
    if (this.loading) {
      list.createDiv({ cls: "nvgs-empty", text: "正在建立搜索索引…" });
      return;
    }
    if (!hasQuery) {
      const map = new Map((this.docs || []).map((doc) => [doc.key, doc]));
      const recent = (this.view.plugin._nvSearchRecent || [])
        .map((key) => map.get(key))
        .filter((doc) => doc && (this.filter === "all" || doc.kind === this.filter));
      this.rows = recent;
      this.sel = 0;
      if (!recent.length) {
        list.createDiv({
          cls: "nvgs-empty",
          text: "输入关键词开始搜索：标题、正文、#标签、kind:note"
        });
        return;
      }
      list.createDiv({ cls: "nvgs-ghead", text: "最近访问" });
      recent.forEach((doc, index) => this.renderRow(doc, index, words));
      this.markSelection();
      return;
    }
    if (!this.rows.length) {
      list.createDiv({ cls: "nvgs-empty", text: "没有匹配的结果" });
      return;
    }
    let lastKind = "";
    this.rows.forEach((doc, index) => {
      if (this.filter === "all" && doc.kind !== lastKind) {
        lastKind = doc.kind;
        list.createDiv({ cls: "nvgs-ghead", text: NVGS_KIND_LABEL[doc.kind] || "" });
      }
      this.renderRow(doc, index, words);
    });
    this.markSelection();
  }
  renderRow(doc, index, words) {
    const row = this.listEl.createDiv({ cls: "nvgs-row" });
    row.dataset.index = String(index);
    const icon = row.createSpan({ cls: "nvgs-rowico nvgs-kind-" + doc.kind });
    setIcon(icon, NVGS_KIND_ICON[doc.kind] || "file");
    const main = row.createDiv({ cls: "nvgs-rowmain" });
    const title = main.createDiv({ cls: "nvgs-rowtitle" });
    title.innerHTML = nvHighlight(doc.title, words);
    const snippet = words.length && doc.kind !== "card" ? nvSearchSnippet(doc.sample || doc.text, words) : "";
    const sub = main.createDiv({ cls: "nvgs-rowsub" });
    sub.innerHTML = nvHighlight(snippet || doc.subtitle || doc.path || "", words);
    row.createSpan({
      cls: "nvgs-rowmeta",
      text: doc.kind === "note" ? (doc.moduleName || "收件箱") : (doc.subtitle || "")
    });
    row.onclick = () => {
      this.sel = index;
      this.openRow(index, false);
    };
    row.onauxclick = (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.openRow(index, true);
      }
    };
    row.onmouseenter = () => {
      this.sel = index;
      this.markSelection();
    };
  }
  markSelection() {
    if (!this.listEl) return;
    const rows = this.listEl.querySelectorAll(".nvgs-row");
    rows.forEach((el) => {
      const on = Number(el.dataset.index) === this.sel;
      el.classList.toggle("is-sel", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }
  onKey(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.openRow(this.sel, event.metaKey || event.ctrlKey);
    }
  }
  move(step) {
    if (!this.rows.length) return;
    this.sel = (this.sel + step + this.rows.length) % this.rows.length;
    this.markSelection();
  }
  openRow(index, newTab) {
    const doc = this.rows[index];
    if (!doc) return;
    this.remember(doc);
    this.close();
    const view = this.view;
    const app = this.app;
    try {
      if (doc.kind === "module") {
        view.go(doc.modId);
        return;
      }
      if (doc.kind === "card") {
        if (newTab) {
          const path = doc.path;
          if (path) app.workspace.openLinkText(path + (doc.card && doc.card.id ? "#^" + doc.card.id : ""), "", true);
        } else {
          view.openCardInNotes(doc.card);
        }
        return;
      }
      if (doc.kind === "canvas" || newTab) {
        app.workspace.getLeaf("tab").openFile(doc.file);
        return;
      }
      const mod = view.moduleForFile ? view.moduleForFile(doc.file) : null;
      if (mod) {
        nvFocusNote(view, moduleIdOf(mod), doc.path);
        return;
      }
      app.workspace.getLeaf("tab").openFile(doc.file);
    } catch (e) {
    }
  }
  remember(doc) {
    const plugin = this.view && this.view.plugin;
    if (!plugin) return;
    const list = Array.isArray(plugin._nvSearchRecent) ? plugin._nvSearchRecent : [];
    plugin._nvSearchRecent = [doc.key].concat(list.filter((key) => key !== doc.key)).slice(0, 10);
  }
};

var NovalView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.active = "home";
    this.focus = false;
    this.navCollapsed = !!(plugin && plugin.settings && plugin.settings.navCollapsed);
    this._mdFiles = [];
    this._contentFiles = [];
    this._ownership = null;
    this._needsRefresh = false;
    this.gallery = null;
    this.notes = null;
    this._navSyncTimer = null;
    this._cardNavTimer = null;
    this._navExpanded = /* @__PURE__ */ new Set();
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Noval";
  }
  getIcon() {
    return PLUGIN_ICON_ID;
  }
  async onOpen() {
    this.containerEl.addClass("noval-view");
    this.contentEl.addClass("cl-content");
    this.render();
    this.watchWidth();
    const markSearchDirty = () => {
      this._nvSearchDirty = true;
    };
    this.registerEvent(this.app.vault.on("create", markSearchDirty));
    this.registerEvent(this.app.vault.on("modify", markSearchDirty));
    this.registerEvent(this.app.vault.on("delete", markSearchDirty));
    this.registerEvent(this.app.vault.on("rename", markSearchDirty));
    // 画布集里新建/删除画布只做局部刷新，导航栏不会重绘，
    // 所以这里跟画布集用同一个 60ms 节拍把「画布」徽标校准一次。
    // 只在画布页补：其他页面走的是整页重绘，数字本来就是新的。
    const syncBoardNavSoon = () => {
      if (this.active !== "canvas") return;
      if (this._navSyncTimer) window.clearTimeout(this._navSyncTimer);
      this._navSyncTimer = window.setTimeout(() => {
        this._navSyncTimer = null;
        this.syncBoardNavCount();
      }, 60);
    };
    // 不只看 .noval：删掉整个分组文件夹时事件落在文件夹上，子文件不再单独报事件
    this.registerEvent(this.app.vault.on("create", () => syncBoardNavSoon()));
    this.registerEvent(this.app.vault.on("delete", () => syncBoardNavSoon()));
    this.registerEvent(this.app.vault.on("rename", () => syncBoardNavSoon()));
    // 卡片笔记徽标：在卡片页由面板读完后自己推数；
    // 停在画布页时用快速记录写进来的卡片没人管，这里补一次（其它页面会整页重绘）。
    const inCardFolder = (path) => String(path || "").indexOf(CARD_FOLDER + "/") === 0;
    const syncCardNavSoon = (file, oldPath) => {
      if (this.active !== "canvas") return;
      if (!inCardFolder(file && file.path) && !inCardFolder(oldPath)) return;
      if (this._cardNavTimer) window.clearTimeout(this._cardNavTimer);
      this._cardNavTimer = window.setTimeout(() => {
        this._cardNavTimer = null;
        void this.recountCardNav();
      }, 300);
    };
    this.registerEvent(this.app.vault.on("create", (file) => syncCardNavSoon(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => syncCardNavSoon(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => syncCardNavSoon(file, oldPath)));
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (String(event.key || "").toLowerCase() !== "k") return;
      const target = event.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      openGlobalSearch(this);
    });
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
    if (this._navSyncTimer) {
      window.clearTimeout(this._navSyncTimer);
      this._navSyncTimer = null;
    }
    if (this._cardNavTimer) {
      window.clearTimeout(this._cardNavTimer);
      this._cardNavTimer = null;
    }
    document.body.classList.remove("noval-focus");
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
    const pad = Math.max(12, Math.min(28, Math.round(w * 0.026)));
    app.style.setProperty("--cl-pad", pad + "px");
  }
  getModules() {
    const list = this.plugin.settings.modules;
    if (Array.isArray(list)) return list;
    return DEFAULT_MODULES;
  }
  contentFiles() {
    return this._contentFiles.length ? this._contentFiles : this.app.vault.getMarkdownFiles().filter(isContentFile);
  }
  /* 收件箱 / 模块归属用的全量清单：
   * 整个 vault 的 Markdown 都算，只排除卡片笔记的月度聚合文件。
   * 白板是 .noval，不在 getMarkdownFiles() 里，天然被排除。
   * 不再按顶层文件夹白名单过滤，避免文件在文件树里一挪位置就“消失”。 */
  vaultFiles() {
    return this.app.vault.getMarkdownFiles().filter(
      (file) => !isIgnoredPath(file.path) && !file.path.startsWith(CARD_FOLDER + "/")
    );
  }
  moduleKeys(mod) {
    return [mod.id, mod.module, mod.name].filter(Boolean).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  }
  // frontmatter 的 module 字段：英文 id 和中文名都认，数组写法也认。
  explicitModule(fm) {
    const raw = fm ? fm.module : null;
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
    }
    const value = raw === null || raw === void 0 ? "" : String(raw).trim().toLowerCase();
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
    return moduleFolderOf(mod);
  }
  /* 写入模块条目。一个文件夹只对应一个模块——文件树里也不可能有两个同名文件夹，
   * 所以同一个文件夹上的其它条目（自动同步的 dir:、旧版留下的重复）一律让位。 */
  setModuleEntry(next) {
    const folder = this.moduleTargetFolder(next).toLowerCase();
    const list = this.getModules().slice();
    const idx = list.findIndex((m) => m.id === next.id);
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    this.plugin.settings.modules = list.filter(
      (m) => m === next || !folder || this.moduleTargetFolder(m).toLowerCase() !== folder
    );
  }
  // 目标同名时加 -1 / -2，避免覆盖模块目录里已有的文件。
  uniqueFilePath(dir, file) {
    const ext = file.extension ? "." + file.extension : "";
    const name = file.basename || file.name || "\u672A\u547D\u540D";
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
      (mod) => this.moduleTargetFolder(mod).toLowerCase() === dir.toLowerCase()
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
    return node.children.filter((child) => Array.isArray(child.children)).filter((child) => !this.isModuleFolderIgnored(child.path)).sort(compareVaultNodes).map((child) => this.moduleForFolder(child.path)).filter(Boolean);
  }
  moduleNoteFiles(mod) {
    return this.moduleFiles(mod).filter(
      (file) => String(file.extension || "").toLowerCase() === "md"
    );
  }
  // 含所有后代的笔记数；循环引用时用 visited 兜底，避免死循环
  moduleTreeNoteFiles(mod, visited) {
    const seenIds = visited || /* @__PURE__ */ new Set();
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
    const dirs = mods.map((mod) => this.moduleTargetFolder(mod)).filter(Boolean);
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
      dir.slice(rootDir.length + 1).split("/").filter(Boolean).forEach((seg) => {
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
  promptSubmodule(parent, title) {
    const parentDir = this.moduleTargetFolder(parent);
    new NamePromptModal(this.app, {
      title: title || "\u65B0\u5EFA\u5B50\u6A21\u5757",
      hint: "\u4F1A\u5728\u300C" + (parentDir || "\u5E93\u6839\u76EE\u5F55") + "\u300D\u4E0B\u65B0\u5EFA\u540C\u540D\u6587\u4EF6\u5939\uFF1B\u5B50\u6A21\u5757\u8DDF\u968F\u6587\u4EF6\u5939\uFF0C\u4E0D\u4F1A\u91CD\u590D\u5B58\u5C42\u7EA7\u914D\u7F6E\u3002",
      placeholder: "\u4F8B\u5982\uFF1A\u5BA2\u6237",
      onSubmit: async (raw) => {
        const name = sanitizeFolderName(raw);
        if (!name) return;
        const dir = parentDir ? parentDir + "/" + name : name;
        const existing = this.getModules().find(
          (mod) => this.moduleTargetFolder(mod).toLowerCase() === dir.toLowerCase()
        );
        if (existing) {
          this.go(moduleIdOf(existing));
          return;
        }
        const node = this.app.vault.getAbstractFileByPath(dir);
        if (node && !Array.isArray(node.children)) {
          new Notice("\u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6\u300C" + dir + "\u300D\uFF0C\u6362\u4E2A\u540D\u5B57\u5427");
          return;
        }
        const id = "mod-" + Date.now().toString(36);
        const entry = {
          id,
          module: id,
          name,
          folder: dir,
          icon: "folder",
          color: parent.color || void 0
        };
        // 先登记再建文件夹：文件夹的 create 事件会触发「根目录文件夹→模块」同步，
        // 反过来的话配置里会多出一条 dir: 同名模块。
        const prevList = this.getModules();
        this.setModuleEntry(entry);
        try {
          await ensureVaultFolder(this.app, dir);
        } catch (error) {
          this.plugin.settings.modules = prevList;
          new Notice("\u521B\u5EFA\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
          return;
        }
        this.plugin.settings.hiddenModuleFolders = (this.plugin.settings.hiddenModuleFolders || []).filter((path) => path !== dir);
        this._ownership = null;
        await this.plugin.saveSettings();
        this.go(id);
      }
    }).open();
  }
  addFilesToModule(mod) {
    const dir = this.moduleTargetFolder(mod);
    const own = new Set(this.folderFiles(dir, false).map((file) => file.path));
    const candidates = this.app.vault.getFiles().filter((file) => !own.has(file.path) && this.isInboxFile(file)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    new AddFilesModal(this.app, candidates, (files) => this.assignToModule(files, mod)).open();
  }
  // 收件箱也收录附件：图片 / 视频 / PDF / 音频等，排除白板和隐藏目录。
  // 只收白名单里的扩展名，白板的历史备份（xxx.volis.json、xxx.noval.bak）
  // 这类复合后缀不会再混进来。
  vaultAttachments() {
    return this.app.vault.getFiles().filter((file) => {
      if (file.extension === "md") return false;
      if (["noval", "volis", "canvas"].includes(file.extension.toLowerCase())) return false;
      const lower = file.path.toLowerCase();
      if (lower.includes(".volis.") || lower.includes(".noval.")) return false;
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
    if (["noval", "volis", "canvas"].includes(ext)) return false;
    const lower = file.path.toLowerCase();
    if (lower.includes(".volis.") || lower.includes(".noval.")) return false;
    if (isIgnoredPath(file.path)) return false;
    if (file.path.startsWith(CARD_FOLDER + "/")) return false;
    return true;
  }
  inboxFiles() {
    const policy = this.inboxPolicy();
    if (policy === "root") {
      return this.rootFiles().filter((file) => this.isInboxFile(file)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    }
    if (policy === "all") {
      return this.app.vault.getFiles().filter((file) => this.isInboxFile(file)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    }
    const md = this.vaultFiles();
    const known = /* @__PURE__ */ new Set();
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
    return pending.concat(attachments).sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  // 文件里写了 module，但没有任何模块配置认领这个值（且用户没点过忽略）。
  unknownModuleValues() {
    const known = /* @__PURE__ */ new Set();
    this.getModules().forEach((mod) => this.moduleKeys(mod).forEach((k) => known.add(k)));
    const ignored = new Set(
      (this.plugin.settings.ignoredModuleValues || []).map((v) => String(v).toLowerCase())
    );
    const groups = /* @__PURE__ */ new Map();
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
  /* 删除模块 = Obsidian 删除文件夹：
   * 整个文件夹连同子文件夹、子模块、笔记与附件一起，按仓库「删除文件」的设置处理
   * （回收站或永久删除），同时移除这一层及以下的所有模块配置。 */
  async deleteModule(target) {
    if (!target) return;
    const folder = this.moduleTargetFolder(target);
    const node = folder ? this.app.vault.getAbstractFileByPath(folder) : null;
    if (!folder || !node || !Array.isArray(node.children)) {
      await this.removeModuleSubtreeConfigs(folder, target);
      new Notice("\u5DF2\u79FB\u9664\u6A21\u5757\u300C" + target.name + "\u300D");
      this.render();
      return;
    }
    const counts = this.countModuleTree(node);
    const confirmed = await new Promise((resolve) => {
      new DeleteModuleModal(
        this.app,
        { name: target.name, fileCount: counts.files, folderCount: counts.folders },
        resolve
      ).open();
    });
    if (!confirmed) return;
    try {
      if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") {
        await this.app.fileManager.trashFile(node);
      } else {
        await this.app.vault.trash(node, true);
      }
    } catch (error) {
      new Notice("\u5220\u9664\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
      return;
    }
    await this.removeModuleSubtreeConfigs(folder, target);
    this.render();
    new Notice(
      "\u5DF2\u5220\u9664\u6A21\u5757\u300C" + target.name + "\u300D\uFF1A" + (counts.files ? counts.files + " \u4E2A\u6587\u4EF6" : "\u65E0\u6587\u4EF6") + (counts.folders ? "\u3001" + counts.folders + " \u4E2A\u5B50\u6587\u4EF6\u5939" : "") + "\u5DF2\u6309 Obsidian \u5220\u9664\u8BBE\u7F6E\u5904\u7406"
    );
  }
  /* 递归统计文件夹里的文件和子文件夹数量，弹窗里给用户看清影响范围 */
  countModuleTree(node) {
    let files = 0;
    let folders = 0;
    const walk = (folderNode) => {
      (folderNode.children || []).forEach((child) => {
        if (Array.isArray(child.children)) {
          folders += 1;
          walk(child);
        } else {
          files += 1;
        }
      });
    };
    walk(node);
    return { files, folders };
  }
  /* 移除被删文件夹这一层及以下的所有模块配置与隐藏记录 */
  async removeModuleSubtreeConfigs(folder, target) {
    const dir = String(folder || "").replace(/^\/+|\/+$/g, "").toLowerCase();
    const inTree = (path) => {
      const value = String(path || "").replace(/^\/+|\/+$/g, "").toLowerCase();
      if (!dir) return false;
      return value === dir || value.startsWith(dir + "/");
    };
    const all = this.getModules();
    const removed = all.filter(
      (mod) => dir ? inTree(this.moduleTargetFolder(mod)) : mod.id === target.id
    );
    const removedIds = new Set(removed.map((mod) => mod.id));
    this.plugin.settings.modules = all.filter((mod) => !removedIds.has(mod.id));
    this.plugin.settings.hiddenModuleFolders = (this.plugin.settings.hiddenModuleFolders || []).filter((path) => !inTree(path));
    const activeId = String(this.active || "");
    let activeGone = removedIds.has(activeId);
    if (!activeGone && activeId.startsWith("dir:")) {
      activeGone = inTree(activeId.slice(4));
    }
    if (activeGone) this.active = "home";
    this._ownership = null;
    await this.plugin.saveSettings();
  }
  /* 模块右键菜单：和文件树一样，先新建、再改、最后删，操作全部落到文件夹上。
   *   新建文件 / 新建模块 / 创建副本 —— 对应 Obsidian 文件夹菜单的前三项；
   *   重命名 / 编辑模块 —— 就地改文件夹名与模块外观；
   *   删除模块 —— 按 Obsidian 删除文件夹的规则处理。 */
  showModuleMenu(mod, event) {
    if (!mod) return;
    const menu = new Menu();
    menu.addItem(
      (item) => item.setTitle("\u65B0\u5EFA\u6587\u4EF6").setIcon("file-plus").onClick(() => {
        void this.createFileInModule(mod);
      })
    );
    menu.addItem(
      (item) => item.setTitle("\u65B0\u5EFA\u6A21\u5757\u2026").setIcon("folder-plus").onClick(() => {
        this.promptSubmodule(mod, "\u65B0\u5EFA\u6A21\u5757");
      })
    );
    menu.addItem(
      (item) => item.setTitle("\u521B\u5EFA\u526F\u672C").setIcon("copy").onClick(() => {
        void this.duplicateModule(mod);
      })
    );
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("\u91CD\u547D\u540D\u2026").setIcon("pencil").onClick(() => this.renameModule(mod))
    );
    menu.addItem(
      (item) => item.setTitle("\u7F16\u8F91\u6A21\u5757\u2026").setIcon("settings").onClick(() => this.openModuleEditor(mod))
    );
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("\u5220\u9664\u6A21\u5757\u2026").setIcon("trash").onClick(() => {
        void this.deleteModule(mod);
      })
    );
    menu.showAtMouseEvent(event);
  }
  /* 新建文件 = 文件树里的「新建笔记」：在模块文件夹里建一个空笔记并打开。
   * 重名依次加 " 1"、" 2"，和 Obsidian 新建笔记的重名规则一致，绝不覆盖已有文件。 */
  async createFileInModule(mod) {
    const dir = this.moduleTargetFolder(mod);
    if (!dir) {
      new Notice("\u8FD9\u4E2A\u6A21\u5757\u8FD8\u6CA1\u6709\u5BF9\u5E94\u7684\u6587\u4EF6\u5939");
      return;
    }
    try {
      await ensureVaultFolder(this.app, dir);
    } catch (error) {
      new Notice("\u521B\u5EFA\u6A21\u5757\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
      return;
    }
    const path = this.uniqueNotePath(dir, "\u672A\u547D\u540D");
    let created = null;
    try {
      created = await this.app.vault.create(path, "");
    } catch (error) {
      new Notice("\u521B\u5EFA\u6587\u4EF6\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
      return;
    }
    this._ownership = null;
    this.render();
    if (created) this.openFile(created);
  }
  // 「未命名」「未命名 1」「未命名 2」……文件树里新建笔记就是这个重名规则
  uniqueNotePath(dir, base) {
    const prefix = dir ? dir + "/" : "";
    let path = prefix + base + ".md";
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = prefix + base + " " + n + ".md";
      n += 1;
    }
    return path;
  }
  /* 创建副本 = 文件树里的「创建副本」：整棵文件夹（含子文件夹、笔记、附件）复制一份，
   * 副本落在同一个父目录下，名字加 " 1"、" 2"；文件夹即模块，副本随即出现在导航里。 */
  async duplicateModule(mod) {
    const dir = this.moduleTargetFolder(mod);
    const node = dir ? this.app.vault.getAbstractFileByPath(dir) : null;
    if (!dir || !node || !Array.isArray(node.children)) {
      new Notice("\u6CA1\u627E\u5230\u6A21\u5757\u5BF9\u5E94\u7684\u6587\u4EF6\u5939\uFF0C\u65E0\u6CD5\u521B\u5EFA\u526F\u672C");
      return;
    }
    const parent = dir.indexOf("/") === -1 ? "" : dir.slice(0, dir.lastIndexOf("/"));
    const base = dir.split("/").pop();
    const target = this.uniqueFolderPath(parent, base);
    try {
      await ensureVaultFolder(this.app, target);
      await this.copyFolderTree(node, target);
    } catch (error) {
      new Notice("\u521B\u5EFA\u526F\u672C\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
      return;
    }
    this._ownership = null;
    await this.plugin.saveSettings();
    this.render();
    new Notice("\u5DF2\u521B\u5EFA\u526F\u672C\u300C" + target.split("/").pop() + "\u300D");
    const created = this.moduleForFolder(target);
    if (created) this.go(moduleIdOf(created));
  }
  // 副本重名规则与文件树一致：原名还在就依次加 " 1"、" 2"
  uniqueFolderPath(parentDir, base) {
    const prefix = parentDir ? parentDir + "/" : "";
    let path = prefix + base;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = prefix + base + " " + n;
      n += 1;
    }
    return path;
  }
  // 递归复制整棵文件夹：vault.copy 只收文件，文件夹得自己逐层走
  async copyFolderTree(source, targetDir) {
    const children = Array.isArray(source && source.children) ? source.children.slice() : [];
    for (const child of children) {
      if (!child) continue;
      const dest = targetDir + "/" + child.name;
      if (Array.isArray(child.children)) {
        await ensureVaultFolder(this.app, dest);
        await this.copyFolderTree(child, dest);
        continue;
      }
      if (typeof this.app.vault.copy === "function") {
        await this.app.vault.copy(child, dest);
      } else {
        const data = await this.app.vault.adapter.readBinary(child.path);
        await this.app.vault.adapter.writeBinary(dest, data);
      }
    }
  }
  renameModule(mod) {
    if (!mod) return;
    const oldFolder = this.moduleTargetFolder(mod);
    new RenameModuleModal(this.app, mod.name || oldFolder.split("/").pop(), async (value) => {
      const name = sanitizeFolderName(value);
      if (!name) {
        new Notice('\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B \\ / : * ? " < > | \u7B49\u5B57\u7B26\u3002');
        return;
      }
      const parent = oldFolder.indexOf("/") === -1 ? "" : oldFolder.slice(0, oldFolder.lastIndexOf("/"));
      const newFolder = parent ? parent + "/" + name : name;
      if (!oldFolder) {
        mod.name = name;
        mod.folder = newFolder;
        await this.plugin.saveSettings();
        this.render();
        return;
      }
      if (newFolder === oldFolder && name === mod.name) return;
      if (newFolder.toLowerCase() !== oldFolder.toLowerCase()) {
        if (this.app.vault.getAbstractFileByPath(newFolder)) {
          new Notice("\u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6\u5939\uFF1A" + newFolder);
          return;
        }
      }
      const node = this.app.vault.getAbstractFileByPath(oldFolder);
      if (node) {
        try {
          await this.app.fileManager.renameFile(node, newFolder);
        } catch (error) {
          new Notice("\u91CD\u547D\u540D\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
          return;
        }
      }
      this.plugin.remapModuleFolder(oldFolder, newFolder);
      mod.name = name;
      mod.folder = newFolder;
      const oldId = "dir:" + oldFolder;
      const newId = "dir:" + newFolder;
      const remapId = (id) => {
        if (id === oldId) return newId;
        if (id.indexOf(oldId + "/") === 0) return newId + id.slice(oldId.length);
        return id;
      };
      this.active = remapId(this.active);
      const expanded = /* @__PURE__ */ new Set();
      this._navExpanded.forEach((id) => expanded.add(remapId(id)));
      this._navExpanded = expanded;
      await this.plugin.saveSettings();
      this.render();
      new Notice("\u5DF2\u91CD\u547D\u540D\u4E3A\u300C" + name + "\u300D");
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
        const isNew = !mod;
        const oldFolder = isNew ? "" : this.moduleTargetFolder(mod);
        // 已有模块一律以现在的文件夹为准，不允许在这里改指向；
        // 新建模块的文件夹 = 模块名（库根目录）。
        let folder = isNew ? this.moduleTargetFolder(next) : oldFolder || this.moduleTargetFolder(next);
        if (!folder) {
          new Notice("\u6A21\u5757\u540D\u4E0D\u80FD\u4E3A\u7A7A");
          return false;
        }
        // 已有模块：名字和文件夹本来是同一个（模块即文件夹），改名就把文件夹一起改；
        // 文件夹是单独指定过、和名字不一致的老模块，只改名字，不动文件夹。
        if (!isNew && oldFolder && folder === oldFolder) {
          const oldBase = oldFolder.split("/").pop();
          const parent2 = oldFolder.indexOf("/") === -1 ? "" : oldFolder.slice(0, oldFolder.lastIndexOf("/"));
          const wanted = sanitizeFolderName(next.name);
          if (wanted && oldBase === String(mod.name || "").trim() && wanted !== oldBase) {
            const moved = parent2 ? parent2 + "/" + wanted : wanted;
            if (this.app.vault.getAbstractFileByPath(moved)) {
              new Notice("\u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6\u5939\uFF1A" + moved + "\uFF0C\u6362\u4E2A\u540D\u5B57\u5427");
              return false;
            }
            const node = this.app.vault.getAbstractFileByPath(oldFolder);
            if (node) {
              try {
                await this.app.fileManager.renameFile(node, moved);
              } catch (error) {
                new Notice("\u91CD\u547D\u540D\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
                return false;
              }
            }
            this.plugin.remapModuleFolder(oldFolder, moved);
            const oldId = "dir:" + oldFolder;
            const newId = "dir:" + moved;
            const remapId = (id) => {
              if (id === oldId) return newId;
              if (String(id).indexOf(oldId + "/") === 0) return newId + String(id).slice(oldId.length);
              return id;
            };
            this.active = remapId(this.active);
            const expanded = /* @__PURE__ */ new Set();
            this._navExpanded.forEach((id) => expanded.add(remapId(id)));
            this._navExpanded = expanded;
            folder = moved;
          }
        }
        // 新建模块 = 在库根目录建同名文件夹。文件树里已经有同名文件夹，
        // 就说明这个模块本来就在（文件夹就是模块）：直接打开它，不再建第二个。
        // 只有「同名的是文件」才需要换名字，和文件树里新建文件夹的判断一致。
        if (isNew) {
          const node = this.app.vault.getAbstractFileByPath(folder);
          if (node && !Array.isArray(node.children)) {
            new Notice("\u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6\u300C" + folder + "\u300D\uFF0C\u6362\u4E2A\u540D\u5B57\u5427");
            return false;
          }
          const taken = this.getModules().find(
            (m) => this.moduleTargetFolder(m).toLowerCase() === folder.toLowerCase()
          );
          if (taken) {
            const takenDir = this.moduleTargetFolder(taken);
            // 之前从导航里删掉的，重新打开就等于把它加回来
            this.plugin.settings.hiddenModuleFolders = (this.plugin.settings.hiddenModuleFolders || []).filter((path) => path !== takenDir);
            if (!this.app.vault.getAbstractFileByPath(takenDir)) {
              // 配置还在、文件夹没了：把文件夹补上，模块和文件夹始终成对
              try {
                await ensureVaultFolder(this.app, takenDir);
              } catch (error) {
                new Notice("\u521B\u5EFA\u6A21\u5757\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
                return false;
              }
            }
            await this.plugin.saveSettings();
            new Notice("\u5DF2\u6709\u540C\u540D\u6A21\u5757\u300C" + taken.name + "\u300D\uFF0C\u5DF2\u6253\u5F00");
            this.go(moduleIdOf(taken));
            return true;
          }
        }
        next.folder = folder;
        this.plugin.settings.hiddenModuleFolders = (this.plugin.settings.hiddenModuleFolders || []).filter((path) => path !== folder && (!oldFolder || path !== oldFolder));
        // 先在配置里登记，再去建文件夹：文件夹的 create 事件会触发「根目录文件夹→模块」同步，
        // 配置里已经有这个文件夹，就不会再补一个同名的自动模块。
        const prevList = this.getModules();
        this.setModuleEntry(next);
        this._ownership = null;
        try {
          await ensureVaultFolder(this.app, folder);
        } catch (error) {
          this.plugin.settings.modules = prevList;
          new Notice("\u521B\u5EFA\u6A21\u5757\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
          return false;
        }
        await this.plugin.saveSettings();
        new Notice("\u5DF2\u4FDD\u5B58\u6A21\u5757\u300C" + next.name + "\u300D");
        const pending = this._pendingAssign;
        this._pendingAssign = null;
        if (pending && pending.length) this.assignToModule(pending, next);
        else if (!mod) this.go(next.id);
        else this.render();
      },
      onDelete: mod ? async (target) => {
        await this.deleteModule(target);
      } : null
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
      onDelete: async (mod) => {
        await this.deleteModule(mod);
      }
    }).open();
  }
  openModulePicker(files) {
    if (!files || !files.length) return;
    new ModulePickerModal(this.app, {
      getRootModules: () => this.rootModules(),
      getChildren: (mod) => this.submodulesOf(mod),
      getAllModules: () => this.getModules(),
      getFolder: (mod) => this.moduleTargetFolder(mod),
      onPick: (mod) => this.assignToModule(files, mod),
      onCreate: () => {
        this._pendingAssign = files;
        this.openModuleEditor(null);
      }
    }).open();
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
      new Notice("\u65E0\u6CD5\u521B\u5EFA\u6A21\u5757\u6587\u4EF6\u5939\u300C" + dir + "\u300D\uFF1A" + (e.message || e));
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
          if (!isNote) {
            delete assigned[oldPath];
            assigned[target] = value;
          }
        } else if (!isNote) {
          assigned[oldPath] = value;
        }
        done += 1;
      } catch (e) {
        failed += 1;
        if (!firstError) firstError = e && e.message || String(e);
      }
    }
    await this.plugin.saveSettings();
    this._ownership = null;
    this._inboxSel = /* @__PURE__ */ new Set();
    new Notice(
      "\u5DF2\u5F52\u5165\u300C" + mod.name + "\u300D\uFF1A" + done + " \u9879" + (moved ? "\uFF08\u79FB\u52A8 " + moved + " \u9879\uFF09" : "") + (failed ? "\uFF1B\u5931\u8D25 " + failed + " \u9879\uFF1A" + firstError : "")
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
      const names = [mod.name, mod.id, mod.module].filter(Boolean).map((s) => String(s).toLowerCase());
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
    const groups = /* @__PURE__ */ new Map();
    for (const file of files) {
      if (file.extension !== "md") continue;
      const mod = this.suggestModuleFor(file);
      if (!mod) continue;
      const key = moduleIdOf(mod);
      if (!groups.has(key)) groups.set(key, { mod, files: [] });
      groups.get(key).files.push(file);
    }
    if (!groups.size) {
      new Notice("\u6CA1\u6709\u53EF\u5F52\u5165\u7684\u7B14\u8BB0");
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
        }
      }
      await this.plugin.saveSettings();
      this._ownership = null;
      new Notice("\u5DF2\u5220\u9664 " + done + " \u4E2A\u6587\u4EF6\uFF0C\u53EF\u5728\u56DE\u6536\u7AD9\u6062\u590D");
      if (typeof onDone === "function") onDone(done);
      else this.render();
    }).open();
  }
  showFileMenu(event, file) {
    const menu = new Menu();
    menu.addItem(
      (item) => item.setTitle("\u91CD\u547D\u540D\u2026").setIcon("pencil").onClick(() => this.promptRenameFile(file, "\u91CD\u547D\u540D\u7B14\u8BB0"))
    );
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("\u5220\u9664").setIcon("trash-2").onClick(() => this.deleteFiles([file]))
    );
    anchorMenuBelow(menu, event.currentTarget ?? event.target);
  }
  promptRenameFile(file, heading) {
    new RenameFileModal(this.app, file.basename, (value) => {
      void this.renameNoteFile(file, value);
    }, heading).open();
  }
  async renameNoteFile(file, value) {
    if (!value || value === file.basename) return;
    const folder = file.parent ? file.parent.path : "";
    const nextPath = (folder && folder !== "/" ? folder + "/" : "") + value + "." + (file.extension || "md");
    try {
      await this.app.fileManager.renameFile(file, nextPath);
      this.refresh();
    } catch (e) {
      new Notice("\u91CD\u547D\u540D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u662F\u5426\u91CD\u540D\u6216\u542B\u975E\u6CD5\u5B57\u7B26");
    }
  }
  startFileDrag(event, file, paths) {
    const list = paths && paths.length ? paths : this._mdMulti && this._mdSel.has(file.path) ? Array.from(this._mdSel) : [file.path];
    this._dragPaths = list;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", list.join("\n"));
    }
  }
  endFileDrag() {
    this._dragPaths = null;
    this.clearDropHighlights();
  }
  clearDropHighlights() {
    this.containerEl.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
  }
  bindDropTarget(el, mode, mod) {
    el.addEventListener("dragover", (evt) => {
      if (!this._dragPaths || !this._dragPaths.length) return;
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      el.addClass("is-drop-target");
    });
    el.addEventListener("dragleave", (evt) => {
      const next = evt.relatedTarget;
      if (!next || !el.contains(next)) el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (evt) => {
      if (!this._dragPaths || !this._dragPaths.length) return;
      evt.preventDefault();
      evt.stopPropagation();
      el.removeClass("is-drop-target");
      const paths = this._dragPaths.slice();
      this._dragPaths = null;
      const files = paths.map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f) => f && f.extension !== void 0);
      if (!files.length) return;
      if (mode === "root") void this.moveFilesToRoot(files);
      else void this.assignToModule(files, mod);
    });
  }
  async moveFilesToRoot(files) {
    if (!files || !files.length) return;
    const assigned = this.ownershipMap();
    let done = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const oldPath = file.path;
        const isNote = String(file.extension || "").toLowerCase() === "md";
        if (isNote) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            delete fm.module;
          });
          await this.waitForMetadata(file);
        }
        const target = this.uniqueFilePath("", file);
        if (target && target !== oldPath) {
          await this.app.fileManager.renameFile(file, target);
          delete assigned[oldPath];
          delete assigned[target];
        } else {
          delete assigned[oldPath];
        }
        done += 1;
      } catch (e) {
        failed += 1;
      }
    }
    this._ownership = null;
    if (this._mdSel) this._mdSel.clear();
    await this.plugin.saveSettings();
    new Notice("\u5DF2\u79FB\u56DE\u5E93\u6839\u76EE\u5F55\uFF1A" + done + " \u9879" + (failed ? "\uFF0C\u5931\u8D25 " + failed + " \u9879" : ""));
    this.render();
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
  openNoval() {
    const ok = this.runCommand(NOTES_ID + ":open-cards");
    if (ok) return;
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      leaf.setViewState({ type: "qm-cards-view", active: true });
      this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("\u6CA1\u6709\u627E\u5230 Noval \u89C6\u56FE");
    }
  }
  quickCapture() {
    if (!this.runCommand(NOTES_ID + ":quick-capture")) {
      new Notice("\u672A\u627E\u5230 Noval \u7684\u5FEB\u901F\u8BB0\u5F55\u547D\u4EE4");
    }
  }
  // 画布集现在就是「白板」页本身，所有入口都切到这一页，不再开新标签。
  openNovalGallery() {
    this.go("canvas");
  }
  openSettings() {
    try {
      this.app.setting.open();
      this.app.setting.openTabById(this.plugin.manifest.id);
    } catch (e) {
      new Notice("\u8BF7\u624B\u52A8\u6253\u5F00\u8BBE\u7F6E \u2192 Noval");
    }
  }
  setFocus(on) {
    this.focus = on;
    document.body.classList.toggle("noval-focus", on);
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
    const shown = typeof this.containerEl.isShown === "function" ? this.containerEl.isShown() : this.containerEl.offsetParent !== null;
    if (!shown) {
      this._needsRefresh = true;
      return;
    }
    this._needsRefresh = false;
    this._ownership = null;
    if (this.active === "canvas" && this.gallery) {
      this.gallery.refresh();
      this.syncBoardNavCount();
      return;
    }
    if (this.active === "notes" && this.notes) {
      this.notes.refresh();
      return;
    }
    this.render();
  }
  /* 只重建左侧导航：文件树里增删、重命名文件夹后模块列表变了，
   * 但不该整页重绘（画布、卡片面板重绘会丢当前状态），所以只换掉 .cl-nav 这棵。 */
  refreshNav() {
    if (!this.appEl) return;
    const main = this.appEl.querySelector(":scope > .cl-main");
    const old = this.appEl.querySelector(":scope > .cl-nav");
    if (!main || !old) return;
    const tmp = document.createElement("div");
    this.renderNav(tmp);
    const nav = tmp.firstElementChild;
    if (!nav) return;
    this.appEl.insertBefore(nav, main);
    old.remove();
    this.applyLayout();
  }
  /** 卡片文件写入后只刷新卡片数据，通知里有文件路径时不再整页 load */
  applyFileCards(path, content) {
    if (this.active === "notes" && this.notes) {
      this.notes.applyFileCards(path, content);
      return;
    }
    this._needsRefresh = true;
  }
  /** 只有界面文字变化（没有写入）时调用，不重读文件 */
  rerender() {
    if (this.active === "notes" && this.notes) {
      this.notes.rerender();
      return;
    }
    this.refresh();
  }
  go(id) {
    if (this.active === "canvas" && id !== "canvas") this.destroyGallery();
    if (this.active === "notes" && id !== "notes") this.destroyNotes();
    const mod = this.moduleById(id);
    const builtin = ["home", "inbox", "canvas", "notes"].includes(id);
    if (!mod && !builtin) {
      this.active = "home";
    } else {
      this.active = id;
      if (mod) {
        this.modulePath(mod).slice(0, -1).forEach((node) => this._navExpanded.add(moduleIdOf(node)));
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
    return this.app.vault.getFiles().filter((f) => f.extension === BOARD_EXT).sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  // 导航栏「画布」徽标。切页时整页重绘，数字自然会跟上；
  // 但在画布集里增删画布走的是局部刷新，导航不会重绘，
  // 所以这里单独把徽标补一次，否则要切走再切回来才同步。
  // 口径跟画布集保持一致：只数画布文件夹里的 .noval，散在别处的旧文件不算。
  boardCount() {
    const board = this.plugin.childPlugins && this.plugin.childPlugins[BOARD_ID];
    const folder = String(board && board.novalFolder || "").replace(/^\/+|\/+$/g, "");
    const prefix = folder ? folder + "/" : "";
    return this.app.vault.getFiles().filter((f) => {
      if (f.extension !== BOARD_EXT) return false;
      return !prefix || f.path.startsWith(prefix);
    }).length;
  }
  syncBoardNavCount() {
    if (!this.appEl) return;
    const item = this.appEl.querySelector('.cl-navitem[data-nav="canvas"]');
    if (!item) return;
    const total = this.boardCount();
    let badge = item.querySelector(".cl-navcount");
    if (!total) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) badge = item.createDiv({ cls: "cl-navcount" });
    const next = String(total);
    if (badge.textContent !== next) badge.setText(next);
  }
  // 卡片笔记徽标：卡片页同样只做局部刷新，数字由面板读完全部卡片后推过来。
  syncCardNavCount(total) {
    if (!this.appEl) return;
    const item = this.appEl.querySelector('.cl-navitem[data-nav="notes"]');
    if (!item) return;
    const n = typeof total === "number" ? total : this._cardCount || 0;
    this._cardCount = n;
    let badge = item.querySelector(".cl-navcount");
    if (!n) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) badge = item.createDiv({ cls: "cl-navcount" });
    const next = String(n);
    if (badge.textContent !== next) badge.setText(next);
  }
  // 卡片页以外（此刻停在画布）没有面板缓存，只能重读一次卡片文件。
  async recountCardNav() {
    const noval = this.plugin.childPlugins && this.plugin.childPlugins[NOTES_ID] || this.app.plugins.plugins && this.app.plugins.plugins[LEGACY.notesId];
    if (!noval || typeof noval.readAllCards !== "function") return;
    try {
      const cards = await noval.readAllCards();
      this.syncCardNavCount(Array.isArray(cards) ? cards.length : 0);
    } catch (e) {
    }
  }
  getCardFiles() {
    return this.app.vault.getFiles().filter((f) => f.extension === "md" && f.path.startsWith(CARD_FOLDER + "/")).sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  // 卡片总数只有读文件才知道，导航先渲染，数字到了再补进徽标。
  fillCardCount(item) {
    const noval = this.plugin.childPlugins && this.plugin.childPlugins[NOTES_ID] || this.app.plugins.plugins && this.app.plugins.plugins[LEGACY.notesId];
    if (!noval || typeof noval.readAllCards !== "function") return;
    noval.readAllCards().then((cards) => {
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
    }).catch(() => {
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
      while (j < lines.length && !/^-\s+\d{2}:\d{2}\s+/.test(lines[j]) && !/^##\s+/.test(lines[j])) {
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
      body = body.replace(/#([^\s#]+)/g, (all, tag) => {
        tags.push(tag);
        return "";
      }).replace(/\n{3,}/g, "\n\n").trim();
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
    cards.sort((a, b) => a.sortKey < b.sortKey ? 1 : -1);
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
      const preview = first ? String(first.text).replace(/\s+/g, " ").slice(0, 26) : "\u7A7A\u767D\u767D\u677F";
      return {
        nodes: nodes.length,
        edges: edges.length,
        summary: nodes.length + " \u4E2A\u8282\u70B9 \xB7 " + preview
      };
    } catch (e) {
      return { nodes: 0, edges: 0, summary: "\u65E0\u6CD5\u8BFB\u53D6\u767D\u677F" };
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
    const restore = main.createDiv({ cls: "cl-navrestore" });
    restore.setAttribute("aria-label", "\u5C55\u5F00 Noval \u4FA7\u680F");
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
    const brandName = this.plugin.settings.workspaceName || "\u4E2A\u4EBA\u5DE5\u4F5C\u53F0";
    const brandText = brand.createDiv({ cls: "cl-brand-txt" });
    brandText.createDiv({ cls: "cl-brand-name", text: brandName });
    brandText.createDiv({
      cls: "cl-brand-sub",
      text: brandName === "\u4E2A\u4EBA\u5DE5\u4F5C\u53F0" ? "Noval Workspace" : "\u4E2A\u4EBA\u5DE5\u4F5C\u53F0"
    });
    const collapseBtn = brand.createDiv({ cls: "cl-navtoggle" });
    collapseBtn.setAttribute("aria-label", "\u6536\u8D77 Noval \u4FA7\u680F");
    setIcon(collapseBtn, "chevrons-left");
    collapseBtn.onclick = () => this.setNavCollapsed(true);
    const navSearch = nav.createDiv({
      cls: "cl-navsearch",
      attr: { role: "button", tabindex: "0", "aria-label": "搜索工作台" }
    });
    setIcon(navSearch.createSpan({ cls: "cl-navsearch-ico" }), "search");
    navSearch.createSpan({ cls: "cl-navsearch-ph", text: "搜索工作台…" });
    navSearch.createEl("kbd", { cls: "cl-navsearch-kbd", text: "⌘K" });
    navSearch.onclick = () => openGlobalSearch(this);
    navSearch.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGlobalSearch(this);
      }
    };
    const navList = nav.createDiv({ cls: "cl-navlist" });
    const group = (caption) => {
      const g = navList.createDiv({ cls: "cl-navgroup" });
      g.createDiv({ cls: "cl-navcap", text: caption });
      return g;
    };
    const addItem = (parent, { label, icon, tile, color, active, count, navKey, onClick, onContextMenu, depth = 0, chevron = false, hasChildren = false, expanded = false, onToggle }) => {
      const item = parent.createDiv({
        cls: "cl-navitem" + (active ? " is-active" : "") + (depth > 0 ? " is-sub" : "")
      });
      item.setAttribute("aria-label", label);
      if (navKey) item.setAttribute("data-nav", navKey);
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
      label: "\u9996\u9875",
      icon: "home",
      active: this.active === "home",
      onClick: () => this.go("home")
    });
    const inboxItem = addItem(overview, {
      label: "\u6536\u96C6\u7BB1",
      icon: "inbox",
      active: this.active === "inbox",
      count: this.inboxFiles().length,
      onClick: () => this.go("inbox")
    });
    this.bindDropTarget(inboxItem, "root");
    const modules = navList.createDiv({ cls: "cl-navgroup" });
    const capRow = modules.createDiv({ cls: "cl-navcap-row" });
    capRow.createDiv({ cls: "cl-navcap", text: "MODULES" });
    const capActs = capRow.createDiv({ cls: "cl-navcap-acts" });
    const addModule = capActs.createDiv({ cls: "cl-navcap-btn" });
    addModule.setAttribute("aria-label", "\u65B0\u5EFA\u6A21\u5757");
    setIcon(addModule, "plus");
    addModule.onclick = () => this.openModuleEditor(null);
    const manageModule = capActs.createDiv({ cls: "cl-navcap-btn" });
    manageModule.setAttribute("aria-label", "\u7BA1\u7406\u6A21\u5757");
    setIcon(manageModule, "more-horizontal");
    manageModule.onclick = () => this.openModuleManager();
    const allModules = this.getModules();
    const roots = this.rootModules();
    const drawModule = (mod, depth) => {
      const key = moduleIdOf(mod);
      const children = this.submodulesOf(mod);
      const expanded = this._navExpanded.has(key);
      const index = allModules.indexOf(mod);
      const navItem = addItem(modules, {
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
      this.bindDropTarget(navItem, "module", mod);
      if (expanded) children.forEach((child) => drawModule(child, depth + 1));
    };
    roots.forEach((mod) => drawModule(mod, 0));
    const workspace = group("WORKSPACE");
    addItem(workspace, {
      label: "\u753B\u5E03",
      icon: "presentation",
      active: this.active === "canvas",
      count: this.boardCount(),
      navKey: "canvas",
      onClick: () => this.go("canvas")
    });
    const cardsItem = addItem(workspace, {
      label: "\u5361\u7247\u7B14\u8BB0",
      icon: "sticky-note",
      active: this.active === "notes",
      count: this._cardCount || 0,
      navKey: "notes",
      onClick: () => this.go("notes")
    });
    this.fillCardCount(cardsItem);
    const foot = nav.createDiv({ cls: "cl-navfoot" });
    const focusBtn = foot.createDiv({ cls: "cl-navitem" });
    focusBtn.setAttribute("aria-label", this.focus ? "\u9000\u51FA\u4E13\u6CE8" : "\u4E13\u6CE8\u6A21\u5F0F");
    const focusIcon = focusBtn.createDiv({ cls: "cl-navicon" });
    setIcon(focusIcon, this.focus ? "minimize" : "maximize");
    focusBtn.createDiv({ cls: "cl-navlabel", text: this.focus ? "\u9000\u51FA\u4E13\u6CE8" : "\u4E13\u6CE8\u6A21\u5F0F" });
    focusBtn.onclick = () => this.setFocus(!this.focus);
    const settingsBtn = foot.createDiv({ cls: "cl-navitem" });
    settingsBtn.setAttribute("aria-label", "\u8BBE\u7F6E");
    const settingsIcon = settingsBtn.createDiv({ cls: "cl-navicon" });
    setIcon(settingsIcon, "settings");
    settingsBtn.createDiv({ cls: "cl-navlabel", text: "\u8BBE\u7F6E" });
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
    const workspaceName = this.plugin.settings.workspaceName || "\u4E2A\u4EBA\u5DE5\u4F5C\u53F0";
    const now = /* @__PURE__ */ new Date();
    const hour = now.getHours();
    const greet = hour < 5 ? "\u51CC\u6668\u597D" : hour < 9 ? "\u65E9\u4E0A\u597D" : hour < 12 ? "\u4E0A\u5348\u597D" : hour < 14 ? "\u4E2D\u5348\u597D" : hour < 18 ? "\u4E0B\u5348\u597D" : "\u665A\u4E0A\u597D";
    const WEEKNAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const MONTHNAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    let captureInput = null;
    const top = page.createDiv({ cls: "cl-hm-top cl-hm-topbot" });
    const topBranch = top.createDiv({ cls: "cl-hm-branch" });
    topBranch.innerHTML = '<svg viewBox="0 0 60 36" aria-hidden="true"><path d="M3 33C17 29 31 21 46 6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><g fill="currentColor"><ellipse cx="17" cy="27" rx="7" ry="2.8" transform="rotate(-38 17 27)" opacity=".55"/><ellipse cx="25" cy="22" rx="7" ry="2.8" transform="rotate(-42 25 22)" opacity=".42"/><ellipse cx="28" cy="29" rx="6" ry="2.5" transform="rotate(-14 28 29)" opacity=".36"/><ellipse cx="33" cy="16" rx="6.5" ry="2.6" transform="rotate(-48 33 16)" opacity=".5"/><ellipse cx="40" cy="11" rx="5.5" ry="2.4" transform="rotate(-52 40 11)" opacity=".34"/></g></svg>';
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const weekNoTop = Math.ceil(((now - yearStart) / 864e5 + yearStart.getDay() + 1) / 7);
    top.createDiv({ cls: "cl-hm-topmid", text: MONTHNAMES[now.getMonth()] + " \u00B7 \u7B2C " + weekNoTop + " \u5468" });
    const topClock = top.createDiv({ cls: "cl-hm-topclk" });
    topClock.createEl("b", { text: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") });
    topClock.createSpan({ text: "\u5468" + "\u65E5\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D"[now.getDay()] });
    const topGear = top.createDiv({ cls: "cl-hm-topgear" });
    topGear.setAttribute("aria-label", "\u8BBE\u7F6E");
    setIcon(topGear, "more-horizontal");
    topGear.onclick = () => this.openSettings();
    const grid = page.createDiv({ cls: "cl-hm-bento" });
    const hero = grid.createDiv({ cls: "cl-hm-card cl-hm-hero cl-hm-s5" });
    hero.createDiv({ cls: "cl-hm-bigdate", text: String(now.getDate()) });
    const heroTop = hero.createDiv({ cls: "cl-hm-herotop" });
    heroTop.createDiv({ cls: "cl-hm-live" });
    heroTop.createSpan({ text: WEEKNAMES[now.getDay()] + " \xB7 " + MONTHNAMES[now.getMonth()] + " " + now.getDate() });
    const heroMid = hero.createDiv({ cls: "cl-hm-heromid" });
    const hello = heroMid.createEl("h1", { cls: "cl-hm-hello" });
    hello.createSpan({ text: greet + "\uFF0C" });
    hello.createSpan({ cls: "cl-hm-gradtext", text: workspaceName });
    const meta = heroMid.createDiv({ cls: "cl-hm-herometa" });
    const metaPart = (value, label) => {
      meta.createSpan({ text: "" }).createEl("b", { text: String(value) });
      meta.createSpan({ text: " " + label });
    };
    metaPart(modules.length, "\u4E2A\u6A21\u5757");
    meta.createDiv({ cls: "cl-hm-sep" });
    metaPart(boards.length, "\u5757\u767D\u677F");
    meta.createDiv({ cls: "cl-hm-sep" });
    metaPart(inbox.length, "\u6761\u5F85\u6574\u7406");
    const capture = hero.createDiv({ cls: "cl-hm-capture" });
    setIcon(capture.createDiv({ cls: "cl-hm-captico" }), "plus");
    captureInput = capture.createEl("input", {
      cls: "cl-hm-captinput",
      attr: { type: "text", placeholder: "\u8BB0\u4E00\u6761\u901F\u8BB0\uFF0C\u56DE\u8F66\u4FDD\u5B58\u2026" }
    });
    const sendBtn = capture.createDiv({ cls: "cl-hm-go" });
    setIcon(sendBtn, "arrow-right");
    const submitCapture = async () => {
      const text = String(captureInput.value || "").trim();
      if (!text) {
        captureInput.focus();
        return;
      }
      const noval = this.plugin.childPlugins && this.plugin.childPlugins[NOTES_ID];
      if (noval && typeof noval.appendCard === "function") {
        const ok = await noval.appendCard(text);
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
    const weekCard = grid.createDiv({ cls: "cl-hm-card cl-hm-week cl-hm-s4" });
    const dayMs = 864e5;
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    const monday = todayTime - (today.getDay() + 6) % 7 * dayMs;
    const onejan = new Date(today.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((today - onejan) / dayMs) + onejan.getDay() + 1) / 7);
    const weekCn = "\u65E5\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D"[today.getDay()];
    const weekHead = weekCard.createDiv({ cls: "cl-hm-head" });
    weekHead.createDiv({ cls: "cl-hm-title", text: "\u672C\u5468\u8282\u594F" });
    weekHead.createDiv({ cls: "cl-hm-sub", text: "\u7B2C " + weekNo + " \u5468 \u00B7 " + (today.getMonth() + 1) + "/" + today.getDate() + " \u5468" + weekCn });
    const buckets = /* @__PURE__ */ new Map();
    let recentCount = 0;
    const recentFrom = todayTime - 6 * dayMs;
    for (const file of [...this._contentFiles, ...boards]) {
      const d = new Date(file.stat.mtime);
      d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      buckets.set(key, (buckets.get(key) || 0) + 1);
      if (key >= recentFrom) recentCount += 1;
    }
    const weekCounts = [];
    for (let i = 0; i < 7; i++) weekCounts.push(buckets.get(monday + i * dayMs) || 0);
    const todayIdx = (today.getDay() + 6) % 7;
    const todayCount = weekCounts[todayIdx] || 0;
    let streak = 0;
    for (let i = todayIdx; i >= 0; i--) { if (weekCounts[i] > 0) streak++; else break; }
    let thisWeekActive = 0;
    for (let i = 0; i <= todayIdx; i++) if (weekCounts[i] > 0) thisWeekActive++;
    let lastWeekActive = 0;
    for (let i = 0; i <= todayIdx; i++) if ((buckets.get(monday - 7 * dayMs + i * dayMs) || 0) > 0) lastWeekActive++;
    const dayDelta = thisWeekActive - lastWeekActive;
    const wkTop = weekCard.createDiv({ cls: "cl-hm-wktop" });
    const wkNum = wkTop.createDiv({ cls: "cl-hm-wknum" });
    wkNum.createEl("strong", { text: String(recentCount) });
    wkNum.createSpan({ text: "\u6B21\u7F16\u8F91" });
    const wkStats = wkTop.createDiv({ cls: "cl-hm-wkstats" });
    wkStats.createDiv({ cls: "cl-hm-streak", text: "\uD83D\uDD25 \u8FDE\u7EED " + streak + " \u5929" });
    const cmpCls = dayDelta > 0 ? "cl-hm-cmp up" : dayDelta < 0 ? "cl-hm-cmp down" : "cl-hm-cmp";
    const cmpText = dayDelta > 0 ? "\u25B2 \u8F83\u4E0A\u5468 +" + dayDelta + " \u5929" : dayDelta < 0 ? "\u25BC \u8F83\u4E0A\u5468 " + dayDelta + " \u5929" : "\u2014 \u8F83\u4E0A\u5468 \u6301\u5E73";
    wkStats.createDiv({ cls: cmpCls, text: cmpText });
    const wkChart = weekCard.createDiv({ cls: "cl-hm-wkchart" });
    const maxC = Math.max(1, ...weekCounts);
    const W = 300, H = 74, baseY = 66, maxH = 56, barW = 22;
    let svgInner = '<defs><linearGradient id="wkBarGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fbf6f"/><stop offset="1" stop-color="#6f9a5e"/></linearGradient></defs>';
    svgInner += '<line x1="0" y1="' + baseY + '" x2="' + W + '" y2="' + baseY + '" stroke="var(--hm-line)" stroke-width="1"/>';
    for (let i = 0; i < 7; i++) {
      const x = 13 + i * 42;
      const isToday = i === todayIdx;
      const isFuture = i > todayIdx;
      const c = weekCounts[i];
      if (isFuture) {
        svgInner += '<rect x="' + x + '" y="60" width="' + barW + '" height="6" rx="4" fill="none" stroke="var(--hm-line-strong)" stroke-dasharray="2 2"/>';
      } else {
        const h = Math.max(4, Math.round(maxH * c / maxC));
        const y = baseY - h;
        const fill = isToday ? "url(#wkBarGrad)" : c > 0 ? "rgba(169,201,138,0.55)" : "var(--hm-track)";
        svgInner += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" rx="4" fill="' + fill + '"/>';
        if (isToday) {
          const cx = x + barW / 2;
          svgInner += '<line x1="' + cx + '" y1="4" x2="' + cx + '" y2="8" stroke="#6f9a5e" stroke-width="1.5"/>';
          svgInner += '<circle cx="' + cx + '" cy="4" r="2.5" fill="#6f9a5e"/>';
        }
      }
    }
    wkChart.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + svgInner + '</svg>';
    const wkLabels = wkChart.createDiv({ cls: "cl-hm-wklabels" });
    const dayLabels = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"];
    for (let i = 0; i < 7; i++) {
      const sp = wkLabels.createSpan({ text: dayLabels[i] + (i === todayIdx ? " \u00B7 \u4ECA\u5929" : "") });
      if (i === todayIdx) sp.addClass("is-today");
    }
    const wkFoot = weekCard.createDiv({ cls: "cl-hm-wkfoot" });
    const todayEl = wkFoot.createDiv({ cls: "cl-hm-wktoday" + (todayCount > 0 ? "" : " idle") });
    todayEl.createSpan({ cls: "dot" });
    todayEl.createSpan({ text: todayCount > 0 ? "\u4ECA\u65E5\u5DF2\u7F16\u8F91 " + todayCount + " \u4E2A\u6587\u4EF6" : "\u4ECA\u65E5\u8FD8\u6CA1\u52A8\u7B14" });
    const prog = wkFoot.createDiv({ cls: "cl-hm-wkprog" });
    prog.createSpan({ text: "\u672C\u5468\u6D3B\u8DC3" });
    const progBar = prog.createSpan({ cls: "bar" });
    progBar.createEl("i").style.width = Math.round(thisWeekActive / 7 * 100) + "%";
    prog.createEl("b", { text: thisWeekActive + "/7 \u5929" });
    if (todayCount === 0) {
      const nudge = weekCard.createDiv({ cls: "cl-hm-wknudge", text: "\u4ECA\u5929\u8FD8\u6CA1\u52A8\u7B14\uFF0C\u53BB\u901F\u8BB0\u4E00\u6761 \u2192" });
      nudge.onclick = () => { if (captureInput) captureInput.focus(); };
    }
    const inboxCard = grid.createDiv({ cls: "cl-hm-card cl-hm-inbox cl-hm-s3" });
    const inboxHead = inboxCard.createDiv({ cls: "cl-hm-head" });
    inboxHead.createDiv({ cls: "cl-hm-title", text: "\u6536\u4EF6\u7BB1" });
    inboxHead.createDiv({ cls: "cl-hm-sub", text: "\u672A\u5F52\u5C5E" });
    const inboxMore = inboxHead.createDiv({ cls: "cl-hm-more", text: "\u5168\u90E8 \u203A" });
    inboxMore.onclick = () => this.go("inbox");
    const mdTotal = this.vaultFiles().length;
    const inboxMd = inbox.filter((f) => f.extension === "md").length;
    const handled = Math.max(0, mdTotal - inboxMd);
    const pct = mdTotal ? Math.max(6, Math.round(handled / mdTotal * 100)) : 100;
    const ringWrap = inboxCard.createDiv({ cls: "cl-hm-ringwrap" });
    const ring = ringWrap.createDiv({ cls: "cl-hm-ring" });
    ring.style.setProperty("--p", pct + "%");
    ring.createEl("b", { text: String(inbox.length) });
    const ringSide = ringWrap.createDiv({ cls: "cl-hm-ringside" });
    const ringK = ringSide.createDiv({ cls: "cl-hm-ringk" });
    ringK.createDiv({ text: "\u6761\u7B14\u8BB0" });
    ringK.createEl("strong", { text: "\u7B49\u4F60\u51B3\u5B9A\u53BB\u5411" });
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
      inboxCard.createDiv({ cls: "cl-hm-inboxempty", text: "\u6536\u4EF6\u7BB1\u5DF2\u6E05\u7A7A\uFF0C\u4ECA\u5929\u5F88\u5E72\u51C0\u3002" });
    }
    const inboxLink = inboxCard.createDiv({ cls: "cl-hm-inboxlink" });
    if (inbox.length) {
      inboxLink.createSpan({ text: "\u6309\u5EFA\u8BAE\u5F52\u5165 " });
      inboxLink.createEl("b", { text: inbox.length + " \u6761" });
      inboxLink.createSpan({ text: " \u2192" });
      inboxLink.onclick = () => {
        const list = inbox.slice();
        const suggestions = list.filter((f) => this.suggestModuleFor(f));
        if (suggestions.length) this.applyAllSuggestions(suggestions);
        else this.go("inbox");
      };
    } else {
      inboxLink.createSpan({ text: "\u6253\u5F00\u6536\u96C6\u7BB1 \u2192" });
      inboxLink.onclick = () => this.go("inbox");
    }
    const resumeCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s6" });
    const resumeHead = resumeCard.createDiv({ cls: "cl-hm-head" });
    resumeHead.createDiv({ cls: "cl-hm-title", text: "\u7EE7\u7EED" });
    resumeHead.createDiv({ cls: "cl-hm-sub", text: "\u6700\u8FD1\u7F16\u8F91" });
    const resumeGrid = resumeCard.createDiv({ cls: "cl-hm-resumes" });
    const recentFiles = [...this._contentFiles, ...boards].filter((file) => !/^未命名笔记/.test(file.basename)).filter((file) => !file.path.startsWith(CARD_FOLDER + "/")).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 4);
    if (!recentFiles.length) {
      resumeGrid.createDiv({ cls: "cl-hm-empty", text: "\u8FD8\u6CA1\u6709\u53EF\u7EE7\u7EED\u7684\u5185\u5BB9\u3002" });
    }
    for (const file of recentFiles) {
      const isBoard = file.extension === "noval";
      const mod = isBoard ? null : this.moduleForFile(file);
      const color = isBoard ? "#9b8cff" : mod && mod.color || "#3f7fd1";
      const fm = isBoard ? {} : getFm(this.app, file);
      const typeText = isBoard ? "BOARD" : fm && fm.status ? String(fm.status).toUpperCase() : "NOTE";
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
      modSpan.createSpan({ text: isBoard ? "\u767D\u677F" : mod && mod.name || "\u672A\u5F52\u5C5E" });
      fileMeta.createDiv({ cls: "cl-hm-filedtime", text: formatTime(file.stat.mtime) });
      cell.onclick = () => this.openFile(file);
    }
    const modCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s6" });
    const modHead = modCard.createDiv({ cls: "cl-hm-head" });
    modHead.createDiv({ cls: "cl-hm-title", text: "\u6A21\u5757\u8109\u640F" });
    modHead.createDiv({ cls: "cl-hm-sub", text: "\u6309\u6D3B\u8DC3\u5EA6" });
    const modMore = modHead.createDiv({ cls: "cl-hm-more", text: "\u7BA1\u7406 \u203A" });
    modMore.onclick = () => this.openSettings();
    const modGrid = modCard.createDiv({ cls: "cl-hm-mods" });
    const ranked = modules.map((mod) => {
      const files = this.moduleNoteFiles(mod);
      const active = files.filter(
        (f) => ACTIVE_STATUSES.includes(String(getFm(this.app, f).status || "").toLowerCase())
      ).length;
      return { mod, total: files.length, active };
    }).sort((a, b) => b.active - a.active || b.total - a.total).slice(0, 5);
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
      row.createSpan({ cls: "cl-hm-modunit", text: "\u7BC7" });
      row.createSpan({ cls: "cl-hm-modlive", text: entry.active + " \u8FDB\u884C\u4E2D" });
      const bar = tile.createDiv({ cls: "cl-hm-modbar" });
      const fill = bar.createEl("i");
      fill.style.width = (entry.total ? Math.round(entry.active / entry.total * 100) : 0) + "%";
      tile.onclick = () => this.go(entry.mod.id);
    });
    const addTile = modGrid.createDiv({ cls: "cl-hm-mod cl-hm-modadd" });
    setIcon(addTile.createDiv(), "plus");
    addTile.createSpan({ text: "\u65B0\u5EFA\u6A21\u5757" });
    addTile.onclick = () => this.openModuleEditor(null);
    const boardCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s7" });
    const boardHead = boardCard.createDiv({ cls: "cl-hm-head" });
    boardHead.createDiv({ cls: "cl-hm-title", text: "\u6700\u8FD1\u753B\u5E03" });
    boardHead.createDiv({ cls: "cl-hm-sub", text: boards.length + " \u5757" });
    const boardMore = boardHead.createDiv({ cls: "cl-hm-more", text: "\u753B\u5E03\u96C6 \u203A" });
    boardMore.onclick = () => this.openNovalGallery();
    const boardGrid = boardCard.createDiv({ cls: "cl-hm-boards" });
    const boardEls = [];
    boards.slice(0, 3).forEach((file, index) => {
      const board = boardGrid.createDiv({ cls: "cl-hm-board" });
      const art = board.createDiv({ cls: "cl-hm-art" });
      this.renderBoardArt(art, index % 3);
      board.createDiv({ cls: "cl-hm-shade" });
      const badge = board.createDiv({ cls: "cl-hm-badge", text: "\u8BFB\u53D6\u4E2D\u2026" });
      const info = board.createDiv({ cls: "cl-hm-boardinfo" });
      info.createDiv({ cls: "cl-hm-boardname", text: file.basename });
      const metaEl = info.createDiv({ cls: "cl-hm-boardmeta", text: "\u8BFB\u53D6\u4E2D\u2026" });
      board.onclick = () => this.openFile(file);
      boardEls.push({ file, badge, metaEl });
    });
    if (!boards.length) {
      boardGrid.createDiv({ cls: "cl-hm-empty", text: "\u8FD8\u6CA1\u6709\u767D\u677F\uFF0C\u53BB\u753B\u5E03\u96C6\u65B0\u5EFA\u4E00\u5F20\u3002" });
    }
    const noteCard = grid.createDiv({ cls: "cl-hm-card cl-hm-s5" });
    const noteHead = noteCard.createDiv({ cls: "cl-hm-head" });
    noteHead.createDiv({ cls: "cl-hm-title", text: "\u901F\u8BB0" });
    noteHead.createDiv({ cls: "cl-hm-sub", text: (this._cardCount || 0) + " \u6761\u5361\u7247" });
    const noteMore = noteHead.createDiv({ cls: "cl-hm-more", text: "\u6253\u5F00 \u203A" });
    noteMore.onclick = () => this.go("notes");
    const noteWrap = noteCard.createDiv({ cls: "cl-hm-notes" });
    page.createDiv({ cls: "cl-hm-foot", text: "\u6570\u636E\u5B9E\u65F6\u8BFB\u53D6 \xB7 Noval v" + this.plugin.manifest.version });
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
      item.badge.setText(data.nodes + " \u8282\u70B9");
      item.metaEl.setText(
        (data.edges ? data.edges + " \u6761\u8FDE\u7EBF \xB7 " : "") + formatTime(item.file.stat.mtime)
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
        text: "\u8FD8\u6CA1\u6709\u901F\u8BB0\u5361\u7247\u3002\u5728\u4E0A\u9762\u8BB0\u4E00\u6761\uFF0C\u5B83\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002"
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
    let files = this._contentFiles.filter((f) => f.path.startsWith("00-Inbox/")).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 15);
    if (!files.length) {
      files = [...this._contentFiles].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 15);
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
      container.createDiv({ cls: "cl-empty", text: "\u6CA1\u6709\u672A\u5B8C\u6210\u4EFB\u52A1\uFF0C\u6536\u4EF6\u7BB1\u662F\u7A7A\u7684\u3002" });
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
        text: "\u8FD8\u6CA1\u6709\u901F\u8BB0\u5361\u7247\u3002\u7528 Noval \u8BB0\u4E00\u6761\uFF0C\u5B83\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002"
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
        text: "\u8FD8\u6CA1\u6709 .noval \u767D\u677F\u3002\u53BB\u753B\u5E03\u96C6\u65B0\u5EFA\u4E00\u5F20\u3002"
      });
      return;
    }
    for (const file of boards) {
      const row = container.createDiv({ cls: "cl-board-row" });
      const icon = row.createDiv({ cls: "cl-board-icon" });
      setIcon(icon, "presentation");
      const info = row.createDiv({ cls: "cl-board-info" });
      info.createDiv({ cls: "cl-board-name", text: file.basename });
      const sub = info.createDiv({ cls: "cl-board-sub", text: "\u8BFB\u53D6\u4E2D\u2026" });
      row.onclick = () => this.openFile(file);
      this.readBoard(file).then((data) => {
        if (sub.isConnected) sub.setText(data.summary);
      });
    }
  }
  renderInbox(el) {
    const files = this.inboxFiles();
    if (!this._inboxSel) this._inboxSel = /* @__PURE__ */ new Set();
    const alive = new Set(files.map((f) => f.path));
    Array.from(this._inboxSel).forEach((p) => {
      if (!alive.has(p)) this._inboxSel.delete(p);
    });
    const suggestions = /* @__PURE__ */ new Map();
    files.forEach((f) => {
      const mod = this.suggestModuleFor(f);
      if (mod) suggestions.set(f.path, mod);
    });
    el.addClass("cl-inbox-scroll");
    const page = el.createDiv({ cls: "cl-inbox-page" });
    const head = page.createDiv({ cls: "cl-inbox-head" });
    const headMain = head.createDiv({ cls: "cl-inbox-head-main" });
    const titleRow = headMain.createDiv({ cls: "cl-inbox-title-row" });
    titleRow.createEl("h1", { text: "\u6536\u4EF6\u7BB1" });
    if (files.length) {
      titleRow.createDiv({ cls: "cl-inbox-count", text: files.length + " \u5F85\u5904\u7406" });
    }
    headMain.createDiv({
      cls: "cl-inbox-sub",
      text: "\u53EA\u663E\u793A\u6563\u843D\u5728\u5E93\u6839\u76EE\u5F55\u3001\u8FD8\u6CA1\u8FDB\u4EFB\u4F55\u6587\u4EF6\u5939\u7684\u6587\u4EF6\uFF1B\u5F52\u5165\u6A21\u5757\u540E\u81EA\u52A8\u79BB\u5F00"
    });
    const headActions = head.createDiv({ cls: "cl-inbox-head-actions" });
    const refreshBtn = headActions.createEl("button", { cls: "cl-inbox-refresh" });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.setAttribute("aria-label", "\u5237\u65B0\u6536\u4EF6\u7BB1");
    refreshBtn.onclick = () => this.refresh();
    const weekCount = files.filter(
      (f) => Date.now() - f.stat.mtime < 7 * 864e5
    ).length;
    const stats = page.createDiv({ cls: "cl-inbox-stats" });
    [
      ["\u6839\u76EE\u5F55\u5F85\u5904\u7406", files.length],
      ["\u6709\u5F52\u5C5E\u5EFA\u8BAE", suggestions.size],
      ["\u672C\u5468\u65B0\u589E", weekCount]
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
      attr: { type: "text", placeholder: "\u7B5B\u9009\u6807\u9898\u6216\u8DEF\u5F84" }
    });
    query.value = this._inboxQuery || "";
    const seg = controls.createDiv({ cls: "cl-inbox-seg" });
    const kinds = [
      ["all", "\u5168\u90E8"],
      ["note", "\u7B14\u8BB0"],
      ["image", "\u56FE\u7247"],
      ["video", "\u89C6\u9891"],
      ["doc", "\u6587\u6863"],
      ["audio", "\u97F3\u9891"],
      ["other", "\u5176\u4ED6"]
    ];
    const segButtons = /* @__PURE__ */ new Map();
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
    const viewSeg = controls.createDiv({ cls: "cl-inbox-viewseg" });
    const viewButtons = /* @__PURE__ */ new Map();
    [
      ["list", "\u5217\u8868"],
      ["grid", "\u7F51\u683C"]
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
      text: (this._inboxSort || "recent") === "name" ? "\u540D\u79F0" : "\u6700\u8FD1\u66F4\u65B0"
    });
    setIcon(sortBtn.createSpan({ cls: "cl-inbox-sortico" }), "chevron-down");
    sortBtn.onclick = () => {
      const menu = new Menu();
      [["recent", "\u6700\u8FD1\u66F4\u65B0"], ["name", "\u540D\u79F0"]].forEach(([value, label]) => {
        menu.addItem((item) => {
          item.setTitle(label).setChecked((this._inboxSort || "recent") === value).onClick(() => {
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
    bulkLabel.createSpan({ text: "\u5DF2\u9009 " });
    const bulkNum = bulkLabel.createEl("b", { text: "0" });
    bulkLabel.createSpan({ text: " \u9879" });
    bulk.createDiv({ cls: "cl-inbox-bulkspace" });
    const bulkAssign = bulk.createEl("button", {
      cls: "cl-btn cl-btn-accent",
      text: "\u5F52\u5165\u9009\u4E2D"
    });
    const bulkDelete = bulk.createEl("button", {
      cls: "cl-btn cl-inbox-danger",
      text: "\u5220\u9664\u9009\u4E2D"
    });
    const list = page.createDiv({ cls: "cl-inbox-list" });
    const foot = page.createDiv({ cls: "cl-inbox-foot" });
    foot.createSpan({
      text: this.inboxPolicy() === "root" ? "\u5E93\u6839\u76EE\u5F55 " + this.rootFiles().length + " \u4E2A\u6587\u4EF6 \xB7 \u6587\u4EF6\u5939\u5185\u7684\u6587\u4EF6\u4E0D\u8FDB\u5165\u6536\u4EF6\u7BB1" : "\u5168\u5E93\u626B\u63CF " + (this.vaultFiles().length + this.vaultAttachments().length) + " \u4E2A\u6587\u4EF6"
    });
    foot.createSpan({
      cls: "cl-inbox-footright",
      text: "\u5171 " + files.length + " \u6761\u5F85\u5904\u7406"
    });
    const selectedFiles = () => files.filter((f) => this._inboxSel.has(f.path));
    bulkAssign.onclick = () => {
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
        note: "file-text",
        image: "image",
        video: "video",
        audio: "music",
        doc: "file-text",
        other: "file"
      }[key] || "file";
      if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) icon = "archive";
      return { key, icon };
    };
    const groupFor = (ts) => {
      const now = /* @__PURE__ */ new Date();
      const date = new Date(ts);
      if (date.toDateString() === now.toDateString()) return "\u4ECA\u5929";
      if (now.getTime() - ts < 7 * 864e5) return "\u672C\u5468";
      return "\u66F4\u65E9";
    };
    let current = [];
    const matches = (file) => {
      const kind = this._inboxFilter || "all";
      if (kind !== "all" && typeInfo(file).key !== kind) return false;
      const q = String(this._inboxQuery || "").trim().toLowerCase();
      if (!q) return true;
      return file.basename.toLowerCase().includes(q) || file.path.toLowerCase().includes(q);
    };
    const updateBulk = () => {
      const n = this._inboxSel.size;
      bulk.hidden = n === 0;
      bulkNum.setText(String(n));
      bulkAssign.disabled = n === 0;
      bulkDelete.disabled = n === 0;
    };
    const renderGrid = (parent, items) => {
      const grid = parent.createDiv({ cls: "cl-md-grid" });
      items.forEach((file) => {
        const info = typeInfo(file);
        const selected = this._inboxSel.has(file.path);
        const tile = grid.createDiv({
          cls: "cl-md-tile cl-inbox-tile cl-md-kind-" + info.key + (selected ? " is-selected" : "")
        });
        tile.setAttribute("draggable", "true");
        tile.addEventListener("dragstart", (event) => {
          const paths = this._inboxSel.has(file.path) ? current.filter((f) => this._inboxSel.has(f.path)).map((f) => f.path) : null;
          this.startFileDrag(event, file, paths);
        });
        tile.addEventListener("dragend", () => this.endFileDrag());
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
          attr: { type: "checkbox", "aria-label": "\u9009\u62E9 " + file.basename }
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
        tileMeta.createSpan({ text: THUMB_KIND_LABELS[info.key] || "\u6587\u4EF6" });
        tileMeta.createSpan({ text: formatTime(file.stat.mtime) });
        const suggest = suggestions.get(file.path);
        if (suggest) {
          const sug = tile.createDiv({ cls: "cl-inbox-tilesug" });
          const chip = sug.createSpan({ cls: "cl-inbox-suggest" });
          const dot = chip.createSpan({ cls: "cl-inbox-dot" });
          dot.style.setProperty("--dot", suggest.color || "var(--interactive-accent)");
          chip.createSpan({ text: "\u5EFA\u8BAE \xB7 " + suggest.name });
          const accept = sug.createEl("button", {
            cls: "cl-inbox-adopt",
            attr: { "aria-label": "\u91C7\u7EB3\u5EFA\u8BAE\uFF1A" + suggest.name }
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
          assign.setAttribute("aria-label", "\u5F52\u5165\u6A21\u5757");
          assign.onclick = (evt) => {
            evt.stopPropagation();
            this.openModulePicker([file]);
          };
        }
        const open = acts.createEl("button", { cls: "cl-inbox-act" });
        setIcon(open, "corner-up-right");
        open.setAttribute("aria-label", "\u6253\u5F00");
        open.onclick = (evt) => {
          evt.stopPropagation();
          this.openFile(file);
        };
        const remove = acts.createEl("button", { cls: "cl-inbox-act is-danger" });
        setIcon(remove, "trash-2");
        remove.setAttribute("aria-label", "\u5220\u9664");
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
      current.sort(
        (a, b) => sortBy === "name" ? a.basename.localeCompare(b.basename, "zh") : b.stat.mtime - a.stat.mtime
      );
      while (list.firstChild) list.removeChild(list.firstChild);
      const gridMode = (this._inboxView || "list") === "grid";
      list.classList.toggle("is-grid", gridMode);
      if (!files.length) {
        const empty = list.createDiv({ cls: "cl-inbox-empty" });
        const art = empty.createDiv({ cls: "cl-inbox-emptyart" });
        setIcon(art, "inbox");
        empty.createEl("h2", { text: "\u6536\u4EF6\u7BB1\u5DF2\u6E05\u7A7A" });
        empty.createDiv({
          cls: "cl-inbox-emptysub",
          text: "\u6240\u6709\u7B14\u8BB0\u90FD\u5DF2\u5F52\u5165\u6A21\u5757\u3002\u65B0\u7684\u6563\u843D\u6587\u4EF6\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002"
        });
        const acts = empty.createDiv({ cls: "cl-inbox-emptyacts" });
        const home = acts.createEl("button", { cls: "cl-btn cl-btn-accent", text: "\u56DE\u5230\u9996\u9875" });
        home.onclick = () => this.go("home");
        const again = acts.createEl("button", { cls: "cl-btn", text: "\u5237\u65B0" });
        again.onclick = () => this.refresh();
        updateBulk();
        return;
      }
      if (!current.length) {
        const none = list.createDiv({ cls: "cl-inbox-nomatch" });
        none.createSpan({ text: "\u6CA1\u6709\u5339\u914D\u7684\u6761\u76EE" });
        const clear = none.createEl("button", { cls: "cl-inbox-clear", text: "\u6E05\u9664\u7B5B\u9009" });
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
      const buckets = [["\u4ECA\u5929", []], ["\u672C\u5468", []], ["\u66F4\u65E9", []]];
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
          card.setAttribute("draggable", "true");
          card.addEventListener("dragstart", (event) => {
            const paths = this._inboxSel.has(file.path) ? current.filter((f) => this._inboxSel.has(f.path)).map((f) => f.path) : null;
            this.startFileDrag(event, file, paths);
          });
          card.addEventListener("dragend", () => this.endFileDrag());
          const check = card.createDiv({ cls: "cl-inbox-check" });
          const box = check.createEl("input", {
            attr: { type: "checkbox", "aria-label": "\u9009\u62E9 " + file.basename }
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
            chip.createSpan({ text: "\u5EFA\u8BAE \xB7 " + suggest.name });
            const accept = swap.createEl("button", {
              cls: "cl-inbox-adopt",
              attr: { "aria-label": "\u91C7\u7EB3\u5EFA\u8BAE\uFF1A" + suggest.name }
            });
            setIcon(accept, "check");
            accept.onclick = (evt) => {
              evt.stopPropagation();
              this.assignToModule([file], suggest);
            };
          } else {
            swap.createSpan({ cls: "cl-inbox-nosug", text: "\u6682\u65E0\u5EFA\u8BAE" });
          }
          card.createDiv({ cls: "cl-inbox-time", text: formatTime(file.stat.mtime) });
          const acts = card.createDiv({ cls: "cl-inbox-actions" });
          if (file.extension === "md") {
            const assign = acts.createEl("button", { cls: "cl-inbox-act" });
            setIcon(assign, "folder");
            assign.setAttribute("aria-label", "\u5F52\u5165\u6A21\u5757");
            assign.onclick = (evt) => {
              evt.stopPropagation();
              this.openModulePicker([file]);
            };
          }
          const open = acts.createEl("button", { cls: "cl-inbox-act" });
          setIcon(open, "corner-up-right");
          open.setAttribute("aria-label", "\u6253\u5F00");
          open.onclick = (evt) => {
            evt.stopPropagation();
            this.openFile(file);
          };
          const remove = acts.createEl("button", { cls: "cl-inbox-act is-danger" });
          setIcon(remove, "trash-2");
          remove.setAttribute("aria-label", "\u5220\u9664");
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
        text: "\u672A\u77E5\u6A21\u5757\u503C\u300C" + value + "\u300D\xB7 " + groupFiles.length + " \u7BC7"
      });
      const actions = banner.createDiv({ cls: "cl-banner-actions" });
      const create = actions.createEl("button", {
        cls: "cl-btn cl-btn-accent",
        text: "\u65B0\u5EFA\u6A21\u5757"
      });
      create.onclick = () => this.openModuleEditor(null, value);
      const pick = actions.createEl("button", { cls: "cl-btn", text: "\u5F52\u5165\u73B0\u6709\u6A21\u5757" });
      pick.onclick = () => this.openModulePicker(groupFiles);
      const ignore = actions.createEl("button", { cls: "cl-btn", text: "\u5FFD\u7565" });
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
    const childHue = (child, index) => child.color || tintPalette[(Math.max(modIndex, 0) + 1 + index) % tintPalette.length];
    const treeFiles = children.length ? this.moduleTreeNoteFiles(mod).sort((a, b) => b.stat.mtime - a.stat.mtime) : [];
    const parentDir = String(this.moduleTargetFolder(mod) || "").replace(/\/+$/, "");
    const annotate = (file) => {
      const fileDir = String(file.parent ? file.parent.path : "").replace(/\/+$/, "");
      let depth = 0;
      if (parentDir && fileDir && fileDir !== parentDir && fileDir.startsWith(parentDir + "/")) {
        depth = fileDir.slice(parentDir.length + 1).split("/").length;
      }
      let owner = null;
      let dir = fileDir;
      while (dir && (!parentDir || dir !== parentDir)) {
        if (parentDir && parentDir !== "" && dir.startsWith(parentDir + "/")) {
          const cand = this.moduleForFolder(dir);
          if (cand) {
            owner = cand;
            break;
          }
        } else if (!parentDir || parentDir === "") {
          const cand = this.moduleForFolder(dir);
          if (cand) {
            owner = cand;
            break;
          }
        }
        const parts = dir.split("/");
        parts.pop();
        dir = parts.join("/");
      }
      if (!owner && depth > 0) {
        owner = this.moduleForFolder(fileDir);
      }
      return { file, depth, owner };
    };
    const wrappedSelf = allNotes.map((file) => ({ file, depth: 0, owner: null }));
    const wrappedTree = treeFiles.map(annotate);
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();
    const weekTs = todayTs - 6 * 864e5;
    const groupOf = (ts) => ts >= todayTs ? "\u4ECA\u5929" : ts >= weekTs ? "\u672C\u5468" : "\u66F4\u65E9";
    const pad2 = (n) => String(n).padStart(2, "0");
    const fmtDate = (ts) => {
      const d = new Date(ts);
      if (ts >= todayTs) return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
      return d.getMonth() + 1 + "-" + pad2(d.getDate());
    };
    const fmtSize = (bytes) => {
      const n = Number(bytes || 0);
      if (!n) return "\u2014";
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
    if (this._mdSelModule !== mod.id) {
      this._mdSelModule = mod.id;
      this._mdMulti = false;
      this._mdSel = /* @__PURE__ */ new Set();
      this._mdIncludeChildren = false;
    }
    const selected = this._mdSel;
    let includeChildren = !!this._mdIncludeChildren;
    const depthHuePalette = ["#b394af", "#e9c77e", "#ce7379", "#7fa9b6", "#5d86a4"];
    const currentPoolOf = () => includeChildren ? wrappedTree : wrappedSelf;
    const toggleSelect = (path) => {
      if (selected.has(path)) selected.delete(path);
      else selected.add(path);
      draw();
    };
    el.empty();
    el.addClass("cl-md-scroll");
    const page = el.createDiv({ cls: "cl-md-page cl-mdv" });
    const crumbs = page.createDiv({ cls: "cl-mdv-crumbs" });
    const homeChip = crumbs.createSpan({
      cls: "cl-mdv-chip",
      text: this.plugin.settings.workspaceName || "\u5DE5\u4F5C\u53F0"
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
    const head = page.createDiv({ cls: "cl-mdv-head" });
    const headMain = head.createDiv({ cls: "cl-mdv-headmain" });
    const titleRow = headMain.createDiv({ cls: "cl-mdv-title" });
    titleRow.createEl("h1", { text: mod.name });
    titleRow.createSpan({ cls: "cl-mdv-num", text: "\u672C\u5C42 " + allNotes.length + " \u7BC7" });
    if (liveToday) {
      const live = titleRow.createSpan({ cls: "cl-mdv-live" });
      live.createEl("i");
      live.appendText("\u4ECA\u5929\u6709\u66F4\u65B0");
    }
    const treeNotes = children.length ? this.moduleTreeNoteFiles(mod).length : allNotes.length;
    const newest = allNotes.length ? allNotes.reduce((max, file) => Math.max(max, file.stat.mtime), 0) : 0;
    const meta = headMain.createDiv({ cls: "cl-mdv-meta" });
    const metaPart = (text) => meta.createSpan({ text });
    const metaDot = () => meta.createSpan({ cls: "cl-mdv-dotsep", text: "\xB7" });
    metaPart(children.length + " \u4E2A\u5B50\u6A21\u5757");
    if (children.length) {
      metaDot();
      metaPart("\u542B\u5B50\u6A21\u5757 " + treeNotes + " \u7BC7");
    } else if (newest) {
      metaDot();
      metaPart("\u6700\u540E\u6D3B\u52A8 " + fmtDate(newest));
    }
    const acts = head.createDiv({ cls: "cl-mdv-acts" });
    const searchBtn = acts.createDiv({
      cls: "cl-mdv-ibtn" + (searching ? " is-on" : ""),
      attr: { "aria-label": "\u7B5B\u9009\u7B14\u8BB0", role: "button" }
    });
    setIcon(searchBtn, "search");
    const moreBtn = acts.createDiv({
      cls: "cl-mdv-ibtn",
      attr: { "aria-label": "\u66F4\u591A\u64CD\u4F5C", role: "button" }
    });
    setIcon(moreBtn, "more-horizontal");
    moreBtn.onclick = () => {
      const menu = new Menu();
      menu.addItem(
        (item) => item.setTitle("\u7F16\u8F91\u6A21\u5757").setIcon("settings").onClick(() => this.openModuleEditor(mod))
      );
      menu.addItem(
        (item) => item.setTitle("\u91CD\u547D\u540D\u6A21\u5757\u2026").setIcon("pencil").onClick(() => this.renameModule(mod))
      );
      menu.addItem(
        (item) => item.setTitle("\u5220\u9664\u6A21\u5757\u2026").setIcon("trash").onClick(() => {
          void this.deleteModule(mod);
        })
      );
      menu.addSeparator();
      menu.addItem(
        (item) => item.setTitle(this._mdMulti ? "\u9000\u51FA\u591A\u9009" : "\u591A\u9009\u5220\u9664").setIcon("list-checks").setChecked(this._mdMulti).onClick(() => {
          this._mdMulti = !this._mdMulti;
          if (!this._mdMulti) this._mdSel.clear();
          draw();
        })
      );
      menu.addItem(
        (item) => item.setTitle("\u7BA1\u7406\u6A21\u5757").setIcon("folder-cog").onClick(() => this.openModuleManager())
      );
      anchorMenuBelow(menu, moreBtn);
    };
    const newBtn = acts.createEl("button", { cls: "cl-mdv-btn is-primary" });
    setIcon(newBtn.createSpan({ cls: "cl-mdv-btnico" }), "plus");
    newBtn.appendText("\u65B0\u5EFA");
    setIcon(newBtn.createSpan({ cls: "cl-mdv-caret" }), "chevron-down");
    newBtn.onclick = () => {
      const menu = new Menu();
      menu.addItem(
        (item) => item.setTitle("\u65B0\u5EFA\u7B14\u8BB0").setIcon("file-plus").onClick(() => this.createModuleNote(mod))
      );
      menu.addItem(
        (item) => item.setTitle("\u65B0\u5EFA\u5B50\u6A21\u5757").setIcon("folder-plus").onClick(() => this.promptSubmodule(mod))
      );
      menu.addSeparator();
      menu.addItem(
        (item) => item.setTitle("\u5F52\u5165\u6587\u4EF6").setIcon("download").onClick(() => this.addFilesToModule(mod))
      );
      anchorMenuBelow(menu, newBtn);
    };
    const searchWrap = page.createDiv({ cls: "cl-mdv-search" + (searching ? " is-on" : "") });
    const queryInput = searchWrap.createEl("input", {
      cls: "cl-mdv-searchinput",
      attr: { type: "text", placeholder: "\u7B5B\u9009\u672C\u5C42\u7B14\u8BB0\u2026" }
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
    const subSec = page.createDiv({ cls: "cl-mdv-sec" });
    subSec.createEl("h3", { text: "\u5B50\u6A21\u5757" });
    subSec.createSpan({ cls: "cl-mdv-count", text: String(children.length) });
    subSec.createSpan({ cls: "cl-mdv-line" });
    if (children.length) {
      const manage = subSec.createSpan({ cls: "cl-mdv-secact", text: "\u7BA1\u7406" });
      manage.onclick = () => this.openModuleManager();
    }
    if (children.length) {
      const grid = page.createDiv({ cls: "cl-mdv-mods" });
      children.forEach((child, index) => {
        const childTree = this.moduleTreeNoteFiles(child);
        const childNewest = childTree.length ? childTree.reduce((max, file) => Math.max(max, file.stat.mtime), 0) : 0;
        const card = grid.createDiv({ cls: "cl-mdv-modcard" });
        card.style.setProperty("--hue", childHue(child, index));
        card.createDiv({ cls: "cl-mdv-wash" });
        card.createDiv({ cls: "cl-mdv-hair" });
        const top = card.createDiv({ cls: "cl-mdv-mctop" });
        top.createSpan({ cls: "cl-mdv-huedot" });
        top.createSpan({ cls: "cl-mdv-mcname", text: child.name });
        const num = card.createDiv({ cls: "cl-mdv-mcnum" });
        num.appendText(String(this.moduleNoteFiles(child).length));
        num.createSpan({ text: "\u7BC7" });
        card.createDiv({
          cls: "cl-mdv-mcmeta",
          text: childNewest ? "\u6700\u8FD1 " + fmtDate(childNewest) : "\u6682\u65E0\u7B14\u8BB0"
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
      addInner.appendText("\u65B0\u5EFA\u5B50\u6A21\u5757");
      addCard.onclick = () => this.promptSubmodule(mod);
    } else {
      const shelf = page.createDiv({ cls: "cl-mdv-shelf" });
      const shelfIcon = shelf.createDiv({ cls: "cl-mdv-shelf-icon" });
      setIcon(shelfIcon, "folder-plus");
      const shelfText = shelf.createDiv({ cls: "cl-mdv-shelf-text" });
      shelfText.createDiv({ cls: "cl-mdv-shelf-title", text: "\u8FD8\u6CA1\u6709\u5B50\u6A21\u5757" });
      shelfText.createDiv({
        cls: "cl-mdv-shelf-sub",
        text: "\u5B50\u6A21\u5757\u5C31\u662F\u6587\u4EF6\u5939\uFF0C\u7528\u6765\u7EE7\u7EED\u5206\u5C42\u3002\u4E5F\u53EF\u4EE5\u4E0D\u5EFA\uFF0C\u76F4\u63A5\u5728\u8FD9\u4E00\u5C42\u5199\u7B14\u8BB0\u3002"
      });
      const shelfBtn = shelf.createEl("button", { cls: "cl-mdv-shelf-btn" });
      setIcon(shelfBtn.createSpan({ cls: "cl-mdv-addicon" }), "plus");
      shelfBtn.appendText("\u65B0\u5EFA\u5B50\u6A21\u5757");
      shelfBtn.onclick = () => this.promptSubmodule(mod);
    }
    const noteSec = page.createDiv({ cls: "cl-mdv-sec" });
    noteSec.createEl("h3", { text: "\u672C\u5C42\u7B14\u8BB0" });
    const noteCount = noteSec.createSpan({ cls: "cl-mdv-count", text: String(allNotes.length) });
    noteSec.createSpan({ cls: "cl-mdv-line" });
    let treeBtn = null;
    if (children.length) {
      treeBtn = noteSec.createSpan({ cls: "cl-mdv-treebtn" + (includeChildren ? " is-on" : "") });
      const treeDot = treeBtn.createSpan({ cls: "cl-mdv-treedot" });
      setIcon(treeDot, includeChildren ? "check" : "chevron-down");
      treeBtn.createSpan({ cls: "cl-mdv-treetxt", text: "\u5305\u542B\u5B50\u6A21\u5757" });
      treeBtn.onclick = () => {
        includeChildren = !includeChildren;
        this._mdIncludeChildren = includeChildren;
        draw();
      };
    }
    const viewSw = noteSec.createSpan({ cls: "cl-mdv-viewsw" });
    const listBtn = viewSw.createSpan({ text: "\u5217\u8868" });
    const gridBtn = viewSw.createSpan({ text: "\u5361\u7247" });
    const body = page.createDiv({ cls: "cl-md-body cl-mdv-body" });
    const selBar = el.createDiv({ cls: "cl-md-selbar" });
    const selCount = selBar.createSpan({ cls: "cl-md-selcount" });
    const selCancel = selBar.createEl("button", { cls: "cl-md-btn", text: "\u53D6\u6D88" });
    selCancel.onclick = () => {
      this._mdMulti = false;
      this._mdSel.clear();
      draw();
    };
    const selDelete = selBar.createEl("button", { cls: "cl-md-btn cl-md-btn-danger", text: "\u5220\u9664\u6240\u9009" });
    selDelete.onclick = () => {
      const chosen = currentPoolOf().map((entry) => entry.file).filter((file) => this._mdSel.has(file.path));
      if (!chosen.length) return;
      this.deleteFiles(chosen, () => {
        this._mdMulti = false;
        this._mdSel.clear();
        this.refresh();
      });
    };
    const renderList = (items) => {
      const groups = /* @__PURE__ */ new Map([["\u4ECA\u5929", []], ["\u672C\u5468", []], ["\u66F4\u65E9", []]]);
      items.forEach((entry) => groups.get(groupOf(entry.file.stat.mtime)).push(entry));
      groups.forEach((list, name) => {
        if (!list.length) return;
        body.createDiv({ cls: "cl-mdv-glabel", text: name });
        list.forEach((entry) => {
          const file = entry.file;
          const picked = this._mdSel.has(file.path);
          const row = body.createDiv({
            cls: "cl-mdv-row" + (this._mdMulti && picked ? " is-selected" : "")
          });
          row.setAttribute("draggable", "true");
          row.dataset.path = file.path;
          row.addEventListener("dragstart", (event) => this.startFileDrag(event, file));
          row.addEventListener("dragend", () => this.endFileDrag());
          const rowHue = entry.owner && entry.owner.color ? entry.owner.color : depthHuePalette[(entry.depth || 0) % depthHuePalette.length];
          row.style.setProperty("--hue", entry.depth > 0 ? rowHue : tint);
          if (entry.depth > 0 && entry.owner) {
            const badge = row.createDiv({ cls: "cl-mdv-rowmod" });
            badge.createSpan({ cls: "cl-mdv-rowmodico" });
            badge.createSpan({ cls: "cl-mdv-rowmodname", text: entry.owner.name });
            badge.title = "\u8DF3\u8F6C\u5230\u300C" + entry.owner.name + "\u300D";
            badge.onclick = (event) => {
              event.stopPropagation();
              this.go(this.moduleIdOf(entry.owner));
            };
            row.classList.add("has-child-note");
          }
          const glyph = row.createDiv({ cls: "cl-mdv-glyph" });
          if (this._mdMulti) {
            const box = glyph.createEl("input", {
              attr: { type: "checkbox", "aria-label": "\u9009\u62E9 " + file.basename }
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
          row.createDiv({
            cls: "cl-mdv-tag",
            text: entry.depth > 0 && entry.owner ? entry.owner.name : mod.name
          });
          row.createDiv({ cls: "cl-mdv-date", text: fmtDate(file.stat.mtime) });
          if (!this._mdMulti) {
            const more = row.createDiv({
              cls: "cl-mdv-more",
              attr: { "aria-label": "\u66F4\u591A " + file.basename, role: "button" }
            });
            setIcon(more, "more-horizontal");
            more.onclick = (event) => {
              event.stopPropagation();
              this.showFileMenu(event, file);
            };
          }
          row.onclick = () => {
            if (this._mdMulti) toggleSelect(file.path);
            else this.openFile(file);
          };
        });
      });
    };
    const renderGrid = (items) => {
      const grid = body.createDiv({ cls: "cl-md-grid" });
      items.forEach((entry) => {
        const file = entry.file;
        const picked = this._mdSel.has(file.path);
        const tile = grid.createDiv({
          cls: "cl-md-tile cl-md-kind-note" + (this._mdMulti && picked ? " is-selected" : "")
        });
        tile.setAttribute("draggable", "true");
        tile.dataset.path = file.path;
        tile.addEventListener("dragstart", (event) => this.startFileDrag(event, file));
        tile.addEventListener("dragend", () => this.endFileDrag());
        const thumb = tile.createDiv({ cls: "cl-md-thumb" });
        paintNoteThumb(this.app, thumb, file);
        if (this._mdMulti) {
          const check = tile.createDiv({ cls: "cl-md-tilecheck" });
          const box = check.createEl("input", {
            attr: { type: "checkbox", "aria-label": "\u9009\u62E9 " + file.basename }
          });
          box.checked = picked;
          box.onclick = (event) => {
            event.stopPropagation();
            toggleSelect(file.path);
          };
        }
        tile.createDiv({ cls: "cl-md-tilename", text: file.basename });
        const tileMeta = tile.createDiv({ cls: "cl-md-tilemeta" });
        tileMeta.createSpan({ text: "\u7B14\u8BB0" });
        tileMeta.createSpan({ text: fmtSize(file.stat.size) });
        if (entry.depth > 0 && entry.owner) {
          const badge = tile.createDiv({ cls: "cl-md-tilemod" });
          badge.createSpan({ cls: "cl-md-tilemodico" });
          badge.createSpan({ cls: "cl-md-tilemodname", text: entry.owner.name });
          tile.classList.add("has-child-note");
        }
        if (!this._mdMulti) {
          const more = tile.createEl("button", {
            cls: "cl-md-tilemore",
            attr: { "aria-label": "\u66F4\u591A " + file.basename }
          });
          setIcon(more, "more-horizontal");
          more.onclick = (event) => {
            event.stopPropagation();
            this.showFileMenu(event, file);
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
      if (treeBtn) {
        treeBtn.classList.toggle("is-on", includeChildren);
        const dot = treeBtn.querySelector(".cl-mdv-treedot");
        if (dot) setIcon(dot, includeChildren ? "check" : "chevron-down");
      }
      const currentPool = currentPoolOf();
      selBar.classList.toggle("is-on", !!this._mdMulti && currentPool.length > 0);
      selCount.setText("\u5DF2\u9009 " + selected.size + " \u9879");
      selDelete.disabled = selected.size === 0;
      noteCount.setText(String(currentPool.length));
      const q = query.trim().toLowerCase();
      const items = currentPool.filter((entry) => !q || entry.file.path.toLowerCase().includes(q));
      body.empty();
      if (!currentPool.length) {
        const blank = body.createDiv({ cls: "cl-mdv-blank" });
        const blankIcon = blank.createDiv({ cls: "cl-mdv-blank-icon" });
        setIcon(blankIcon, "file-text");
        const blankText = blank.createDiv({ cls: "cl-mdv-blank-text" });
        if (includeChildren) {
          blankText.createDiv({ cls: "cl-mdv-blank-title", text: "\u8FD9\u4E2A\u6A21\u5757\uFF08\u542B\u5B50\u6A21\u5757\uFF09\u8FD8\u6CA1\u6709\u7B14\u8BB0" });
          blankText.createDiv({
            cls: "cl-mdv-blank-sub",
            text: "\u5173\u6389\u300C\u5305\u542B\u5B50\u6A21\u5757\u300D\u53EF\u4EE5\u53EA\u770B\u672C\u5C42\uFF1B\u6216\u5728\u672C\u5C42\u76F4\u63A5\u65B0\u5EFA\u7B14\u8BB0\u3002"
          });
        } else {
          blankText.createDiv({ cls: "cl-mdv-blank-title", text: "\u8FD9\u4E00\u5C42\u8FD8\u6CA1\u6709\u7B14\u8BB0" });
          blankText.createDiv({
            cls: "cl-mdv-blank-sub",
            text: "\u76F4\u63A5\u5728\u7236\u6A21\u5757\u5199\u53EF\u4EE5\uFF1B\u4E5F\u53EF\u4EE5\u70B9\u4E0A\u9762\u7684\u5B50\u6A21\u5757\u7EE7\u7EED\u5206\u5C42\u3002"
          });
        }
        const blankBtn = blank.createEl("button", { cls: "cl-mdv-blank-btn", text: "\u65B0\u5EFA\u7B14\u8BB0" });
        blankBtn.onclick = () => this.createModuleNote(mod);
        return;
      }
      if (!items.length) {
        body.createDiv({ cls: "cl-mdv-nomatch", text: "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0" });
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
    const dir = this.moduleTargetFolder(mod);
    if (!dir) {
      this.pickModuleFolder(mod);
      return;
    }
    try {
      await ensureVaultFolder(this.app, dir);
    } catch (error) {
      new Notice("\u521B\u5EFA\u6A21\u5757\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + (error && error.message ? error.message : error));
      return;
    }
    this.createNoteInFolder(mod, dir);
  }
  pickModuleFolder(mod) {
    new FolderPickerModal(this.app, {
      current: String(mod.folder || ""),
      onPick: (path) => {
        mod.folder = path;
        this.plugin.persistSettings();
        this.createNoteInFolder(mod, path);
      }
    }).open();
  }
  async createNoteInFolder(mod, dir) {
    const folder = String(dir || "").replace(/^\/+|\/+$/g, "");
    const now = /* @__PURE__ */ new Date();
    const stamp = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "-" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    let path = folder + "/\u672A\u547D\u540D\u7B14\u8BB0 " + stamp + ".md";
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = folder + "/\u672A\u547D\u540D\u7B14\u8BB0 " + stamp + "-" + n + ".md";
      n += 1;
    }
    const moduleValue = String(mod.id || "").startsWith("dir:") ? mod.name : mod.id || mod.name;
    const content = "---\nmodule: " + moduleValue + "\nstatus: \u8349\u7A3F\ncreated: " + now.toISOString().slice(0, 10) + "\n---\n\n";
    try {
      const file = await this.app.vault.create(path, content);
      this._ownership = null;
      await this.app.workspace.getLeaf("tab").openFile(file);
      setTimeout(() => this.refresh(), 350);
    } catch (e) {
      new Notice("\u65B0\u5EFA\u7B14\u8BB0\u5931\u8D25\uFF1A" + (e && e.message ? e.message : e));
    }
  }
  renderCanvas(el) {
    el.addClass("cl-scroll-canvas");
    const novalBoard = this.plugin.childPlugins && this.plugin.childPlugins[BOARD_ID];
    if (!novalBoard) {
      const head = el.createDiv({ cls: "cl-pagehead" });
      head.createEl("h1", { text: "\u767D\u677F" });
      head.createDiv({
        cls: "cl-sub",
        text: "Noval \u753B\u5E03\u96C6\u6CA1\u6709\u52A0\u8F7D\u6210\u529F\uFF0C\u8BF7\u6253\u5F00\u63A7\u5236\u53F0\u67E5\u770B [noval] \u65E5\u5FD7\u3002"
      });
      return;
    }
    if (!this.gallery) this.gallery = new NovalGalleryPanel(this.app, novalBoard);
    this.gallery.mount(el);
  }
  renderNotes(el) {
    el.addClass("cl-scroll-notes");
    const noval = this.plugin.childPlugins && this.plugin.childPlugins[NOTES_ID] || this.app.plugins.plugins && this.app.plugins.plugins[LEGACY.notesId];
    if (!noval) {
      const head = el.createDiv({ cls: "cl-pagehead" });
      head.createEl("h1", { text: "\u5361\u7247\u7B14\u8BB0" });
      head.createDiv({
        cls: "cl-sub",
        text: "Noval \u6CA1\u6709\u52A0\u8F7D\u6210\u529F\uFF0C\u8BF7\u6253\u5F00\u63A7\u5236\u53F0\u67E5\u770B [noval] \u65E5\u5FD7\u3002"
      });
      return;
    }
    if (!this.notes) this.notes = new NovalNotesPanel(this.app, noval, this);
    this.notes.mount(el);
  }
};
// 卡片笔记自己的 AI 设置：只决定打标签的方式，模型配置仍共用画布的 profiles。
function renderNotesAiSettings(containerEl, plugin) {
  new Setting(containerEl).setName("卡片笔记 · AI").setHeading();
  const notes = plugin.childPlugins && plugin.childPlugins[NOTES_ID];
  if (!notes || !notes.settings) {
    containerEl.createEl("p", {
      cls: "cl-settings-hint",
      text: "卡片笔记组件未加载，暂时无法配置。请重载插件后再试。"
    });
    return;
  }
  notes.settings.aiTag = Object.assign({}, NovalAiTag.AI_TAG_DEFAULTS, notes.settings.aiTag || {});
  const opts = notes.settings.aiTag;
  const save = async () => {
    await notes.saveSettings(false);
  };

  new Setting(containerEl).setName("AI 打标签").setDesc(
    "插件不预设任何标签，标签从你自己的卡片里长出来。只发送当前这张卡的正文，不读全库。"
  ).addToggle((toggle) => toggle.setValue(opts.enabled !== false).onChange(async (value) => {
    opts.enabled = value;
    await save();
  }));

  new Setting(containerEl).setName("打标签模式").setDesc(
    "建议 = AI 一次给一组候选，你自己勾（默认，可多选）；自动 = AI 直接写入，只进已有标签；手动 = AI 只给参考，一个都不预选。"
  ).addDropdown((drop) => drop
    .addOption("suggest", "建议（推荐）")
    .addOption("auto", "自动")
    .addOption("manual", "手动")
    .setValue(["suggest", "auto", "manual"].indexOf(opts.mode) === -1 ? "suggest" : opts.mode)
    .onChange(async (value) => {
      opts.mode = value;
      await save();
    }));

  const boardForNotes = plugin.childPlugins && plugin.childPlugins[BOARD_ID];
  const ai = boardForNotes && boardForNotes.settings && boardForNotes.settings.ai;
  const profiles = ai && Array.isArray(ai.profiles) ? ai.profiles : [];
  const active = ai && NovalBoardBundle.activeProfile ? NovalBoardBundle.activeProfile(ai) : null;
  const modelSetting = new Setting(containerEl).setName("打标签用哪个模型").setDesc(
    "和画布问答共用同一份模型配置，不用重新填密钥。"
  );
  modelSetting.addDropdown((drop) => {
    drop.addOption("", "跟随画布当前" + (active ? "（" + (active.name || active.model) + "）" : ""));
    for (const p of profiles) {
      drop.addOption(p.id, (p.name || p.model || p.id) + " · " + (p.model || ""));
    }
    drop.setValue(opts.profileId || "").onChange(async (value) => {
      opts.profileId = value;
      await save();
    });
  });
  if (!profiles.length) {
    modelSetting.setDesc("还没有模型配置：先到下方 画布 → AI 里添加一个，这里会自动共用。");
  }

  new Setting(containerEl).setName("标签宽窄").setDesc(
    "跟随 = 从你现有标签的习惯里自动推断（推荐）。宽 = 多给「时间、成长、关系」这类常用词；中 = 可以给「时间管理」；细 = 可以给「年龄焦虑、告别」这类具体词。"
  ).addDropdown((drop) => drop
    .addOption("follow", "跟随我的习惯（推荐）")
    .addOption("broad", "宽")
    .addOption("medium", "中")
    .addOption("fine", "细")
    .setValue(["follow", "broad", "medium", "fine"].indexOf(opts.granularity) === -1 ? "follow" : opts.granularity)
    .onChange(async (value) => {
      opts.granularity = value;
      await save();
    }));

  new Setting(containerEl).setName("一次给几个候选").setDesc(
    "AI 一次给出的候选数量。给得多、角度散，你挑中的概率才高；自己也能随时加词。"
  ).addDropdown((drop) => drop
    .addOption("4", "4 个")
    .addOption("6", "6 个（推荐）")
    .addOption("8", "8 个")
    .setValue(String(NovalAiTag.CAND_CHOICES && NovalAiTag.CAND_CHOICES.indexOf(Number(opts.maxCand)) !== -1 ? Number(opts.maxCand) : 6))
    .onChange(async (value) => {
      opts.maxCand = Number(value);
      await save();
    }));


  const casesSetting = new Setting(containerEl).setName("决策记忆").setDesc(
    "你每次确认或纠正标签，都会记下来喂给 AI，让建议向你的习惯靠拢。只存插件设置，不写笔记文件。"
  );
  const caseCount = Array.isArray(opts.cases) ? opts.cases.length : 0;
  casesSetting.setDesc("已记住 " + caseCount + " 条决定。你每次确认或纠正标签都会记下来，让 AI 向你的习惯靠拢。");
  casesSetting.addButton((button) => button.setButtonText("清空记忆").onClick(async () => {
    opts.cases = [];
    await save();
    casesSetting.setDesc("已记住 0 条决定。你每次确认或纠正标签都会记下来，让 AI 向你的习惯靠拢。");
    new Notice("已清空 AI 打标签的决策记忆。");
  }));

  let extraTimer = null;
  new Setting(containerEl).setName("我常想用的标签").setDesc(
    "可留空。写进来的词会让 AI 优先复用它们。AI 给你挑中的新词也会自动进这份表，不用手工维护。"
  ).addTextArea((text) => {
    text.setPlaceholder("一行一个，例如：\n时间\n产品\n写作");
    text.setValue((opts.extraVocab || []).join("\n"));
    text.inputEl.rows = 3;
    text.onChange((value) => {
      if (extraTimer) clearTimeout(extraTimer);
      extraTimer = setTimeout(async () => {
        opts.extraVocab = value.split("\n").map((s) => s.trim().replace(/^#+/, "")).filter(Boolean).slice(0, 60);
        await save();
      }, 600);
    });
  });

  const vocabDesc = containerEl.createEl("p", { cls: "cl-settings-hint", text: "正在统计当前词表…" });
  (async () => {
    try {
      const cards = await notes.cardsForSuggest();
      const vocab = NovalAiTag.collectVocab(cards, opts.extraVocab);
      if (!vocab.length) {
        vocabDesc.setText("标签表还是空的：第一次打标签时 AI 会按这张卡自己给词。");
        return;
      }
      const top = vocab.slice(0, 12).map((x) => x.label + "(" + x.count + ")").join("、");
      vocabDesc.setText(
        "你在用的标签 " + vocab.length + " 个：" + top + (vocab.length > 12 ? " …" : "") + "。次数为 0 的是上面手填的。"
      );
    } catch (error) {
      vocabDesc.setText("");
    }
  })();
}
var NovalSettingTab = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("\u5E38\u89C4").setHeading();
    new Setting(containerEl).setName("\u5DE5\u4F5C\u53F0\u540D\u79F0").setDesc("\u663E\u793A\u5728\u5DE6\u4FA7\u5BFC\u822A\u9876\u90E8\u7684\u540D\u79F0\u3002\u7559\u7A7A\u5219\u4F7F\u7528\u300C\u4E2A\u4EBA\u5DE5\u4F5C\u53F0\u300D\u3002").addText(
      (text) => text.setPlaceholder("\u4E2A\u4EBA\u5DE5\u4F5C\u53F0").setValue(this.plugin.settings.workspaceName || "").onChange(async (value) => {
        this.plugin.settings.workspaceName = value.trim() || "\u4E2A\u4EBA\u5DE5\u4F5C\u53F0";
        await this.plugin.persistSettings();
        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
          if (leaf.view && leaf.view.render) leaf.view.render();
        });
      })
    );
    new Setting(containerEl).setName("\u6253\u5F00\u65F6\u8FDB\u5165\u4E13\u6CE8\u6A21\u5F0F").setDesc("\u9690\u85CF\u5DE6\u4FA7\u680F\u3001\u6807\u7B7E\u680F\u548C\u72B6\u6001\u680F\uFF0C\u4FDD\u7559\u53F3\u4FA7\u680F\uFF0C\u65B9\u4FBF\u540C\u65F6\u4F7F\u7528 Noval \u548C\u5176\u4ED6\u9762\u677F\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.focusOnOpen).onChange(async (value) => {
        this.plugin.settings.focusOnOpen = value;
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("\u6A21\u5757").setHeading();
    new Setting(containerEl).setName("\u6A21\u5757\u4E0E\u6587\u4EF6\u6811").setDesc(
      "\u6A21\u5757\u4E0E\u6587\u4EF6\u5939\u4E00\u4E00\u5BF9\u5E94\uFF1A\u6A21\u5757\u9875\u53EA\u663E\u793A\u8BE5\u6587\u4EF6\u5939\u4E0B\u76F4\u63A5\u5B58\u653E\u7684\u7B14\u8BB0\uFF0C\u5B50\u6587\u4EF6\u5939\u4F1A\u81EA\u52A8\u6210\u4E3A\u5B50\u6A21\u5757\u3002\u65B0\u5EFA\u6A21\u5757\u65F6\u4F1A\u540C\u6B65\u521B\u5EFA\u540C\u540D\u6587\u4EF6\u5939\u3002"
    );
    new Setting(containerEl).setName("\u7BA1\u7406\u6A21\u5757").setDesc("\u65B0\u5EFA\u3001\u7F16\u8F91\u3001\u5220\u9664\u6A21\u5757\uFF0C\u6216\u67E5\u770B\u6A21\u5757\u5BF9\u5E94\u7684\u6587\u4EF6\u6811\u5C42\u7EA7\u3002").addButton(
      (button) => button.setButtonText("\u6253\u5F00\u6A21\u5757\u7BA1\u7406").onClick(() => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.openModuleManager) {
          leaf.view.openModuleManager();
        } else {
          new Notice("\u8BF7\u5148\u6253\u5F00 Noval \u5DE5\u4F5C\u53F0\uFF0C\u518D\u7BA1\u7406\u6A21\u5757\u3002");
        }
      })
    );
    new Setting(containerEl).setName("\u6536\u4EF6\u7BB1").setHeading();
    new Setting(containerEl).setName("\u6536\u5F55\u8303\u56F4").setDesc("\u51B3\u5B9A\u6536\u4EF6\u7BB1\u663E\u793A\u54EA\u4E9B\u6587\u4EF6\u3002\u9ED8\u8BA4\u53EA\u663E\u793A\u5E93\u6839\u76EE\u5F55\u4E2D\u6563\u843D\u7684\u6587\u4EF6\u3002").addDropdown(
      (dropdown) => dropdown.addOption("root", "\u4EC5\u5E93\u6839\u76EE\u5F55\uFF08\u63A8\u8350\uFF09").addOption("unassigned", "\u65E7\u7248\u672A\u5F52\u5C5E\u7B14\u8BB0\uFF08\u517C\u5BB9\uFF09").addOption("all", "\u5168\u5E93\u6240\u6709\u6587\u4EF6\uFF08\u8C28\u614E\uFF09").setValue(this.plugin.settings.inboxPolicy || "root").onChange(async (value) => {
        this.plugin.settings.inboxPolicy = value;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("p", {
      cls: "cl-settings-hint",
      text: "\u6587\u4EF6\u79FB\u5165\u6A21\u5757\u6587\u4EF6\u5939\u540E\u4F1A\u81EA\u52A8\u79BB\u5F00\u6536\u4EF6\u7BB1\u3002\u8BE5\u7B56\u7565\u4FDD\u7559\u4E3A\u53EF\u5207\u6362\u63A5\u53E3\uFF0C\u540E\u7EED\u89C4\u5219\u53EF\u4EE5\u7EE7\u7EED\u6269\u5C55\u3002"
    });
    new Setting(containerEl).setName("\u5361\u7247\u7B14\u8BB0").setHeading();
    new Setting(containerEl).setName("\u5361\u7247\u5B58\u653E\u4F4D\u7F6E").setDesc(
      "\u6240\u6709\u5361\u7247\u548C\u4ECE\u753B\u5E03\u8F6C\u6362\u7684\u5361\u7247\u90FD\u5199\u5165\u8FD9\u4E2A\u6587\u4EF6\u5939\u3002\u56FA\u5B9A\u8DEF\u5F84\u53EF\u4EE5\u907F\u514D\u5361\u7247\u6563\u843D\u3001\u88AB\u7B97\u8FDB\u6A21\u5757\uFF0C\u6216\u5728\u4E0D\u540C\u8BBE\u5907\u4E0A\u5206\u6210\u4E24\u5904\u3002"
    ).addText((text) => text.setValue(CARD_FOLDER).setDisabled(true));
    containerEl.createEl("p", {
      cls: "cl-settings-hint",
      text: "\u8BE5\u76EE\u5F55\u4E0D\u4F1A\u51FA\u73B0\u5728\u6A21\u5757\u5BFC\u822A\u91CC\uFF0C\u4E5F\u4E0D\u4F1A\u8FDB\u5165\u6536\u4EF6\u7BB1\u3002\u628A\u5361\u7247\u6587\u4EF6\u79FB\u51FA\u8FD9\u4E2A\u76EE\u5F55\uFF0C\u5B83\u5C31\u4F1A\u53D8\u6210\u666E\u901A\u7B14\u8BB0\u3002"
    });
    renderNotesAiSettings(containerEl, this.plugin);
    new Setting(containerEl).setName("\u753B\u5E03").setHeading();
    const board = this.plugin.childPlugins && this.plugin.childPlugins[BOARD_ID];
    if (!board) {
      containerEl.createEl("p", {
        cls: "cl-settings-hint",
        text: "\u753B\u5E03\u7EC4\u4EF6\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E\u753B\u5E03\u548C AI\u3002\u8BF7\u91CD\u8F7D\u63D2\u4EF6\u540E\u518D\u8BD5\u3002"
      });
      return;
    }
    let boardFolderTimer = null;
    new Setting(containerEl).setName("\u753B\u5E03\u6587\u4EF6\u5939").setDesc("\u65B0\u5EFA\u753B\u5E03\u65F6\u4FDD\u5B58\u5230\u8FD9\u4E2A\u6587\u4EF6\u5939\uFF0C\u9ED8\u8BA4\u300C\u753B\u5E03\u300D\u3002\u4FEE\u6539\u540E\u8BE5\u6587\u4EF6\u5939\u4E0D\u4F1A\u4F5C\u4E3A\u6A21\u5757\u51FA\u73B0\u3002").addText(
      (text) => text.setPlaceholder("\u753B\u5E03").setValue(board.settings.noval && board.settings.noval.boardFolder || "").onChange((value) => {
        if (boardFolderTimer) window.clearTimeout(boardFolderTimer);
        boardFolderTimer = window.setTimeout(async () => {
          board.settings.noval = board.settings.noval || {};
          board.settings.noval.boardFolder = value.trim();
          await board.saveSettings();
          if (this.plugin.syncModulesFromVault()) {
            await this.plugin.persistSettings();
          }
          this.plugin.refreshAll();
        }, 600);
      })
    );
    new Setting(containerEl).setName("\u8282\u70B9\u89D2\u6807").setDesc("\u5728\u753B\u5E03\u5361\u7247\u8282\u70B9\u4E0A\u663E\u793A\u65E5\u671F\u89D2\u6807\uFF0C\u53EA\u5F71\u54CD\u753B\u5E03\u663E\u793A\uFF0C\u4E0D\u6539\u52A8\u5361\u7247\u6B63\u6587\u3002").addToggle(
      (toggle) => toggle.setValue(!!board.settings.showBadge).onChange(async (value) => {
        board.settings.showBadge = value;
        await board.saveSettings();
      })
    );
    new Setting(containerEl).setName("\u89D2\u6807\u5185\u5BB9").setDesc("\u7CBE\u7B80\u53EA\u663E\u793A\u65E5\u671F\uFF1B\u5B8C\u6574\u663E\u793A\u6807\u7B7E\u3001\u65E5\u671F\u548C\u65F6\u95F4\u3002").addDropdown(
      (dropdown) => dropdown.addOption("date", "\u7CBE\u7B80\uFF0811-11\uFF09").addOption("full", "\u5B8C\u6574\uFF08#\u6807\u7B7E 11-11 11:08\uFF09").setValue(board.settings.badgeFormat === "full" ? "full" : "date").onChange(async (value) => {
        board.settings.badgeFormat = value === "full" ? "full" : "date";
        await board.saveSettings();
      })
    );
    const boardTab = board._settingTab;
    if (boardTab && typeof boardTab.renderAI === "function") {
      boardTab.renderAI(containerEl);
    } else {
      containerEl.createEl("p", {
        cls: "cl-settings-hint",
        text: "AI \u8BBE\u7F6E\u754C\u9762\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u8F7D\u63D2\u4EF6\u540E\u518D\u8BD5\u3002"
      });
    }
  }
};
module.exports = class NovalPlugin extends Plugin {
  async onload() {
    const saved = await this.readHostData();
    const firstRun = !saved || !Array.isArray(saved.modules);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    let settingsDirty = false;
    if (!Array.isArray(this.settings.modules)) {
      this.settings.modules = [];
    } else {
      this.settings.modules = this.settings.modules.map((mod) => {
        const base = DEFAULT_MODULES.find((d) => d.id === mod.id);
        const merged = Object.assign({}, base || {}, mod);
        if (!merged.folder) merged.folder = sanitizeFolderName(merged.name);
        return merged;
      });
      const kept = this.settings.modules.filter(
        (mod) => !(String(mod.id || "").startsWith("dir:") && isToolFolder(mod.folder))
      );
      if (kept.length !== this.settings.modules.length) {
        this.settings.modules = kept;
        settingsDirty = true;
      }
      // 同一文件夹只留一条，用户配置的（非 dir:）优先，自动同步的 dir: 让位
      const ordered2 = this.settings.modules.slice().sort((a, b) => {
        const aa = String(a.id || "").startsWith("dir:") ? 1 : 0;
        const bb = String(b.id || "").startsWith("dir:") ? 1 : 0;
        return aa - bb;
      });
      const seenFolders = /* @__PURE__ */ new Set();
      const deduped = ordered2.filter((mod) => {
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
    if (this.syncModulesFromVault()) settingsDirty = true;
    if (firstRun && !this.settings.modules.length) {
      this.settings.modules = DEFAULT_MODULES;
      settingsDirty = true;
    }
    if (settingsDirty) await this.persistSettings();
    this.requestRefresh = debounce(() => this.refreshAll(), 700, true);
    this.registerView(VIEW_TYPE, (leaf) => new NovalView(leaf, this));
    if (PLUGIN_ICON_SVG) addIcon(PLUGIN_ICON_ID, PLUGIN_ICON_SVG);
    this.addRibbonIcon(PLUGIN_ICON_ID, "\u6253\u5F00 Noval", () => this.activateView());
    this.addCommand({
      id: "open-noval",
      name: "\u6253\u5F00 Noval",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "open-noval-focus",
      name: "\u6253\u5F00 Noval\uFF08\u4E13\u6CE8\u6A21\u5F0F\uFF09",
      callback: () => this.activateView(true)
    });
    this.addCommand({
      id: "toggle-noval-focus",
      name: "\u5207\u6362 Noval \u4E13\u6CE8\u6A21\u5F0F",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.setFocus) {
          leaf.view.setFocus(!leaf.view.focus);
        }
      }
    });
    this.addCommand({
      id: "toggle-noval-nav",
      name: "\u5207\u6362 Noval \u4FA7\u680F",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.setNavCollapsed) {
          leaf.view.setNavCollapsed(!leaf.view.navCollapsed);
        }
      }
    });
    this.addCommand({
      id: "open-noval-notes",
      name: "\u6253\u5F00\u5361\u7247\u7B14\u8BB0",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.go) leaf.view.go("notes");
      }
    });
    this.addCommand({
      id: "quick-capture",
      name: "\u5FEB\u901F\u8BB0\u4E00\u6761\uFF08Noval\uFF09",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.quickCapture) leaf.view.quickCapture();
      }
    });
    this.addCommand({
      id: "open-canvas-gallery",
      name: "\u6253\u5F00 Noval \u753B\u5E03\u96C6",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view && leaf.view.go) leaf.view.go("canvas");
      }
    });
    this.addCommand({
      id: "global-search",
      name: "\u5168\u5C40\u641C\u7D22",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && leaf.view) openGlobalSearch(leaf.view);
      }
    });
    this.addSettingTab(new NovalSettingTab(this.app, this));
    await this.loadBundledPlugins();
    if (this.syncModulesFromVault()) await this.persistSettings();
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
    this.app.workspace.onLayoutReady(() => this.closeLegacyViews());
    this.app.workspace.onLayoutReady(() => this.migrateBoardExtension());
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncNovalSidebarState())
    );
    this.app.workspace.onLayoutReady(() => this.restoreNovalSidebar());
    this.registerEvent(this.app.vault.on("modify", () => this.requestRefresh()));
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.requestRefresh();
        // 文件树里新建文件夹 = 新建模块，立刻同步进导航，不用切页
        if (!file || !Array.isArray(file.children)) return;
        const path = String(file.path || "");
        if (!path) return;
        const hidden = this.settings.hiddenModuleFolders || [];
        if (hidden.includes(path)) {
          this.settings.hiddenModuleFolders = hidden.filter((item) => item !== path);
        }
        // 根目录文件夹各自是一个模块；子文件夹由所属模块按文件树展开
        if (path.indexOf("/") === -1) {
          if (this.syncModulesFromVault()) this.persistSettings();
        }
        this.refreshNavs();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.dropOwnership(file.path);
        if (file && Array.isArray(file.children)) {
          // 文件夹没了，指向它的模块条目也一起去掉
          if (this.pruneMissingModules()) this.persistSettings();
          this.refreshNavs();
        }
        this.requestRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.remapOwnership(oldPath, file.path);
        this.remapModuleFolder(oldPath, file.path);
        // 文件夹改名 = 模块改名，导航上的名字要立刻跟上
        if (file && Array.isArray(file.children)) this.refreshNavs();
        this.requestRefresh();
      })
    );
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.requestRefresh()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const type = leaf && leaf.view ? leaf.view.getViewType() : null;
        if (type === VIEW_TYPE) {
          if (leaf.view.focus) document.body.classList.add("noval-focus");
        } else {
          document.body.classList.remove("noval-focus");
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
    const modules = this.settings && this.settings.modules || [];
    if (!oldPath || !newPath || oldPath === newPath) return;
    const oldBase = oldPath.split("/").pop();
    const newBase = newPath.split("/").pop();
    let changed = false;
    for (const mod of modules) {
      const folder = String(mod.folder || "");
      if (!folder) continue;
      if (folder === oldPath) {
        mod.folder = newPath;
        // 模块名就是文件夹名：在文件树里改名，导航上的名字跟着改（自己改过的不动）
        if (String(mod.name || "") === oldBase) mod.name = newBase;
        changed = true;
      } else if (folder.indexOf(oldPath + "/") === 0) {
        mod.folder = newPath + folder.slice(oldPath.length);
        changed = true;
      }
    }
    const hidden = this.settings && this.settings.hiddenModuleFolders || [];
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
    document.body.classList.remove("noval-focus");
    this.unloadBundledPlugins();
  }
  // 处理更名前留在工作区里的旧标签页。
  // 注意：qm-cards-view 现在是内置 Noval 的正式右侧栏，不能再当旧视图清掉，
  // 否则每次启动都会把上次开着的卡片笔记关掉。
  closeLegacyViews() {
    const remap = { "collis-view": VIEW_TYPE, "collis-gallery": "noval-gallery" };
    const drop = new Set(LEGACY.viewTypes.concat(["volis-board", "volis-workbench"]));
    const leaves = [];
    try {
      this.app.workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
    } catch (error) {
      leaves.length = 0;
    }
    for (const leaf of leaves) {
      let type = "";
      try {
        type = leaf.view && typeof leaf.view.getViewType === "function" && leaf.view.getViewType() || typeof leaf.getViewState === "function" && leaf.getViewState().type || "";
      } catch (error) {
        type = "";
      }
      if (remap[type]) {
        try {
          leaf.setViewState({ type: remap[type], active: false });
          continue;
        } catch (error) {
          console.error("[noval] \u8FC1\u79FB\u65E7\u89C6\u56FE\u5931\u8D25: " + type, error);
        }
      }
      if (drop.has(type)) {
        try {
          leaf.detach();
        } catch (error) {
          console.error("[noval] \u5173\u95ED\u65E7\u89C6\u56FE\u5931\u8D25: " + type, error);
        }
      }
    }
    for (const type of drop) {
      try {
        this.app.workspace.detachLeavesOfType(type);
      } catch (error) {
        console.error("[noval] \u6E05\u7406\u65E7\u89C6\u56FE\u5931\u8D25: " + type, error);
      }
    }
  }
  /* 卡片笔记右侧栏的启动恢复。
   * Obsidian 本身会保存工作区布局，但自定义视图注册较晚时可能被丢掉，
   * 所以这里再用一个布尔标记兜底：上次开着就恢复，上次关了就不动。 */
  restoreNovalSidebar() {
    this._novalLayoutReady = true;
    const leaves = this.app.workspace.getLeavesOfType(QM_VIEW_TYPE);
    if (leaves.length) {
      if (!this.settings.novalSidebarOpen) {
        this.settings.novalSidebarOpen = true;
        this.persistSettings();
      }
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    if (!this.settings.novalSidebarOpen) return;
    this.openNovalSidebar();
  }
  syncNovalSidebarState() {
    if (!this._novalLayoutReady) return;
    const open = this.app.workspace.getLeavesOfType(QM_VIEW_TYPE).length > 0;
    if (open === !!this.settings.novalSidebarOpen) return;
    this.settings.novalSidebarOpen = open;
    this.persistSettings();
  }
  openNovalSidebar() {
    try {
      if (this.app.commands.executeCommandById(NOTES_ID + ":open-cards")) return;
    } catch (error) {
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    leaf.setViewState({ type: QM_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /* 一次性迁移：插件更名为 Noval 后，白板后缀从 .volis 改成 .noval。
   * 只改扩展名，不碰文件内容；目标同名文件已存在时跳过，避免覆盖。 */
  async migrateBoardExtension() {
    const oldExt = LEGACY.boardExt.map((ext) => "." + ext);
    const legacy = this.app.vault.getFiles().filter((file) => oldExt.includes("." + file.extension.toLowerCase()));
    if (!legacy.length) return;
    let moved = 0;
    let skipped = 0;
    for (const file of legacy) {
      const next = file.path.slice(0, file.path.length - file.extension.length) + BOARD_EXT;
      if (this.app.vault.getAbstractFileByPath(next)) {
        skipped += 1;
        continue;
      }
      try {
        await this.app.fileManager.renameFile(file, next);
        moved += 1;
      } catch (error) {
        skipped += 1;
        console.error("[noval] \u767D\u677F\u540E\u7F00\u8FC1\u79FB\u5931\u8D25: " + file.path, error);
      }
    }
    if (moved) {
      new Notice("\u5DF2\u628A " + moved + " \u5F20\u767D\u677F\u7684\u6269\u5C55\u540D\u66F4\u65B0\u4E3A .noval");
    }
    if (skipped) {
      console.warn("[noval] \u6709 " + skipped + " \u5F20\u767D\u677F\u672A\u80FD\u8FC1\u79FB\uFF0C\u8BF7\u68C0\u67E5\u540C\u540D\u6587\u4EF6");
    }
  }
  async readHostData() {
    if (!this.hostData) {
      const raw = await this.loadData() || {};
      this.hostData = raw;
      if (this.migrateLegacyKeys(raw)) await this.writeHostData();
    }
    return this.hostData;
  }
  // 把旧键原样搬到新键（不复制内容，只换键名），旧键删掉。
  migrateLegacyKeys(data) {
    let changed = false;
    const move = (from, to) => {
      if (from === to || data[from] === void 0) return;
      if (data[to] === void 0) data[to] = data[from];
      delete data[from];
      changed = true;
    };
    move(LEGACY.notesId, NOTES_ID);
    move(LEGACY.boardId, BOARD_ID);
    move(LEGACY.sidebarKey, "novalSidebarOpen");
    return changed;
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
  // 第一次启动时搬进 noval/data.json，搬完后那些文件夹可以随时删掉。
  async migrateLegacySettings() {
    const data = await this.readHostData();
    let dirty = false;
    if (!data[BOARD_ID] && data.volis) {
      data[BOARD_ID] = data.volis;
      delete data.volis;
      dirty = true;
    }
    for (const [id, legacyId] of [
      [NOTES_ID, LEGACY.notesId],
      [BOARD_ID, LEGACY.boardId]
    ]) {
      if (data[id]) continue;
      for (const dir of [id, legacyId]) {
        try {
          const raw = await this.app.vault.adapter.read(
            this.app.vault.configDir + "/plugins/" + dir + "/data.json"
          );
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            data[id] = parsed;
            dirty = true;
            break;
          }
        } catch (error) {
        }
      }
    }
    if (dirty) await this.writeHostData();
  }
  isStandaloneEnabled(id) {
    try {
      if (id === this.manifest.id) return false;
      const plugins = this.app.plugins && this.app.plugins.plugins;
      return !!(plugins && plugins[id] && plugins[id] !== this);
    } catch (error) {
      return false;
    }
  }
  // 子插件的读写重定向到 noval 的 data.json，键名分别是 noval / noval-board。
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
      console.log("[noval] \u72EC\u7ACB\u63D2\u4EF6\u5DF2\u542F\u7528\uFF0C\u8DF3\u8FC7\u5185\u7F6E " + spec.id);
      return;
    }
    try {
      const PluginClass = resolvePluginClass(spec.bundle, spec.className);
      if (typeof PluginClass !== "function") {
        throw new Error("\u672A\u627E\u5230\u53EF\u7528\u7684\u63D2\u4EF6\u7C7B");
      }
      const manifest = Object.assign({}, spec.manifest);
      manifest.dir = this.manifest.dir || this.app.vault.configDir + "/plugins/noval";
      const child = new PluginClass(this.app, manifest);
      this.attachChildSettings(child, spec.id);
      const noElement = () => document.createElement("div");
      child.addRibbonIcon = noElement;
      child.addStatusBarItem = noElement;
      child.addSettingTab = (tab) => {
        child._settingTab = tab;
      };
      child._loaded = true;
      this.bundled.push(child);
      // AI 打标签模块由宿主注入给卡片子插件：侧栏视图（CardsView）通过 plugin.aiTag 取用，
      // 内核不用去 require src 层文件，vendor 仍可单独读。
      if (spec.id === NOTES_ID) child.aiTag = NovalAiTag;
      await child.onload();
      this.childPlugins = this.childPlugins || {};
      this.childPlugins[spec.id] = child;
      console.log("[noval] \u5DF2\u52A0\u8F7D\u5185\u7F6E\u63D2\u4EF6 " + manifest.id);
    } catch (error) {
      console.error("[noval] \u5185\u7F6E\u63D2\u4EF6\u542F\u52A8\u5931\u8D25: " + spec.id, error);
      new Notice("Noval\uFF1A\u5185\u7F6E " + spec.id + " \u542F\u52A8\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
    }
  }
  unloadBundledPlugins() {
    const list = this.bundled || [];
    this.bundled = [];
    for (const child of list) {
      try {
        child.unload();
      } catch (error) {
        console.error("[noval] \u5185\u7F6E\u63D2\u4EF6\u5378\u8F7D\u5931\u8D25", error);
      }
    }
  }
  /* 画布文件夹路径：跟随画布子插件的设置，未加载时按默认「画布」。 */
  canvasFolderPath() {
    const board = this.childPlugins && this.childPlugins[BOARD_ID];
    const folder = String(board && board.novalFolder || "\u753B\u5E03").replace(/^\/+|\/+$/g, "");
    return folder || "\u753B\u5E03";
  }
  /* 按文件树顺序重排模块配置：
   *   - 同一层级按文件夹在文件树里的先后排，子模块紧跟父模块；
   *   - 文件树里找不到的模块排在同级最后，保持原有相对顺序。 */
  orderModulesByFileTree(list) {
    const mods = Array.isArray(list) ? list.slice() : [];
    if (mods.length < 2) return mods;
    const cache = /* @__PURE__ */ new Map();
    const entries = mods.map((mod, index) => {
      const dir = moduleFolderOf(mod);
      return { mod, index, rank: dir ? vaultNodeRank(this.app, dir, cache) : null };
    });
    entries.sort((a, b) => {
      if (a.rank && b.rank) {
        const len = Math.max(a.rank.length, b.rank.length);
        for (let i = 0; i < len; i += 1) {
          if (a.rank[i] === void 0) return -1;
          if (b.rank[i] === void 0) return 1;
          if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
        }
        return a.index - b.index;
      }
      if (a.rank) return -1;
      if (b.rank) return 1;
      return a.index - b.index;
    });
    return entries.map((entry) => entry.mod);
  }
  /* 启动同步：把库根目录下已有的文件夹同步成模块入口。
   * 只跳过工具/AI/构建目录（vault-scripts、node_modules、.claude …）和画布目录；
   * 附件、媒体文件等普通文件夹同样同步。子文件夹由模块页按文件树自动生成，
   * 用户手动删除的模块记录在 hiddenModuleFolders 里，不会被重新加回。
   * 同步出来的模块顺序与文件树一致。 */
  syncModulesFromVault() {
    const root = this.app.vault.getRoot && this.app.vault.getRoot();
    if (!root || !Array.isArray(root.children)) return false;
    const normalize = (value) => String(value || "").replace(/^\/+|\/+$/g, "");
    const keyOf = (value) => normalize(value).toLowerCase();
    const canvasKey = keyOf(this.canvasFolderPath());
    const beforeCount = (this.settings.modules || []).length;
    this.settings.modules = (this.settings.modules || []).filter(
      (mod) => keyOf(mod.folder) !== canvasKey
    );
    let changed = this.settings.modules.length !== beforeCount;
    // 同一文件夹只留一条：用户配置的（非 dir:）优先，自动同步的 dir: 让位。
    // 新建模块时，文件夹的 create 事件可能抢先把 dir: 条目补进配置，
    // 不在这里去重，导航里就会出现两个同名模块（文件树只有一个文件夹）。
    const byFolder = /* @__PURE__ */ new Map();
    const deduped = [];
    this.settings.modules.forEach((mod) => {
      const key = keyOf(mod.folder);
      if (!key) {
        deduped.push(mod);
        return;
      }
      const prev = byFolder.get(key);
      if (!prev) {
        byFolder.set(key, mod);
        deduped.push(mod);
        return;
      }
      const prevAuto = String(prev.id || "").startsWith("dir:");
      const curAuto = String(mod.id || "").startsWith("dir:");
      if (prevAuto && !curAuto) {
        deduped[deduped.indexOf(prev)] = mod;
        byFolder.set(key, mod);
      }
      changed = true;
    });
    this.settings.modules = deduped;
    const hidden = new Set((this.settings.hiddenModuleFolders || []).map(keyOf));
    const configured = new Set(
      (this.settings.modules || []).map((mod) => keyOf(mod.folder)).filter(Boolean)
    );
    root.children.filter((child) => child && Array.isArray(child.children)).filter((child) => {
      const path = String(child.path || "");
      if (!path || path.split("/").some((part) => part.startsWith("."))) return false;
      if (keyOf(path) === canvasKey) return false;
      return !isToolFolder(path);
    }).forEach((folder) => {
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
    const ordered = this.orderModulesByFileTree(this.settings.modules);
    if (ordered.some((mod, index) => mod !== this.settings.modules[index])) {
      this.settings.modules = ordered;
      changed = true;
    }
    return changed;
  }
  /* 文件树里的文件夹被删掉后，清掉对应的自动模块；
   * 手动创建的模块保留配置，等文件夹恢复后还能继续用。 */
  /* 文件夹被删掉之后，指向它的模块条目一并清掉：文件夹没了，模块也不该留在导航里。
   * 没登记文件夹的内置模块不受影响。 */
  pruneMissingModules() {
    const before = (this.settings.modules || []).length;
    this.settings.modules = (this.settings.modules || []).filter((mod) => {
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
    data.novalSidebarOpen = !!this.settings.novalSidebarOpen;
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
  // 模块列表变了：只让视图重建左侧导航，不整页重绘（会丢画布/卡片面板的状态）
  refreshNavs() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view && typeof leaf.view.refreshNav === "function") leaf.view.refreshNav();
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
