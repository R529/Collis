/** 画布集面板：BoardGalleryView 的可嵌入 CommonJS 版本。
 *  只保留渲染与数据逻辑，去掉 ItemView / leaf 生命周期，供 Collis 内嵌显示。 */

const { Menu, Modal, Notice, setIcon, TFile } = require("obsidian");

const SVG_NS = "http://www.w3.org/2000/svg";
const BOARD_EXTENSION = "collis";

const PAD = 7;
const MAX_NODES = 14;
const MAX_CARDS = 6;
const TEXT_CAP = 96;

/** 菜单精确锚定到按钮正下方，紧贴按钮；右侧放不下就右对齐，避免偏出屏幕。 */
function anchorMenuBelow(menu, anchor) {
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

/** 块引用摘录缓存，键为 `path@mtime`。 */
const blockCache = new Map();

function clean(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/[*_`>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(text, max = TEXT_CAP) {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function baseName(path) {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}

/** 十六进制颜色原样保留；具名颜色转成 data-tone 交给主题。 */
function toneOf(node) {
  const color = node.color;
  if (!color) return "";
  return color;
}

async function blockText(app, node) {
  if (node.type !== "card") return "";
  const card = node;
  if (!card.file || !card.blockId) return "";
  const file = app.vault.getAbstractFileByPath(card.file);
  if (!(file instanceof TFile)) return "";
  const key = `${file.path}@${file.stat.mtime}`;
  const cached = blockCache.get(key);
  if (cached !== undefined) return cached;

  let excerpt = "";
  try {
    const content = await app.vault.cachedRead(file);
    const marker = `^${card.blockId}`;
    const lines = content.split(/\r?\n/);
    // 块 id 位于块末尾，向上回溯到块首，列表项或引用才能保留第一行。
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

function labelOf(node, cardText) {
  if (node.type === "text") return cut(node.text ?? "");
  if (node.type === "file") return cut(baseName(node.file ?? ""), 40);
  if (node.type === "card") return cardText || cut(baseName(node.file ?? ""), 40);
  if (node.type === "group") return cut(node.label ?? "", 28);
  return "";
}

/** 把画布节点按原比例摆进 0–100 的方块，让封面成为真实缩略图。 */
function layout(data, labels) {
  const nodes = (data.nodes ?? []).filter(
    (node) =>
      node.type !== "group" &&
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      node.width > 0,
  );
  if (!nodes.length) return { nodes: [], edges: [] };

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + (n.height ?? 120)));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const area = 100 - PAD * 2;
  // 保持缩略图与真实画布接近的宽高比，宽画布就该看起来是宽的。
  const ratio = spanX / spanY;
  const boxW = ratio >= 1 ? area : area * ratio;
  const boxH = ratio >= 1 ? area / ratio : area;
  const offX = PAD + (area - boxW) / 2;
  const offY = PAD + (area - boxH) / 2;

  const pick = [...nodes]
    .sort((a, b) => b.width * (b.height ?? 120) - a.width * (a.height ?? 120))
    .slice(0, MAX_NODES);
  const kept = new Set(pick.map((n) => n.id));

  const built = pick.map((n) => ({
    id: n.id,
    box: {
      x: offX + ((n.x - minX) / spanX) * boxW,
      y: offY + ((n.y - minY) / spanY) * boxH,
      w: Math.max((n.width / spanX) * boxW, 6),
      h: Math.max(((n.height ?? 120) / spanY) * boxH, 5),
      kind: n.type,
      tone: toneOf(n),
      text: labels.get(n.id) ?? "",
    },
  }));
  const center = new Map(built.map((entry) => [entry.id, entry.box]));
  // 小色块先画，避免被大色块盖住。
  const mini = built
    .map((entry) => entry.box)
    .sort((a, b) => a.w * a.h - b.w * b.h);

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
      y2: to.y + to.h / 2,
    });
    if (edges.length >= 24) break;
  }

  return { nodes: mini, edges };
}

function stamp(time) {
  const d = new Date(time);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
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
  const files = app.vault
    .getFiles()
    .filter((file) => isBoardPath(file.path, folder))
    .sort((a, b) => b.stat.mtime - a.stat.mtime);

  const items = [];
  for (const file of files) {
    let nodes = 0;
    let edges = 0;
    let cover = { nodes: [], edges: [] };
    try {
      const data = JSON.parse(await app.vault.read(file));
      nodes = Array.isArray(data.nodes) ? data.nodes.length : 0;
      edges = Array.isArray(data.edges) ? data.edges.length : 0;

      const labels = new Map();
      let cards = 0;
      for (const node of data.nodes ?? []) {
        if (node.type === "card") {
          cards += 1;
          labels.set(node.id, cards <= MAX_CARDS ? await blockText(app, node) : "");
        } else {
          labels.set(node.id, labelOf(node, ""));
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
      cover,
    });
  }
  return items;
}

/** 列表的廉价指纹，用于跳过无意义的重绘。 */
function listSignature(items, sort) {
  return [
    sort,
    ...items.map((item) => `${item.file.path}:${item.mtime}:${item.nodes}:${item.edges}`),
  ].join("|");
}

/** Collis 标记，与 ribbon 图标同一几何形状。 */
function collisMark() {
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

/** 原生确认框，删除前必须先过这一步。 */
class DeleteBoardsModal extends Modal {
  constructor(app, names, onConfirm) {
    super(app);
    this.names = names;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const el = this.contentEl;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.classList.add("collis-delete-modal");
    const heading = document.createElement("h2");
    heading.textContent = this.names.length === 1 ? "删除这块画布？" : `删除这 ${this.names.length} 块画布？`;
    const detail = document.createElement("p");
    const shown = this.names.slice(0, 3).join("、");
    detail.textContent = this.names.length > 3
      ? `会移到系统回收站：${shown} 等 ${this.names.length} 块。`
      : `会移到系统回收站：${shown}。`;
    const row = node("div", "vw-modal-actions");
    const cancel = document.createElement("button");
    cancel.className = "vw-ghost";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => this.close());
    const confirm = document.createElement("button");
    confirm.className = "vw-primary vw-danger";
    confirm.textContent = "删除";
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
}

class CollisGalleryPanel {
  constructor(app, collisPlugin) {
    this.app = app;
    this.collis = collisPlugin;
    this.root = null;
    this.items = [];
    this.sortMode = "created";
    this.query = "";
    this.multi = false;
    this.selected = new Set();
    /** 重绘簿记：墙会监听 vault，隐藏时也可能重绘，只有真实变化才动 DOM。 */
    this.signature = "";
    this.reloadTimer = null;
    this.watching = false;
    this.vaultRefs = [];
    this.workspaceRefs = [];
  }

  async mount(containerEl) {
    // 重复挂载前先清掉上一次的 DOM 与监听。
    if (this.root) this.destroy();
    this.root = document.createElement("div");
    containerEl.appendChild(this.root);

    try {
      this.renderWall();
    } catch (error) {
      this.reportError("绘制界面", error);
      return;
    }

    try {
      await this.loadItems();
    } catch (error) {
      this.reportError("读取画布", error);
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
    // 清掉指纹强制重绘一次，搜索词/排序/多选/滚动位置都由原有状态与 renderWall 保留。
    this.signature = "";
    await this.loadItems();
  }

  /** 墙是文件夹的实时镜像：保存、增删、改名、切回前台都会重绘。 */
  watchSources() {
    if (this.watching) return;
    this.watching = true;
    const inFolder = (path) => isBoardPath(path, this.collis.collisFolder);

    this.vaultRefs.push(
      this.app.vault.on("modify", (file) => {
        if (inFolder(file.path)) this.schedule(220);
      }),
    );
    this.vaultRefs.push(
      this.app.vault.on("create", (file) => {
        if (inFolder(file.path)) this.schedule(60);
      }),
    );
    this.vaultRefs.push(
      this.app.vault.on("delete", (file) => {
        if (inFolder(file.path)) this.schedule(60);
      }),
    );
    this.vaultRefs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        if (inFolder(file.path) || inFolder(oldPath)) this.schedule(60);
      }),
    );
    // 内嵌面板没有自己的 leaf，任何 active-leaf 变化都刷新一次即可。
    this.workspaceRefs.push(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.app.workspace.activeLeaf) this.schedule(0);
      }),
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
    console.error(`[collis] 画布集${stage}失败`, error);
    if (this.root) {
      this.clearRoot(this.root);
      const box = document.createElement("div");
      box.className = "vw-error";
      const title = document.createElement("strong");
      title.textContent = `画布集${stage}失败`;
      const detail = document.createElement("p");
      detail.textContent = message;
      box.appendChild(title);
      box.appendChild(detail);
      this.root.appendChild(box);
    }
    new Notice(`画布集${stage}失败：${message}`);
  }

  async loadItems() {
    let items = [];
    try {
      items = await listBoardItems(this.app, this.collis.collisFolder);
    } catch {
      new Notice("读取画布列表失败");
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
    const scrolled = root.querySelector(".vw-scroll");
    const scroll = scrolled ? scrolled.scrollTop : 0;
    this.clearRoot(root);
    root.classList.add("cl-root");

    // 整个页面（含头部）套一层边框，卡片在内部滚动，外框保持不动。
    const frame = node("div", "vw-frame");
    const toolbar = node("div", "vw-toolbar");
    toolbar.appendChild(this.buildHead());
    frame.appendChild(toolbar);

    const body = node("div", "vw-scroll");
    const results = node("div", "vw-results");
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
    const results = root.querySelector(".vw-results");
    const count = root.querySelector(".vw-count");
    if (!results) return;
    this.clearRoot(results);
    results.appendChild(this.buildResults());
    const visible = this.visibleItems();
    if (count) {
      count.textContent = this.query
        ? `${visible.length} / ${this.items.length} 块`
        : `${this.items.length} 块`;
    }
  }

  visibleItems() {
    const q = this.query.trim().toLocaleLowerCase();
    if (!q) return this.items;
    return this.items.filter((item) =>
      [item.title, ...item.cover.nodes.map((box) => box.text)]
        .some((text) => text.toLocaleLowerCase().includes(q)),
    );
  }

  buildResults() {
    const visible = this.visibleItems();
    if (!visible.length) {
      return this.buildEmpty(this.query.trim().length > 0);
    }
    const grid = node("div", "vw-grid");
    for (const item of visible) grid.appendChild(this.buildCard(item));
    return grid;
  }

  buildEmpty(searching) {
    const empty = node("div", "vw-empty");
    const art = node("div", "vw-empty-art");
    // 与 ribbon 图标、空白封面同一标记，空状态也属于这个插件。
    art.appendChild(collisMark());
    const title = node("div", "vw-empty-title");
    title.textContent = searching ? "没有匹配的画布" : "还没有画布";
    const hint = document.createElement("p");
    hint.className = "vw-empty-hint";
    hint.textContent = searching
      ? "换个关键词试试，搜索范围包括画布名称和画布上的文字。"
      : "新建的画布会存进「画布」文件夹，和文件树完全同步。";

    const button = document.createElement("button");
    button.className = "vw-primary is-large";
    if (searching) {
      const label = document.createElement("span");
      label.textContent = "清除搜索";
      button.appendChild(label);
      button.addEventListener("click", () => {
        this.query = "";
        this.renderWall();
        const input = this.root ? this.root.querySelector(".vw-search-input") : null;
        if (input) input.focus();
      });
    } else {
      const plus = node("span", "vw-ico");
      setIcon(plus, "plus");
      const label = document.createElement("span");
      label.textContent = "新建第一块画布";
      button.appendChild(plus);
      button.appendChild(label);
      button.addEventListener("click", () => { void this.createBoard(); });
    }

    empty.appendChild(art);
    empty.appendChild(title);
    empty.appendChild(hint);
    empty.appendChild(button);
    return empty;
  }

  buildHead() {
    const head = node("div", "vw-head");

    const intro = node("div", "vw-intro");
    const title = node("div", "vw-title");
    const h1 = document.createElement("h1");
    h1.textContent = "画布集";
    const count = node("span", "vw-count");
    const visible = this.visibleItems();
    count.textContent = this.query
      ? `${visible.length} / ${this.items.length} 块`
      : `${this.items.length} 块`;
    title.appendChild(h1);
    title.appendChild(count);
    intro.appendChild(title);
    head.appendChild(intro);

    const actions = node("div", "vw-actions");
    if (this.multi) {
      const info = node("span", "vw-multi-count");
      info.textContent = `已选 ${this.selected.size} 块`;
      actions.appendChild(info);

      actions.appendChild(simpleButton("全选", "vw-ghost", () => {
        for (const item of this.visibleItems()) this.selected.add(item.file.path);
        this.syncSelectionUI();
      }));
      const remove = simpleButton("删除所选", "vw-primary vw-danger", () => {
        const chosen = this.items.filter((item) => this.selected.has(item.file.path));
        // 批量删除结束本次选择：画布没了，要重新点「多选」才能选下一批。
        this.confirmDelete(chosen, true);
      });
      if (!this.selected.size) remove.disabled = true;
      actions.appendChild(remove);
      actions.appendChild(simpleButton("退出多选", "vw-ghost", () => this.setMulti(false)));
      head.appendChild(actions);
      return head;
    }

    const search = node("div", "vw-search");
    const glass = node("span", "vw-ico");
    setIcon(glass, "search");
    const input = document.createElement("input");
    input.type = "search";
    input.className = "vw-search-input";
    input.placeholder = "搜索画布";
    // Obsidian 会给每个 input 加边框和焦点环，这里一次性重置，让输入框只做搜索框里的文字区。
    input.style.cssText =
      "all: unset !important; display: block !important; width: 116px !important;" +
      "padding: 0 !important; border: 0 !important; box-shadow: none !important;" +
      "outline: none !important; background: transparent !important;" +
      "font: inherit !important; font-size: 12px !important; line-height: 1.3 !important;" +
      "color: var(--text-normal) !important; cursor: text !important;";
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      this.updateResults();
    });
    search.appendChild(glass);
    search.appendChild(input);
    actions.appendChild(search);

    const create = document.createElement("button");
    create.className = "vw-primary";
    const plus = node("span", "vw-ico");
    setIcon(plus, "plus");
    const createLabel = document.createElement("span");
    createLabel.textContent = "新建画布";
    create.appendChild(plus);
    create.appendChild(createLabel);
    create.addEventListener("click", () => { void this.createBoard(); });
    actions.appendChild(create);

    const more = node("button", "vw-sort vw-more");
    more.setAttribute("title", "更多操作");
    const moreIcon = node("span", "vw-ico");
    setIcon(moreIcon, "more-horizontal");
    more.appendChild(moreIcon);
    more.addEventListener("click", (event) => this.showMoreMenu(event));
    actions.appendChild(more);

    head.appendChild(actions);
    return head;
  }

  /** 唯一的「...」按钮收纳排序与多选，和文件树顶部菜单一致。 */
  showMoreMenu(event) {
    const menu = new Menu();
    const options = [
      ["created", "按创建时间"],
      ["modified", "按修改时间"],
      ["name", "按名称"],
    ];
    for (const [value, label] of options) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.sortMode === value)
          .onClick(() => this.setSort(value)),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(this.multi ? "退出多选" : "多选")
        .setChecked(this.multi)
        .onClick(() => this.setMulti(!this.multi)),
    );
    // 锚定按钮而非鼠标位置：菜单紧贴「更多」按钮下方，右侧溢出自动右对齐。
    anchorMenuBelow(menu, event.currentTarget ?? event.target);
  }

  setSort(value) {
    if (this.sortMode === value) return;
    this.sortMode = value;
    void this.loadItems();
  }

  buildCard(item) {
    const card = node("div", "vw-card");
    card.setAttribute("data-path", item.file.path);
    if (this.multi && this.selected.has(item.file.path)) card.classList.add("is-selected");
    card.appendChild(this.buildCover(item));

    if (this.multi) {
      const check = node("span", "vw-check");
      setIcon(check, "check");
      card.appendChild(check);
    }

    const del = document.createElement("button");
    del.className = "vw-card-del";
    del.setAttribute("title", "删除画布");
    setIcon(del, "trash-2");
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      this.confirmDelete([item]);
    });
    card.appendChild(del);

    const body = node("div", "vw-card-body");
    const title = node("div", "vw-card-title");
    title.textContent = item.title;
    body.appendChild(title);

    // 元信息沿用模块页卡片：左侧节点数，右侧更新时间，一行放完
    const meta = node("div", "vw-card-meta");
    const count = node("span", "vw-card-count");
    count.textContent = item.nodes ? `${item.nodes} 个节点` : "空白画布";
    const date = node("span", "vw-card-date");
    date.textContent = item.updated;
    meta.appendChild(count);
    meta.appendChild(date);
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
    const cover = node("div", "vw-cover");
    const { nodes, edges } = item.cover;

    if (!nodes.length) {
      cover.classList.add("is-blank");
      const ghost = node("span", "vw-cover-ghost");
      ghost.appendChild(collisMark());
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

  openBoard(item) {
    void this.collis.openBoardFile(item.file.path);
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
    const count = root.querySelector(".vw-multi-count");
    if (count) count.textContent = `已选 ${this.selected.size} 块`;
    const remove = root.querySelector(".vw-danger");
    if (remove) remove.disabled = this.selected.size === 0;
  }

  confirmDelete(items, exitMulti = false) {
    if (!items.length) return;
    new DeleteBoardsModal(this.app, items.map((item) => item.title), () => {
      void this.deleteBoards(items.map((item) => item.file), exitMulti);
    }).open();
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
          new Notice(error instanceof Error ? error.message : "删除画布失败");
        }
      }
    }
    for (const file of files) this.selected.delete(file.path);
    if (exitMulti && removed > 0) {
      // 批量删除后退出多选，再从新列表重建，避免卡片残留选中态。
      this.multi = false;
      this.selected.clear();
      this.signature = "";
    }
    await this.loadItems();
  }

  async createBoard() {
    try {
      await this.collis.createGalleryBoard();
      await this.loadItems();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "新建画布失败");
    }
  }
}

module.exports = { CollisGalleryPanel };
