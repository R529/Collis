var { Menu: Menu2, Modal: Modal2, Notice: Notice2, setIcon: setIcon2, TFile, Setting: Setting2 } = require("obsidian");
var SVG_NS = "http://www.w3.org/2000/svg";
var BOARD_EXTENSION = "noval";
var PAD = 7;
var MAX_NODES = 14;
var MAX_CARDS = 6;
var TEXT_CAP = 96;
function anchorMenuBelow2(menu, anchor) {
  const rect = anchor && anchor.getBoundingClientRect && anchor.getBoundingClientRect();
  if (!rect) {
    menu.showAtPosition({ x: 8, y: 8 });
    return;
  }
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
var blockCache = /* @__PURE__ */ new Map();
function clean(text) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1").replace(/[*_`>#~]/g, "").replace(/\s+/g, " ").trim();
}
function cut(text, max = TEXT_CAP) {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max)}\u2026` : value;
}
function baseName(path) {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}
function toneOf(node2) {
  const color = node2.color;
  if (!color) return "";
  return color;
}
async function blockText(app, node2) {
  if (node2.type !== "card") return "";
  const card = node2;
  if (!card.file || !card.blockId) return "";
  const file = app.vault.getAbstractFileByPath(card.file);
  if (!(file instanceof TFile)) return "";
  const key = `${file.path}@${file.stat.mtime}`;
  const cached = blockCache.get(key);
  if (cached !== void 0) return cached;
  let excerpt = "";
  try {
    const content = await app.vault.cachedRead(file);
    const marker = `^${card.blockId}`;
    const lines = content.split(/\r?\n/);
    const at = lines.findIndex((line) => line.includes(marker));
    if (at >= 0) {
      const parts = [lines[at].replace(marker, "")];
      for (let i = at - 1; i >= 0 && parts.length < 4; i--) {
        const line = lines[i];
        if (!line.trim() || /^#{1,6}\s/.test(line) || /^(---|\*\*\*)/.test(line)) break;
        parts.unshift(line);
      }
      excerpt = cut(parts.join(" "), 140);
    }
  } catch {
    excerpt = "";
  }
  if (blockCache.size > 300) blockCache.clear();
  blockCache.set(key, excerpt);
  return excerpt;
}
function labelOf(node2, cardText) {
  if (node2.type === "text") return cut(node2.text ?? "");
  if (node2.type === "file") return cut(baseName(node2.file ?? ""), 40);
  if (node2.type === "card") return cardText || cut(baseName(node2.file ?? ""), 40);
  if (node2.type === "group") return cut(node2.label ?? "", 28);
  return "";
}
function layout(data, labels) {
  const nodes = (data.nodes ?? []).filter(
    (node2) => node2.type !== "group" && Number.isFinite(node2.x) && Number.isFinite(node2.y) && node2.width > 0
  );
  if (!nodes.length) return { nodes: [], edges: [] };
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + (n.height ?? 120)));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const area = 100 - PAD * 2;
  const ratio = spanX / spanY;
  const boxW = ratio >= 1 ? area : area * ratio;
  const boxH = ratio >= 1 ? area / ratio : area;
  const offX = PAD + (area - boxW) / 2;
  const offY = PAD + (area - boxH) / 2;
  const pick = [...nodes].sort((a, b) => b.width * (b.height ?? 120) - a.width * (a.height ?? 120)).slice(0, MAX_NODES);
  const kept = new Set(pick.map((n) => n.id));
  const built = pick.map((n) => ({
    id: n.id,
    box: {
      x: offX + (n.x - minX) / spanX * boxW,
      y: offY + (n.y - minY) / spanY * boxH,
      w: Math.max(n.width / spanX * boxW, 6),
      h: Math.max((n.height ?? 120) / spanY * boxH, 5),
      kind: n.type,
      tone: toneOf(n),
      text: labels.get(n.id) ?? ""
    }
  }));
  const center = new Map(built.map((entry) => [entry.id, entry.box]));
  const mini = built.map((entry) => entry.box).sort((a, b) => a.w * a.h - b.w * b.h);
  const edges = [];
  for (const edge of data.edges ?? []) {
    if (!kept.has(edge.from) || !kept.has(edge.to)) continue;
    const from = center.get(edge.from);
    const to = center.get(edge.to);
    if (!from || !to) continue;
    edges.push({
      x1: from.x + from.w / 2,
      y1: from.y + from.h / 2,
      x2: to.x + to.w / 2,
      y2: to.y + to.h / 2
    });
    if (edges.length >= 24) break;
  }
  return { nodes: mini, edges };
}
function stamp(time) {
  const d = new Date(time);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function isBoardPath(path, folder) {
  if (!path.toLowerCase().endsWith(`.${BOARD_EXTENSION}`)) return false;
  if (!folder) return true;
  const prefix = folder.replace(/^\/+|\/+$/g, "");
  return !prefix || path.startsWith(`${prefix}/`);
}
async function listBoardItems(app, folder) {
  const files = app.vault.getFiles().filter((file) => isBoardPath(file.path, folder)).sort((a, b) => b.stat.mtime - a.stat.mtime);
  const items = [];
  for (const file of files) {
    let nodes = 0;
    let edges = 0;
    let cover = { nodes: [], edges: [] };
    try {
      const data = JSON.parse(await app.vault.read(file));
      nodes = Array.isArray(data.nodes) ? data.nodes.length : 0;
      edges = Array.isArray(data.edges) ? data.edges.length : 0;
      const labels = /* @__PURE__ */ new Map();
      let cards = 0;
      for (const node2 of data.nodes ?? []) {
        if (node2.type === "card") {
          cards += 1;
          labels.set(node2.id, cards <= MAX_CARDS ? await blockText(app, node2) : "");
        } else {
          labels.set(node2.id, labelOf(node2, ""));
        }
      }
      cover = layout(data, labels);
    } catch {
      nodes = 0;
    }
    items.push({
      file,
      title: file.basename,
      nodes,
      edges,
      updated: stamp(file.stat.mtime),
      mtime: file.stat.mtime,
      created: file.stat.ctime,
      cover
    });
  }
  return items;
}
function listSignature(items, sort) {
  return [
    sort,
    ...items.map((item) => `${item.file.path}:${item.mtime}:${item.nodes}:${item.edges}`)
  ].join("|");
}
function novalMark() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("x", "2.5");
  frame.setAttribute("y", "3.5");
  frame.setAttribute("width", "19");
  frame.setAttribute("height", "17");
  frame.setAttribute("rx", "5");
  frame.setAttribute("stroke-dasharray", "3 2.6");
  const stroke = document.createElementNS(SVG_NS, "path");
  stroke.setAttribute("d", "M6 15.5C8.2 10.5 11 10.2 11.8 12.4C12.6 14.6 15.4 14.8 17.6 10.2");
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", "18.6");
  dot.setAttribute("cy", "6.6");
  dot.setAttribute("r", "1.5");
  dot.setAttribute("fill", "currentColor");
  dot.setAttribute("stroke", "none");
  svg.appendChild(frame);
  svg.appendChild(stroke);
  svg.appendChild(dot);
  return svg;
}
function edgeLayer(edges) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "vw-cover-lines");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  for (const edge of edges) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(edge.x1));
    line.setAttribute("y1", String(edge.y1));
    line.setAttribute("x2", String(edge.x2));
    line.setAttribute("y2", String(edge.y2));
    svg.appendChild(line);
  }
  return svg;
}
function applyBox(el, box) {
  el.style.left = `${box.x}%`;
  el.style.top = `${box.y}%`;
  el.style.width = `${box.w}%`;
  el.style.height = `${box.h}%`;
}
function applyTone(el, tone) {
  if (!tone) return;
  if (tone.startsWith("#")) el.style.setProperty("--tn", tone);
  else el.setAttribute("data-tone", tone);
}
/* 画布封面配色：自动按文件夹取色，单张画布可手动覆盖。 */
var BOARD_TINTS = ["olive", "teal", "sand", "violet", "clay", "mist"];
var BOARD_TINT_LABELS = [
  ["olive", "\u6A44\u6984\u7EFF"],
  ["teal", "\u9752\u7EFF"],
  ["sand", "\u6C99\u7C73"],
  ["violet", "\u7D2B\u7070"],
  ["clay", "\u9676\u571F"],
  ["mist", "\u96FE\u84DD"]
];
function boardFolderKey(file) {
  return file && file.parent ? String(file.parent.path || "") : "";
}
function autoBoardTint(folder) {
  const text = String(folder || "\u753B\u5E03");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 100003;
  return BOARD_TINTS[hash % BOARD_TINTS.length];
}
function boardTintFor(file, settings) {
  const map = settings && settings.boardTints || {};
  const picked = map[file ? file.path : ""];
  if (BOARD_TINTS.indexOf(picked) >= 0) return picked;
  return autoBoardTint(boardFolderKey(file));
}
function boardRootFolder(folder) {
  return String(folder || "").replace(/^\/+|\/+$/g, "");
}
function boardGroupOf(file, rootFolder) {
  const root = boardRootFolder(rootFolder);
  const parent = boardFolderKey(file);
  if (!root) return parent;
  if (parent === root) return "";
  if (parent.startsWith(root + "/")) return parent.slice(root.length + 1);
  return parent;
}
function boardGroupBoards(items, rootFolder, extraKeys) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key = boardGroupOf(item.file, rootFolder);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  for (const key of extraKeys || []) {
    if (key && !map.has(key)) map.set(key, []);
  }
  return [...map.entries()].sort((a, b) => {
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return a[0].localeCompare(b[0], "zh");
  }).map(([key, list]) => ({ key, label: key || "\u672A\u5206\u7EC4", items: list }));
}
/** 画布根目录下已有的子文件夹（含嵌套），用于把「新建但还没有画布」的分组也显示出来。 */
function boardFolderGroupKeys(app, rootFolder) {
  const root = boardRootFolder(rootFolder);
  const base = root ? app.vault.getAbstractFileByPath(root) : app.vault.getRoot();
  const out = [];
  if (!base || !Array.isArray(base.children)) return [];
  const walk = (folder, prefix) => {
    for (const child of folder.children) {
      if (!child || !Array.isArray(child.children) || typeof child.extension !== "undefined") continue;
      const key = prefix ? prefix + "/" + child.name : child.name;
      out.push(key);
      walk(child, key);
    }
  };
  walk(base, "");
  return out;
}
function isFavoriteBoard(settings, path) {
  const stars = settings && settings.boardStars || {};
  return stars[path] === true;
}
/** 把画布移到分组文件夹；重名自动加后缀。返回是否真的移动了。 */
async function moveBoardToFolder(app, file, rootFolder, groupKey) {
  const root = boardRootFolder(rootFolder);
  const target = groupKey ? (root ? root + "/" + groupKey : groupKey) : root;
  if (boardFolderKey(file) === target) return false;
  if (target) {
    try {
      await app.vault.createFolder(target);
    } catch (e) {
    }
  }
  const ext = file.extension;
  const base = file.basename;
  let name = base + "." + ext;
  let path = target ? target + "/" + name : name;
  let index = 1;
  while (app.vault.getAbstractFileByPath(path)) {
    name = base + "-" + index + "." + ext;
    path = target ? target + "/" + name : name;
    index += 1;
  }
  await app.fileManager.renameFile(file, path);
  return true;
}
function node(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}
function simpleButton(label, className, onClick) {
  const button = document.createElement("button");
  button.className = className;
  const text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
  button.addEventListener("click", onClick);
  return button;
}
var DeleteBoardsModal = class extends Modal2 {
  constructor(app, names, onConfirm) {
    super(app);
    this.names = names;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const el = this.contentEl;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.classList.add("noval-delete-modal");
    const heading = document.createElement("h2");
    heading.textContent = this.names.length === 1 ? "\u5220\u9664\u8FD9\u5757\u753B\u5E03\uFF1F" : `\u5220\u9664\u8FD9 ${this.names.length} \u5757\u753B\u5E03\uFF1F`;
    const detail = document.createElement("p");
    const shown = this.names.slice(0, 3).join("\u3001");
    detail.textContent = this.names.length > 3 ? `\u4F1A\u79FB\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9\uFF1A${shown} \u7B49 ${this.names.length} \u5757\u3002` : `\u4F1A\u79FB\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9\uFF1A${shown}\u3002`;
    const row = node("div", "vw-modal-actions");
    const cancel = document.createElement("button");
    cancel.className = "vw-ghost";
    cancel.textContent = "\u53D6\u6D88";
    cancel.addEventListener("click", () => this.close());
    const confirm = document.createElement("button");
    confirm.className = "vw-primary vw-danger";
    confirm.textContent = "\u5220\u9664";
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
    row.appendChild(cancel);
    row.appendChild(confirm);
    el.appendChild(heading);
    el.appendChild(detail);
    el.appendChild(row);
  }
  onClose() {
    const el = this.contentEl;
    while (el.firstChild) el.removeChild(el.firstChild);
  }
};
var RenameBoardModal2 = class extends Modal2 {
  constructor(app, initial, onSubmit, heading, confirmText) {
    super(app);
    this.initial = initial;
    this.onSubmit = onSubmit;
    this.heading = heading || "\u91CD\u547D\u540D\u767D\u677F";
    this.confirmText = confirmText || "\u91CD\u547D\u540D";
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
    new Setting2(contentEl).addButton(
      (button) => button.setButtonText(this.confirmText).setCta().onClick(submit)
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NovalGalleryPanel2 = class {
  constructor(app, novalPlugin) {
    this.app = app;
    this.noval = novalPlugin;
    this.root = null;
    this.items = [];
    this.sortMode = "created";
    this.query = "";
    this.filterMode = "all";
    this.groupMode = "folder";
    this.collapsed = /* @__PURE__ */ new Set();
    this.dragPaths = null;
    this.multi = false;
    this.selected = /* @__PURE__ */ new Set();
    this.signature = "";
    this.reloadTimer = null;
    this.watching = false;
    this.vaultRefs = [];
    this.workspaceRefs = [];
  }
  async mount(containerEl) {
    if (this.root) this.destroy();
    this.root = document.createElement("div");
    containerEl.appendChild(this.root);
    try {
      this.renderWall();
    } catch (error) {
      this.reportError("\u7ED8\u5236\u754C\u9762", error);
      return;
    }
    try {
      await this.loadItems();
    } catch (error) {
      this.reportError("\u8BFB\u53D6\u753B\u5E03", error);
    }
    this.watchSources();
  }
  destroy() {
    if (this.reloadTimer !== null) {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    for (const ref of this.workspaceRefs) this.app.workspace.offref(ref);
    this.vaultRefs = [];
    this.workspaceRefs = [];
    this.watching = false;
    this.signature = "";
    if (this.root) {
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
    }
  }
  async refresh() {
    this.signature = "";
    await this.loadItems();
  }
  /** 墙是文件夹的实时镜像：保存、增删、改名、切回前台都会重绘。 */
  watchSources() {
    if (this.watching) return;
    this.watching = true;
    const inFolder = (path) => isBoardPath(path, this.noval.novalFolder);
    this.vaultRefs.push(
      this.app.vault.on("modify", (file) => {
        if (inFolder(file.path)) this.schedule(220);
      })
    );
    this.vaultRefs.push(
      this.app.vault.on("create", (file) => {
        if (inFolder(file.path)) this.schedule(60);
      })
    );
    this.vaultRefs.push(
      this.app.vault.on("delete", (file) => {
        if (inFolder(file.path)) this.schedule(60);
      })
    );
    this.vaultRefs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        if (inFolder(file.path) || inFolder(oldPath)) this.schedule(60);
      })
    );
    this.workspaceRefs.push(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.app.workspace.activeLeaf) this.schedule(0);
      })
    );
  }
  schedule(delay) {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = null;
      void this.loadItems();
    }, delay);
  }
  clearRoot(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  reportError(stage, error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[noval] \u753B\u5E03\u96C6${stage}\u5931\u8D25`, error);
    if (this.root) {
      this.clearRoot(this.root);
      const box = document.createElement("div");
      box.className = "vw-error";
      const title = document.createElement("strong");
      title.textContent = `\u753B\u5E03\u96C6${stage}\u5931\u8D25`;
      const detail = document.createElement("p");
      detail.textContent = message;
      box.appendChild(title);
      box.appendChild(detail);
      this.root.appendChild(box);
    }
    new Notice2(`\u753B\u5E03\u96C6${stage}\u5931\u8D25\uFF1A${message}`);
  }
  async loadItems() {
    let items = [];
    try {
      items = await listBoardItems(this.app, this.noval.novalFolder);
    } catch {
      new Notice2("\u8BFB\u53D6\u753B\u5E03\u5217\u8868\u5931\u8D25");
    }
    items = [...items].sort((a, b) => {
      if (this.sortMode === "name") return a.title.localeCompare(b.title, "zh-CN");
      if (this.sortMode === "modified") return b.mtime - a.mtime;
      return b.created - a.created;
    });
    this.items = items;
    if (listSignature(items, this.sortMode) === this.signature) return;
    this.renderWall();
  }
  renderWall() {
    const root = this.root;
    if (!root) return;
    const scrolled = root.querySelector(".nvg-scroll");
    const scroll = scrolled ? scrolled.scrollTop : 0;
    this.clearRoot(root);
    root.classList.add("cl-root");
    const frame = node("div", "nvg-frame");
    const toolbar = node("div", "nvg-top");
    toolbar.appendChild(this.buildHead());
    frame.appendChild(toolbar);
    const body = node("div", "nvg-scroll");
    const results = node("div", "nvg-results");
    results.appendChild(this.buildResults());
    body.appendChild(results);
    frame.appendChild(body);
    root.appendChild(frame);
    body.scrollTop = scroll;
    this.signature = listSignature(this.items, this.sortMode);
  }
  /** 纯输入只换结果区，输入框保持焦点与光标。 */
  updateResults() {
    const root = this.root;
    if (!root) return;
    const results = root.querySelector(".nvg-results");
    const count = root.querySelector(".nvg-count");
    if (!results) return;
    this.clearRoot(results);
    results.appendChild(this.buildResults());
    const visible = this.visibleItems();
    if (count) {
      count.textContent = visible.length === this.items.length ? `${this.items.length} \u5757` : `${visible.length} / ${this.items.length} \u5757`;
    }
  }
  matchesFilter(item) {
    if (this.filterMode === "favorites") return isFavoriteBoard(this.noval && this.noval.settings, item.file.path);
    if (this.filterMode === "recent") return Date.now() - item.mtime < 7 * 864e5;
    return true;
  }
  visibleItems() {
    const q = this.query.trim().toLocaleLowerCase();
    return this.items.filter((item) => {
      if (!this.matchesFilter(item)) return false;
      if (!q) return true;
      return [item.title, ...item.cover.nodes.map((box) => box.text)].some(
        (text) => text.toLocaleLowerCase().includes(q)
      );
    });
  }
  buildResults() {
    const visible = this.visibleItems();
    const extraKeys = this.filterMode === "all" && !this.query.trim()
      ? boardFolderGroupKeys(this.app, this.noval.novalFolder)
      : [];
    if (!visible.length && !(this.groupMode === "folder" && extraKeys.length)) {
      return this.buildEmpty(this.query.trim().length > 0 || this.filterMode !== "all");
    }
    if (this.groupMode !== "folder") {
      const grid2 = node("div", "nvg-grid");
      for (const item of visible) grid2.appendChild(this.buildCard(item));
      return grid2;
    }
    const wrap = node("div", "nvg-groups");
    for (const group of boardGroupBoards(visible, this.noval.novalFolder, extraKeys)) {
      wrap.appendChild(this.buildGroupSection(group));
    }
    return wrap;
  }
  buildGroupSection(group) {
    const section = node("div", "nvg-group");
    const collapsed = this.collapsed.has(group.key);
    if (collapsed) section.classList.add("is-collapsed");
    if (!group.key) section.classList.add("is-root");
    const head = node("div", "nvg-ghead");
    const chev = node("button", "nvg-chev");
    chev.setAttribute("title", collapsed ? "\u5C55\u5F00\u5206\u7EC4" : "\u6298\u53E0\u5206\u7EC4");
    setIcon2(chev, collapsed ? "chevron-right" : "chevron-down");
    chev.addEventListener("click", () => this.toggleGroup(group.key));
    const icon = node("span", "nvg-folder");
    setIcon2(icon, group.key ? "folder" : "folder-open");
    const name = node("span", "nvg-gname");
    name.textContent = group.label;
    name.addEventListener("click", () => this.toggleGroup(group.key));
    const count2 = node("span", "nvg-gcount");
    count2.textContent = String(group.items.length);
    head.appendChild(chev);
    head.appendChild(icon);
    head.appendChild(name);
    head.appendChild(count2);
    head.appendChild(node("span", "nvg-gline"));
    if (group.key) {
      const add = simpleButton("+ \u65B0\u5EFA\u5230\u6B64\u7EC4", "nvg-ghost nvg-add", () => {
        void this.createBoardIn(group.key);
      });
      add.setAttribute("title", "\u5728\u6B64\u5206\u7EC4\u65B0\u5EFA\u753B\u5E03");
      head.appendChild(add);
      const del = node("button", "nvg-ghost nvg-gdel");
      del.setAttribute("title", "\u5220\u9664\u5206\u7EC4");
      del.setAttribute("aria-label", "\u5220\u9664\u5206\u7EC4");
      setIcon2(del, "trash-2");
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleGroupDeleteConfirm(group, head);
      });
      head.appendChild(del);
    }
    head.addEventListener("dragover", (event) => {
      event.preventDefault();
      head.classList.add("is-drop-target");
    });
    head.addEventListener("dragleave", () => head.classList.remove("is-drop-target"));
    head.addEventListener("drop", (event) => {
      event.preventDefault();
      head.classList.remove("is-drop-target");
      void this.dropIntoGroup(group.key);
    });
    section.appendChild(head);
    if (!collapsed) {
      const grid2 = node("div", "nvg-grid");
      for (const item of group.items) grid2.appendChild(this.buildCard(item));
      section.appendChild(grid2);
    }
    if (!group.key && group.items.length) {
      const hint = node("div", "nvg-roothint");
      hint.textContent = "\u628A\u753B\u5E03\u62D6\u5230\u4E0A\u9762\u7684\u5206\u7EC4\uFF0C\u5373\u53EF\u5F52\u6863\u3002";
      section.appendChild(hint);
    }
    return section;
  }
  toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.updateResults();
  }
  setGroupMode(mode) {
    if (this.groupMode === mode) return;
    this.groupMode = mode;
    this.renderWall();
  }
  setFilter(mode) {
    if (this.filterMode === mode) return;
    this.filterMode = mode;
    this.renderWall();
  }
  async toggleFavorite(item) {
    const settings = this.noval && this.noval.settings;
    if (!settings) return;
    const map = { ...settings.boardStars || {} };
    if (map[item.file.path]) delete map[item.file.path];
    else map[item.file.path] = true;
    settings.boardStars = map;
    await this.noval.saveSettings();
    this.renderWall();
  }
  async createBoardIn(groupKey) {
    const root = boardRootFolder(this.noval.novalFolder);
    const folder = groupKey ? (root ? root + "/" + groupKey : groupKey) : root;
    try {
      await this.noval.createGalleryBoardIn(folder);
      await this.loadItems();
    } catch (error) {
      new Notice2(error instanceof Error ? error.message : "\u65B0\u5EFA\u753B\u5E03\u5931\u8D25");
    }
  }
  async dropIntoGroup(groupKey) {
    const paths = this.dragPaths && this.dragPaths.length ? [...this.dragPaths] : [];
    this.dragPaths = null;
    if (!paths.length) return;
    const files = paths.map((path) => this.app.vault.getAbstractFileByPath(path)).filter(
      (file) => file && file.extension === "noval"
    );
    let moved = 0;
    for (const file of files) {
      try {
        if (await moveBoardToFolder(this.app, file, this.noval.novalFolder, groupKey)) moved += 1;
      } catch (e) {
      }
    }
    if (moved) {
      await this.loadItems();
      new Notice2(`\u5DF2\u79FB\u52A8 ${moved} \u5757\u753B\u5E03`);
    }
  }
  buildEmpty(searching) {
    const empty = node("div", "vw-empty");
    const art = node("div", "vw-empty-art");
    art.appendChild(novalMark());
    const title = node("div", "vw-empty-title");
    title.textContent = searching ? "\u6CA1\u6709\u5339\u914D\u7684\u753B\u5E03" : "\u8FD8\u6CA1\u6709\u753B\u5E03";
    const hint = document.createElement("p");
    hint.className = "vw-empty-hint";
    hint.textContent = searching ? "\u6362\u4E2A\u5173\u952E\u8BCD\u8BD5\u8BD5\uFF0C\u641C\u7D22\u8303\u56F4\u5305\u62EC\u753B\u5E03\u540D\u79F0\u548C\u753B\u5E03\u4E0A\u7684\u6587\u5B57\u3002" : "\u65B0\u5EFA\u7684\u753B\u5E03\u4F1A\u5B58\u8FDB\u300C\u753B\u5E03\u300D\u6587\u4EF6\u5939\uFF0C\u548C\u6587\u4EF6\u6811\u5B8C\u5168\u540C\u6B65\u3002";
    const button = document.createElement("button");
    button.className = "vw-primary is-large";
    if (searching) {
      const label = document.createElement("span");
      label.textContent = this.filterMode !== "all" ? "\u67E5\u770B\u5168\u90E8" : "\u6E05\u9664\u641C\u7D22";
      button.appendChild(label);
      button.addEventListener("click", () => {
        if (this.filterMode !== "all") {
          this.setFilter("all");
          return;
        }
        this.query = "";
        this.renderWall();
        const input = this.root ? this.root.querySelector(".nvg-search-input") : null;
        if (input) input.focus();
      });
    } else {
      const plus = node("span", "vw-ico");
      setIcon2(plus, "plus");
      const label = document.createElement("span");
      label.textContent = "\u65B0\u5EFA\u7B2C\u4E00\u5757\u753B\u5E03";
      button.appendChild(plus);
      button.appendChild(label);
      button.addEventListener("click", () => {
        void this.createBoard();
      });
    }
    empty.appendChild(art);
    empty.appendChild(title);
    empty.appendChild(hint);
    empty.appendChild(button);
    return empty;
  }
  buildHead() {
    const head = node("header", "nvg-head");
    const row1 = node("div", "nvg-row1");
    const titleWrap = node("div", "nvg-titlewrap");
    const h1 = document.createElement("h1");
    h1.textContent = "\u753B\u5E03\u96C6";
    const count = node("span", "nvg-count");
    const visible = this.visibleItems();
    count.textContent = visible.length === this.items.length ? `${this.items.length} \u5757` : `${visible.length} / ${this.items.length} \u5757`;
    titleWrap.appendChild(h1);
    titleWrap.appendChild(count);
    row1.appendChild(titleWrap);
    const actions = node("div", "nvg-actions");
    if (this.multi) {
      const info = node("span", "nvg-multi-count");
      info.textContent = `\u5DF2\u9009 ${this.selected.size} \u5757`;
      actions.appendChild(info);
      actions.appendChild(simpleButton("\u5168\u9009", "nvg-ghost", () => {
        for (const item of this.visibleItems()) this.selected.add(item.file.path);
        this.syncSelectionUI();
      }));
      const remove = simpleButton("\u5220\u9664\u6240\u9009", "nvg-primary nvg-danger", () => {
        const chosen = this.items.filter((item) => this.selected.has(item.file.path));
        this.confirmDelete(chosen, true);
      });
      if (!this.selected.size) remove.disabled = true;
      actions.appendChild(remove);
      actions.appendChild(simpleButton("\u9000\u51FA\u591A\u9009", "nvg-ghost", () => this.setMulti(false)));
      row1.appendChild(actions);
      head.appendChild(row1);
      return head;
    }
    const search = node("label", "nvg-search");
    const glass = node("span", "nvg-ico");
    setIcon2(glass, "search");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "nvg-search-input";
    input.placeholder = "\u641C\u7D22\u753B\u5E03\u6807\u9898\u2026";
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      this.updateResults();
    });
    const kbd = node("kbd", "nvg-kbd");
    kbd.textContent = "\u2318K";
    search.appendChild(glass);
    search.appendChild(input);
    search.appendChild(kbd);
    actions.appendChild(search);
    const createWrap = node("div", "nvg-split");
    const create = document.createElement("button");
    create.className = "nvg-primary nvg-new";
    const plus = node("span", "nvg-ico");
    setIcon2(plus, "plus");
    const createLabel = document.createElement("span");
    createLabel.textContent = "\u65B0\u5EFA\u753B\u5E03";
    create.appendChild(plus);
    create.appendChild(createLabel);
    create.addEventListener("click", () => {
      void this.createBoard();
    });
    const caret = document.createElement("button");
    caret.className = "nvg-primary nvg-caret";
    caret.setAttribute("title", "\u65B0\u5EFA\u5230\u5206\u7EC4");
    caret.textContent = "\u25BE";
    caret.addEventListener("click", (event) => this.showCreateMenu(event));
    createWrap.appendChild(create);
    createWrap.appendChild(caret);
    actions.appendChild(createWrap);
    const more = node("button", "nvg-iconbtn");
    more.setAttribute("title", "\u66F4\u591A\u64CD\u4F5C");
    setIcon2(more, "more-horizontal");
    more.addEventListener("click", (event) => this.showMoreMenu(event));
    actions.appendChild(more);
    row1.appendChild(actions);
    head.appendChild(row1);
    const row2 = node("div", "nvg-row2");
    const seg = node("div", "nvg-seg");
    for (const [key, label] of [["all", "\u5168\u90E8"], ["recent", "\u6700\u8FD1"], ["favorites", "\u6536\u85CF"]]) {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (this.filterMode === key) btn.classList.add("is-on");
      btn.addEventListener("click", () => this.setFilter(key));
      seg.appendChild(btn);
    }
    row2.appendChild(seg);
    row2.appendChild(node("span", "nvg-spacer"));
    row2.appendChild(
      simpleButton(
        this.groupMode === "folder" ? "\u6309\u6587\u4EF6\u5939\u5206\u7EC4" : "\u4E0D\u5206\u7EC4",
        "nvg-ghost" + (this.groupMode === "folder" ? " is-on" : ""),
        () => this.setGroupMode(this.groupMode === "folder" ? "flat" : "folder")
      )
    );
    const sortLabel = this.sortMode === "created" ? "\u6309\u521B\u5EFA\u65F6\u95F4" : this.sortMode === "modified" ? "\u6309\u4FEE\u6539\u65F6\u95F4" : "\u6309\u540D\u79F0";
    row2.appendChild(simpleButton(sortLabel, "nvg-ghost", (event) => this.showSortMenu(event)));
    head.appendChild(row2);
    return head;
  }
  showCreateMenu(event) {
    const menu = new Menu2();
    menu.addItem((mi) => mi.setTitle("\u65B0\u5EFA\u7A7A\u767D\u753B\u5E03").setIcon("plus").onClick(() => {
      void this.createBoard();
    }));
    const groups = boardGroupBoards(this.items, this.noval.novalFolder, boardFolderGroupKeys(this.app, this.noval.novalFolder));
    if (groups.length) {
      menu.addSeparator();
      for (const group of groups) {
        menu.addItem((mi) => mi.setTitle("\u65B0\u5EFA\u5230 " + group.label).setIcon("folder").onClick(() => {
          void this.createBoardIn(group.key);
        }));
      }
    }
    this.placeMenuRight(menu, event);
  }
  showSortMenu(event) {
    const menu = new Menu2();
    const options = [
      ["created", "\u6309\u521B\u5EFA\u65F6\u95F4"],
      ["modified", "\u6309\u4FEE\u6539\u65F6\u95F4"],
      ["name", "\u6309\u540D\u79F0"]
    ];
    for (const [value, label] of options) {
      menu.addItem(
        (item) => item.setTitle(label).setChecked(this.sortMode === value).onClick(() => this.setSort(value))
      );
    }
    anchorMenuBelow2(menu, event.currentTarget ?? event.target);
  }
  /** 顶栏 ⋯ 只放全局动作；排序与多选在第二行各有一处入口，不重复。 */
  showMoreMenu(event) {
    const menu = new Menu2();
    menu.addItem((item) => item.setTitle("\u65B0\u5EFA\u5206\u7EC4\u2026").setIcon("folder-plus").onClick(() => {
      void this.createGroup();
    }));
    menu.addItem((item) => item.setTitle("\u591A\u9009").setIcon("check").onClick(() => this.setMulti(true)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("\u5237\u65B0\u5217\u8868").setIcon("refresh-cw").onClick(() => {
      this.signature = "";
      void this.loadItems();
    }));
    this.placeMenuRight(menu, event);
  }
  /** 贴右侧按钮的菜单右对齐，保证下拉不越出画布集面板。 */
  placeMenuRight(menu, event, gap = 6) {
    const anchor = event.currentTarget ?? event.target;
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) {
      menu.showAtMouseEvent(event);
      return;
    }
    this.placeMenuAtRight(menu, rect, gap);
  }
  placeMenuAtRight(menu, rect, gap = 6) {
    const root = this.root;
    const rootRect = root ? root.getBoundingClientRect() : null;
    const guess = 200;
    menu.showAtPosition({ x: Math.max(rect.right - guess, 8), y: rect.bottom + gap });
    const apply = () => {
      const dom = menu.dom;
      if (!dom) return;
      const w = dom.offsetWidth;
      const h = dom.offsetHeight;
      if (!w) return;
      let left = rect.right - w;
      let top = rect.bottom + gap;
      if (rootRect) {
        left = Math.max(rootRect.left + 8, Math.min(left, rootRect.right - w - 8));
        if (top + h > rootRect.bottom - 8)
          top = Math.max(rootRect.top + 8, rect.top - h - gap);
      }
      dom.style.left = Math.round(left) + "px";
      dom.style.top = Math.round(top) + "px";
    };
    apply();
    window.requestAnimationFrame(apply);
  }
  createGroup() {
    const root = boardRootFolder(this.noval.novalFolder);
    new RenameBoardModal2(this.app, "", (value) => {
      void this.createGroupFolder(root, value);
    }, "\u65B0\u5EFA\u5206\u7EC4", "\u65B0\u5EFA").open();
  }
  async createGroupFolder(root, value) {
    const name = String(value || "").trim().replace(/[\\/:*?"<>|]/g, "").trim();
    if (!name) {
      new Notice2("\u5206\u7EC4\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    const path = root ? root + "/" + name : name;
    try {
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice2("\u540C\u540D\u5206\u7EC4\u5DF2\u5B58\u5728");
        return;
      }
      await this.app.vault.createFolder(path);
      this.groupMode = "folder";
      this.signature = "";
      await this.loadItems();
    } catch (e) {
      new Notice2("\u65B0\u5EFA\u5206\u7EC4\u5931\u8D25\uFF1A" + (e && e.message ? e.message : e));
    }
  }
  toggleGroupDeleteConfirm(group, head) {
    if (!group || !group.key || !head) return;
    const next = head.nextElementSibling;
    if (next && next.classList.contains("nvg-gconfirm")) {
      next.remove();
      return;
    }
    const bar = node("div", "nvg-gconfirm");
    const text = node("span", "nvg-gconfirm-text");
    text.textContent = group.items.length
      ? `删除分组「${group.label}」？组内 ${group.items.length} 块画布将移到未分组。`
      : `删除空分组「${group.label}」？`;
    const cancel = simpleButton("取消", "nvg-ghost", () => bar.remove());
    const ok = simpleButton("删除分组", "nvg-ghost nvg-gdanger", () => {
      bar.remove();
      void this.deleteGroup(group);
    });
    bar.appendChild(text);
    bar.appendChild(cancel);
    bar.appendChild(ok);
    head.insertAdjacentElement("afterend", bar);
  }
  async deleteGroup(group) {
    if (!group || !group.key) return;
    const root = boardRootFolder(this.noval.novalFolder);
    const path = root ? root + "/" + group.key : group.key;
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      new Notice2("分组文件夹不存在");
      return;
    }
    const hasChildFolder = Array.isArray(folder.children) && folder.children.some(
      (child) => child && Array.isArray(child.children) && typeof child.extension === "undefined"
    );
    if (hasChildFolder) {
      new Notice2("该分组下还有子分组，请先删除子分组");
      return;
    }
    const items = [...group.items || []];
    let moved = 0;
    for (const item of items) {
      try {
        if (await moveBoardToFolder(this.app, item.file, this.noval.novalFolder, "")) moved += 1;
      } catch (e) {
      }
    }
    if (moved < items.length) {
      await this.loadItems();
      new Notice2("部分画布移动失败，已取消删除分组");
      return;
    }
    let remaining = [];
    try {
      const listing = await this.app.vault.adapter.list(path);
      remaining = [...listing.files || [], ...listing.folders || []];
    } catch (e) {
    }
    if (remaining.length) {
      await this.loadItems();
      new Notice2("分组文件夹里还有其它文件，已取消删除分组");
      return;
    }
    try {
      await this.app.vault.adapter.rmdir(path, true);
      this.signature = "";
      await this.loadItems();
      new Notice2(moved ? `分组已删除，${moved} 块画布已移到未分组` : "分组已删除");
    } catch (e) {
      new Notice2("删除分组失败：" + (e && e.message ? e.message : e));
    }
  }
  setSort(value) {
    if (this.sortMode === value) return;
    this.sortMode = value;
    void this.loadItems();
  }
  buildCard(item) {
    const card = node("div", "nvg-card");
    card.setAttribute("data-path", item.file.path);
    if (this.multi && this.selected.has(item.file.path)) card.classList.add("is-selected");
    const thumb = node("div", "nvg-thumb");
    thumb.setAttribute("data-tint", boardTintFor(item.file, this.noval && this.noval.settings));
    thumb.appendChild(this.buildCover(item));
    if (this.multi) {
      const check = node("span", "nvg-check");
      setIcon2(check, "check");
      thumb.appendChild(check);
    }
    const acts = node("div", "nvg-acts");
    if (!this.multi) {
      const favorite = isFavoriteBoard(this.noval.settings, item.file.path);
      const star = node("button", "nvg-star" + (favorite ? " is-on" : ""));
      star.setAttribute("title", favorite ? "\u53D6\u6D88\u6536\u85CF" : "\u6536\u85CF");
      setIcon2(star, "star");
      star.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.toggleFavorite(item);
      });
      acts.appendChild(star);
    }
    const more = node("button", "nvg-more");
    more.setAttribute("title", "\u66F4\u591A");
    setIcon2(more, "more-horizontal");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const anchor2 = event.currentTarget ?? event.target;
      const rect2 = anchor2?.getBoundingClientRect?.();
      const menu = new Menu2();
      menu.addItem(
        (mi) => mi.setTitle("\u91CD\u547D\u540D\u2026").setIcon("pencil").onClick(() => this.promptRename(item))
      );
      menu.addItem(
        (mi) => mi.setTitle(isFavoriteBoard(this.noval.settings, item.file.path) ? "\u53D6\u6D88\u6536\u85CF" : "\u6536\u85CF").setIcon("star").onClick(() => {
          void this.toggleFavorite(item);
        })
      );
      menu.addItem(
        (mi) => mi.setTitle("\u5C01\u9762\u914D\u8272").setIcon("palette").onClick(() => {
          window.setTimeout(() => this.openTintMenu(rect2, item), 0);
        })
      );
      menu.addSeparator();
      menu.addItem(
        (mi) => mi.setTitle("\u5220\u9664").setIcon("trash-2").onClick(() => this.confirmDelete([item]))
      );
      this.placeMenuRight(menu, event);
    });
    acts.appendChild(more);
    thumb.appendChild(acts);
    card.appendChild(thumb);
    card.draggable = !this.multi;
    card.addEventListener("dragstart", (event) => {
      const paths = this.multi && this.selected.size ? [...this.selected] : [item.file.path];
      this.dragPaths = paths;
      card.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", paths.join("\n"));
      }
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      this.dragPaths = null;
    });
    const body = node("div", "nvg-body");
    const title = node("div", "nvg-title");
    title.textContent = item.title;
    const meta = node("div", "nvg-meta");
    const time = node("span", "nvg-time");
    time.textContent = item.updated;
    meta.appendChild(time);
    const rootFolder = boardRootFolder(this.noval.novalFolder);
    const groupKey = boardGroupOf(item.file, rootFolder);
    if (groupKey) {
      const chip = node("span", "nvg-chip");
      chip.textContent = groupKey.split("/").pop();
      meta.appendChild(chip);
    }
    body.appendChild(title);
    body.appendChild(meta);
    card.appendChild(body);
    card.addEventListener("click", () => {
      if (this.multi) this.toggleSelected(item.file.path);
      else this.openBoard(item);
    });
    return card;
  }
  /** 封面是画布的真实微缩图：同样的布局、颜色和节点文字。 */
  buildCover(item) {
    const cover = node("div", "nvg-cover");
    const { nodes, edges } = item.cover;
    if (!nodes.length) {
      cover.classList.add("is-blank");
      const ghost = node("span", "nvg-cover-ghost");
      ghost.appendChild(novalMark());
      cover.appendChild(ghost);
      return cover;
    }
    if (edges.length) cover.appendChild(edgeLayer(edges));
    for (const box of nodes) {
      const chip = node("span", "vw-chip");
      applyBox(chip, box);
      applyTone(chip, box.tone);
      chip.setAttribute("data-kind", box.kind);
      if (box.text && box.w >= 15 && box.h >= 13) {
        const text = node("span", "vw-chip-text");
        text.textContent = box.text;
        chip.appendChild(text);
      }
      cover.appendChild(chip);
    }
    return cover;
  }
  openTintMenu(rect, item) {
    const map = this.noval && this.noval.settings.boardTints || {};
    const current = map[item.file.path] || "";
    const menu = new Menu2();
    for (const [key, label] of BOARD_TINT_LABELS) {
      menu.addItem(
        (mi) => mi.setTitle(label).setChecked(current === key).onClick(() => {
          void this.setBoardTint(item, key);
        })
      );
    }
    menu.addSeparator();
    menu.addItem(
      (mi) => mi.setTitle("\u81EA\u52A8\uFF08\u8DDF\u968F\u6587\u4EF6\u5939\uFF09").setChecked(!current).onClick(() => {
        void this.setBoardTint(item, "");
      })
    );
    if (rect) this.placeMenuAtRight(menu, rect);
  }
  async setBoardTint(item, key) {
    const settings = this.noval && this.noval.settings;
    if (!settings) return;
    const map = { ...(settings.boardTints || {}) };
    if (key) map[item.file.path] = key;
    else delete map[item.file.path];
    settings.boardTints = map;
    await this.noval.saveSettings();
    this.renderWall();
  }
  openBoard(item) {
    void this.noval.openBoardFile(item.file.path);
  }
  setMulti(on) {
    this.multi = on;
    if (!on) this.selected.clear();
    this.renderWall();
  }
  toggleSelected(path) {
    if (this.selected.has(path)) this.selected.delete(path);
    else this.selected.add(path);
    this.syncSelectionUI();
  }
  /** 选中只改相关属性，整墙重建会让卡片闪烁并吞掉下一次点击。 */
  syncSelectionUI() {
    const root = this.root;
    if (!root) return;
    for (const card of Array.from(root.querySelectorAll("[data-path]"))) {
      const path = card.getAttribute("data-path") ?? "";
      card.classList.toggle("is-selected", this.selected.has(path));
    }
    const count = root.querySelector(".nvg-multi-count");
    if (count) count.textContent = `\u5DF2\u9009 ${this.selected.size} \u5757`;
    const remove = root.querySelector(".nvg-danger");
    if (remove) remove.disabled = this.selected.size === 0;
  }
  confirmDelete(items, exitMulti = false) {
    if (!items.length) return;
    new DeleteBoardsModal(this.app, items.map((item) => item.title), () => {
      void this.deleteBoards(items.map((item) => item.file), exitMulti);
    }).open();
  }
  promptRename(item) {
    new RenameBoardModal2(this.app, item.file.basename, (value) => {
      void this.renameBoardFile(item.file, value);
    }).open();
  }
  async renameBoardFile(file, value) {
    if (!value || value === file.basename) return;
    const folder = file.parent ? file.parent.path : "";
    const nextPath = (folder && folder !== "/" ? folder + "/" : "") + value + "." + (file.extension || BOARD_EXTENSION);
    try {
      await this.app.fileManager.renameFile(file, nextPath);
      await this.loadItems();
    } catch (e) {
      new Notice2("\u91CD\u547D\u540D\u5931\u8D25\uFF1A" + (e && e.message ? e.message : e));
    }
  }
  async deleteBoards(files, exitMulti = false) {
    let removed = 0;
    for (const file of files) {
      try {
        await this.app.fileManager.trashFile(file);
        removed += 1;
      } catch {
        try {
          await this.app.vault.delete(file);
          removed += 1;
        } catch (error) {
          new Notice2(error instanceof Error ? error.message : "\u5220\u9664\u753B\u5E03\u5931\u8D25");
        }
      }
    }
    for (const file of files) this.selected.delete(file.path);
    if (exitMulti && removed > 0) {
      this.multi = false;
      this.selected.clear();
      this.signature = "";
    }
    await this.loadItems();
  }
  async createBoard() {
    try {
      await this.noval.createGalleryBoard();
      await this.loadItems();
    } catch (error) {
      new Notice2(error instanceof Error ? error.message : "\u65B0\u5EFA\u753B\u5E03\u5931\u8D25");
    }
  }
};
module.exports = { NovalGalleryPanel: NovalGalleryPanel2 };
