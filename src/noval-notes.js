var { Notice: Notice2, setIcon: setIcon2, TFile } = require("obsidian");
var NovalBundle2 = require("../vendor/noval-notes-core.js");
var { openTagBar, openTagFix, openBatchTag, openTagHealth } = require("./noval-ai-tag.js");
var ICONS = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  review: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4.3l2.8 1.7"/></svg>',
  filter: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  list: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  grid: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
};
function setIconHtml(parent, name) {
  if (parent && ICONS[name]) parent.innerHTML = ICONS[name];
}
function daysAgo(date) {
  const parts = String(date || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return 0;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = /* @__PURE__ */ new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - target) / 864e5));
}
var TAG_RE = /#([^\s#\[\]()]+)/g;
var NovalNotesPanel2 = class {
  constructor(app, noval, hostView) {
    this.app = app;
    this.noval = noval;
    this.hostView = hostView || null;
    this.container = null;
    this.listWrap = null;
    this.subEl = null;
    this.pop = null;
    this.popOwner = null;
    this.cardMenu = null;
    this.menuEl = null;
    this.menuAnchor = null;
    this._menuKey = null;
    this.selectMode = false;
    this.selected = /* @__PURE__ */ new Set();
    this.selBarEl = null;
    this._selInfoEl = null;
    this._selDelEl = null;
    this.editingKey = null;
    this.editingDraft = null;
    this.appendOpen = /* @__PURE__ */ new Set();
    this.appendClosed = /* @__PURE__ */ new Set();
    this.appendDrafting = null;
    this.appendEditing = null;
    this.view = "list";
    this.viewCountEl = null;
    this.detailKey = null;
    this.detailEl = null;
    this.detailEditingBody = false;
    this.detailBodyDraft = "";
    this.detailEditingAppend = -1;
    this.detailAppendDraft = "";
    this.detailAppendInput = "";
    this._detailKeys = null;
    this.cards = [];
    this.query = "";
    this.refFilter = "";
    this.tags = [];
    this.untagged = false;
    this.expanded = {};
    this.collapsed = /* @__PURE__ */ new Set();
    this.batchSize = 100;
    this.renderPlan = null;
    this.renderCursor = 0;
    this.currentListEl = null;
    this.loadMoreEl = null;
    this.loadMoreIO = null;
    this._searchTimer = null;
    this._loading = false;
    this._pending = false;
    this._outside = null;
    this.pendingFocus = null;
  }
  /* ---------------- 生命周期 ---------------- */
  mount(containerEl) {
    if (this._outside) document.removeEventListener("mousedown", this._outside);
    this._outside = null;
    this.closeMenu();
    this.closePop();
    this.closeCardMenu();
    this.closeDetail();
    this.container = containerEl;
    this.container.empty();
    this.container.addClass("cl-notes-panel");
    this.container.addClass("qm-view");
    this.buildHead();
    this.buildBody();
    this._outside = (ev) => {
      const inPop = this.pop && this.pop.contains(ev.target);
      const onOwner = this.popOwner && this.popOwner.contains(ev.target);
      if (this.pop && !inPop && !onOwner) this.closePop();
      if (this.cardMenu && !this.cardMenu.contains(ev.target)) this.closeCardMenu();
      const inMenu = this.menuEl && this.menuEl.contains(ev.target);
      const onMenuAnchor = this.menuAnchor && this.menuAnchor.contains(ev.target);
      if (this.menuEl && !inMenu && !onMenuAnchor) this.closeMenu();
    };
    document.addEventListener("mousedown", this._outside);
    this.load();
  }
  destroy() {
    if (this._outside) document.removeEventListener("mousedown", this._outside);
    this._outside = null;
    if (this._searchTimer) {
      window.clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.stopLoadMore();
    this.currentListEl = null;
    this.renderPlan = null;
    this.renderCursor = 0;
    this.closeMenu();
    this.closePop();
    this.closeCardMenu();
    this.closeDetail();
    if (this.container) this.container.empty();
    this.container = null;
    this.listWrap = null;
    this.subEl = null;
    this.cards = [];
  }
  /* ---------------- 结构 ---------------- */
  buildHead() {
    const head = this.container.createDiv({ cls: "cl-notes-head" });
    head.style.position = "relative";
    const actions = head.createDiv({ cls: "cl-notes-actions cl-notes-toolrow" });
    actions.style.position = "relative";
    this.headEl = head;
    this.toolrow = actions;
    const box = actions.createDiv({ cls: "qm-searchbox cl-notes-search" });
    const searchIcon = box.createDiv({ cls: "qm-search-ico" });
    setIconHtml(searchIcon, "search");
    const search = box.createEl("input", {
      cls: "qm-search",
      attr: { type: "text", placeholder: "\u641C\u7D22\u5361\u7247\u3001#\u6807\u7B7E\u3001\u65E5\u671F" }
    });
    this.search = search;
    const clear = box.createEl("button", { cls: "qm-search-clear", text: "\xD7" });
    this.clearBtn = clear;
    search.addEventListener("input", () => {
      this.query = search.value;
      clear.classList.toggle("is-visible", !!search.value);
      if (this._searchTimer) window.clearTimeout(this._searchTimer);
      this._searchTimer = window.setTimeout(() => {
        this._searchTimer = null;
        this.renderList();
        if (this.pop) this.renderFilterPanel();
      }, 150);
    });
    clear.onclick = () => {
      if (this._searchTimer) {
        window.clearTimeout(this._searchTimer);
        this._searchTimer = null;
      }
      search.value = "";
      this.query = "";
      clear.classList.remove("is-visible");
      search.focus();
      this.renderList();
    };
    const reviewBtn = this.iconButton(actions, "review", "\u56DE\u770B", "\u56DE\u770B\uFF08\u7FFB\u51E0\u5F20\u65E7\u5361\u7247\uFF09");
    reviewBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.openReview();
    };
    const filterBtn = this.iconButton(actions, "filter", "\u7B5B\u9009", "\u7B5B\u9009");
    this.filterBtn = filterBtn;
    this.filterDot = filterBtn.createSpan({ cls: "qm-filter-dot is-hidden" });
    filterBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.openFilterPanel();
    };
    const moreBtn = this.iconButton(actions, "more", "\u66F4\u591A", "\u66F4\u591A");
    this.moreBtn = moreBtn;
    moreBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.openMoreMenu();
    };
  }
  buildBody() {
    const body = this.container.createDiv({ cls: "cl-notes-body" });
    this.chipsEl = body.createDiv({ cls: "qm-chips" });
    const composer = body.createDiv({ cls: "qm-composer" });
    const input = composer.createEl("textarea", {
      cls: "qm-input",
      attr: { placeholder: "\u8BB0\u5F55\u4E00\u4E0B\u2026", rows: "1", spellcheck: "false" }
    });
    this.input = input;
    const foot = composer.createDiv({ cls: "qm-composer-foot" });
    foot.createDiv({ cls: "qm-kbd-hint", text: "Ctrl+Enter \u8BB0\u4E0B" });
    const save = foot.createEl("button", { cls: "qm-save is-disabled", text: "\u8BB0\u4E0B" });
    save.disabled = true;
    this.saveBtn = save;
    const autosize = () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 320) + "px";
    };
    const syncSave = () => {
      const empty = !input.value.trim();
      save.disabled = empty;
      save.classList.toggle("is-disabled", empty);
    };
    input.addEventListener("input", () => {
      autosize();
      syncSave();
    });
    input.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        this.capture();
      }
    });
    save.onclick = () => this.capture();
    const viewBar = body.createDiv({ cls: "cl-notes-viewbar" });
    const seg = viewBar.createDiv({ cls: "qm-viewseg cl-notes-viewseg" });
    const makeViewBtn = (label, mode) => {
      const btn = seg.createEl("button", { cls: "qm-viewbtn cl-notes-viewbtn" });
      btn.setAttribute("type", "button");
      setIconHtml(btn, mode === "list" ? "list" : "grid");
      btn.createSpan({ text: label });
      if (mode === "list") btn.addClass("is-active");
      btn.onclick = (ev) => {
        ev.stopPropagation();
        this.setView(mode);
      };
      return btn;
    };
    this.viewListBtn = makeViewBtn("\u5217\u8868", "list");
    this.viewGridBtn = makeViewBtn("\u5361\u7247", "grid");
    this.viewCountEl = viewBar.createSpan({ cls: "cl-notes-viewcount" });
    this.listWrap = body.createDiv({ cls: "cl-notes-listwrap" });
    this.selBarEl = body.createDiv({ cls: "qm-selbar" });
    this.reviewEl = body.createDiv({ cls: "qm-review" });
  }
  iconButton(parent, icon, label, title) {
    const btn = parent.createEl("button", { cls: "qm-icon-btn" });
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", title || label);
    setIconHtml(btn, icon);
    return btn;
  }
  /* ---------------- 数据 ---------------- */
  async load() {
    return this.reloadCards();
  }
  refresh() {
    this.load();
  }
  /** 数据层写入后只重读数据；能局部更新的就不整表重画 */
  async reloadCards() {
    if (!this.container) return;
    if (this._loading) {
      this._pending = true;
      return;
    }
    if (!this.noval || typeof this.noval.readAllCards !== "function") {
      if (this.subEl) this.subEl.setText("Noval \u6CA1\u6709\u52A0\u8F7D\u6210\u529F\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0\u65E5\u5FD7\u3002");
      return;
    }
    this._loading = true;
    let cards = [];
    try {
      cards = await this.noval.readAllCards();
    } catch (e) {
      console.error("[noval] \u8BFB\u53D6\u5361\u7247\u5931\u8D25", e);
      cards = [];
    }
    this._loading = false;
    if (!this.container) return;
    this.applyCardsLoaded(Array.isArray(cards) ? cards : []);
    this.applyPendingFocus();
    if (this.detailKey) this.renderDetail();
    if (this.reviewEl && this.reviewEl.hasClass("show")) {
      this.syncReviewCards();
      this.renderReview();
    }
    if (this._pending) {
      this._pending = false;
      this.reloadCards();
    }
  }
  /** 卡片数据签名：用来判断哪一张的内容变了 */
  cardSig(card) {
    return String(card.date || "") + "\0" + String(card.time || "") + "\0" + String(card.body || "");
  }
  findCardNode(key) {
    if (!this.listWrap) return null;
    const nodes = this.listWrap.querySelectorAll(".qm-card");
    for (const node of nodes) {
      if (node.getAttribute("data-qm-key") === key) return node;
    }
    return null;
  }
  /**
   * 新数据落地：卡片集合没增删、也没换顺序时，只替换内容变化的那几张卡片的 DOM。
   * 这样编辑 / 追加一条不会重建整个列表，滚动位置和已渲染批次都能保住。
   */
  applyCardsLoaded(cards) {
    const prev = this.cards || [];
    const prevKeys = prev.map((c) => this.cardKey(c));
    const nextKeys = cards.map((c) => this.cardKey(c));
    const sameOrder = prevKeys.length === nextKeys.length && prevKeys.every((k, i) => k === nextKeys[i]);
    this.cards = cards;
    // 导航栏「卡片笔记」徽标：卡片页只走局部刷新，导航不会重建，
    // 所以每次数据落地都把总数推给宿主视图，免得多加一条要切页才更新。
    if (this.hostView && typeof this.hostView.syncCardNavCount === "function") {
      this.hostView.syncCardNavCount(cards.length);
    }
    if (!sameOrder || !this.currentListEl || !this.renderPlan) {
      this.renderList();
      return;
    }
    const prevSig = new Map(prev.map((c) => [this.cardKey(c), this.cardSig(c)]));
    const byKey = new Map(cards.map((c) => [this.cardKey(c), c]));
    this.renderPlan = this.renderPlan.map(
      (item) => item.kind === "card" ? { kind: "card", card: byKey.get(this.cardKey(item.card)) || item.card } : item
    );
    let fallback = false;
    for (const card of cards) {
      const key = this.cardKey(card);
      if (prevSig.get(key) === this.cardSig(card)) continue;
      const node = this.findCardNode(key);
      if (!node) {
        fallback = true;
        break;
      }
      const holder = document.createElement("div");
      this.renderCard(holder, card);
      const next = holder.firstElementChild;
      if (!next) {
        fallback = true;
        break;
      }
      node.replaceWith(next);
    }
    if (fallback) {
      this.renderList();
      return;
    }
    if (this.viewCountEl) this.viewCountEl.setText("\u5171 " + this.filteredCards().length + " \u5F20");
  }
  /** 数据层按文件通知过来的入口：只更新卡片数据，不整页重建 */
  applyFileCards() {
    this.reloadCards();
  }
  /** 只有界面文字变化时调用，不重读文件 */
  rerender() {
    this.renderList();
  }
  /** 首页点速记时调用：切到卡片笔记后定位到这一条。 */
  focusCard(card) {
    if (!card) return;
    this.pendingFocus = card;
    if (this.container && !this._loading && this.cards.length) this.applyPendingFocus();
  }
  applyPendingFocus() {
    const card = this.pendingFocus;
    if (!card || !this.listWrap || this._loading) return;
    let changed = false;
    if (this.query) {
      this.query = "";
      if (this.search) this.search.value = "";
      if (this.clearBtn) this.clearBtn.classList.remove("is-visible");
      changed = true;
    }
    if (this.refFilter || this.tags && this.tags.length || this.untagged) {
      this.refFilter = "";
      this.tags = [];
      this.untagged = false;
      changed = true;
    }
    if (card.date && this.collapsed.has(card.date)) {
      this.collapsed.delete(card.date);
      changed = true;
    }
    if (changed) this.renderList();
    this.renderAllRemaining();
    this.pendingFocus = null;
    window.setTimeout(() => {
      if (!this.listWrap) return;
      const nodes = this.listWrap.querySelectorAll(".qm-card");
      let target = null;
      for (const node of nodes) {
        if (node.getAttribute("data-qm-date") !== (card.date || "")) continue;
        if (node.getAttribute("data-qm-time") !== (card.time || "")) continue;
        if (card.id && node.getAttribute("data-qm-id") !== card.id) continue;
        target = node;
        break;
      }
      if (!target) {
        new Notice2("\u8FD9\u6761\u901F\u8BB0\u5DF2\u4E0D\u5728\u5F53\u524D\u5361\u7247\u5217\u8868\u91CC\uFF0C\u53EF\u80FD\u521A\u88AB\u5220\u9664\u6216\u6539\u8FC7\u65F6\u95F4\u3002");
        return;
      }
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.addClass("is-focused");
      const badge = target.createDiv({ cls: "qm-focus-badge", text: "\u5DF2\u5B9A\u4F4D" });
      new Notice2(
        "\u5DF2\u5B9A\u4F4D\u5230 " + (card.date ? card.date.slice(5) + " " : "") + (card.time || "") + " \u7684\u901F\u8BB0"
      );
      window.setTimeout(() => {
        target.removeClass("is-focused");
        badge.remove();
      }, 3600);
    }, 60);
  }
  filteredCards() {
    const raw = String(this.query || "").trim().toLowerCase();
    const tagQuery = raw.startsWith("#") ? raw.slice(1) : "";
    const ref = this.effectiveRefFilter();
    return this.cards.filter((card) => {
      if (ref) {
        const n = this.refCount(card);
        if (ref === "has" && n === 0) return false;
        if (ref === "none" && n > 0) return false;
      }
      const tags = (card.tags || []).map((t) => String(t).replace(/^#/, ""));
      if (this.untagged && tags.length) return false;
      if (this.tags.length) {
        const hit = tags.some((t) => {
          const low = t.toLowerCase();
          return this.tags.some((sel) => {
            const key = String(sel).toLowerCase();
            return low === key || low.indexOf(key + "/") === 0;
          });
        });
        if (!hit) return false;
      }
      if (!raw) return true;
      const lowerTags = tags.map((t) => t.toLowerCase());
      if (tagQuery) return lowerTags.some((t) => t.includes(tagQuery));
      return String(card.bodyLower || "").includes(raw) || lowerTags.some((t) => t.includes(raw)) || String(card.date || "").includes(raw);
    });
  }
  /** 生效条件数：搜索词也算一条，和 Noval 一致 */
  activeFilterCount() {
    return (String(this.query || "").trim() ? 1 : 0) + (this.refFilter ? 1 : 0) + this.tags.length + (this.untagged ? 1 : 0);
  }
  /** 引用筛选实际生效值：索引没建好时按「全部」 */
  effectiveRefFilter() {
    if (!this.refFilter) return "";
    if (!this.noval || typeof this.noval.refsReady !== "function") return "";
    return this.noval.refsReady() ? this.refFilter : "";
  }
  refCount(card) {
    if (!this.noval || typeof this.noval.refCount !== "function") return 0;
    try {
      return this.noval.refCount(card) || 0;
    } catch (e) {
      return 0;
    }
  }
  renderFilterBtnState() {
    if (!this.filterBtn) return;
    const n = this.activeFilterCount();
    this.filterBtn.classList.toggle("is-active", n > 0);
    if (this.filterDot) this.filterDot.classList.toggle("is-hidden", !n);
  }
  isTagSelected(keyLower) {
    return this.tags.some((t) => String(t).toLowerCase() === keyLower);
  }
  selectedAncestorPath(keyLower) {
    const parts = String(keyLower || "").split("/");
    for (let i = parts.length - 1; i >= 1; i--) {
      const p = parts.slice(0, i).join("/");
      const hit = this.tags.find((t) => String(t).toLowerCase() === p);
      if (hit) return hit;
    }
    return "";
  }
  hasSelectedBelow(node) {
    for (const ch of node.children || []) {
      if (this.isTagSelected(ch.key) || this.hasSelectedBelow(ch)) return true;
    }
    return false;
  }
  toggleTagFilter(path) {
    const key = String(path).toLowerCase();
    if (!key) return;
    const anc = this.selectedAncestorPath(key);
    if (anc) {
      new Notice2("\u5DF2\u5305\u542B\u5728 #" + anc + " \u91CC");
      return;
    }
    const cur = this.tags.slice();
    const at = cur.findIndex((t) => String(t).toLowerCase() === key);
    if (at >= 0) cur.splice(at, 1);
    else {
      const rest = cur.filter((t) => String(t).toLowerCase().indexOf(key + "/") !== 0);
      cur.length = 0;
      for (const t of rest) cur.push(t);
      cur.push(path);
      this.expanded[key] = true;
    }
    this.untagged = false;
    this.tags = cur;
    this.afterFilterChange();
  }
  /** 正文里点标签：只用这一个标签筛选，换掉原来的多选条件（与 Noval 侧栏一致） */
  setFilterTags(list) {
    this.tags = (list || []).filter(Boolean);
    if (this.tags.length) this.untagged = false;
    if (this.selectMode) this.selected.clear();
    this.afterFilterChange();
  }
  setRefFilter(v) {
    this.refFilter = v || "";
    this.afterFilterChange();
  }
  clearFilters() {
    this.refFilter = "";
    this.tags = [];
    this.untagged = false;
    this.query = "";
    if (this.search) this.search.value = "";
    if (this.clearBtn) this.clearBtn.classList.remove("is-visible");
    this.afterFilterChange();
  }
  /** 筛选变化后统一刷新列表、按钮状态与已打开的面板 */
  afterFilterChange() {
    this.renderFilterBtnState();
    if (this.pop) {
      const keepTop = this.treeEl ? this.treeEl.scrollTop || 0 : 0;
      this.renderFilterPanel(keepTop);
      this.fitPopHeight();
    }
    this.renderList();
  }
  /* ---------------- 标签森林 ---------------- */
  tagForest() {
    const root = /* @__PURE__ */ new Map();
    let untagged = 0;
    for (const card of this.cards) {
      const tags = card.tags || [];
      if (!tags.length) {
        untagged += 1;
        continue;
      }
      const seen = /* @__PURE__ */ new Set();
      for (const raw of tags) {
        const path = String(raw).replace(/^#/, "");
        if (!path) continue;
        const parts = path.split("/");
        let level = root;
        let acc = "";
        for (const part of parts) {
          acc = acc ? acc + "/" + part : part;
          const key = acc.toLowerCase();
          let node = level.get(key);
          if (!node) {
            node = { key, label: part, path: acc, count: 0, children: /* @__PURE__ */ new Map() };
            level.set(key, node);
          }
          if (!seen.has(key)) {
            node.count += 1;
            seen.add(key);
          }
          level = node.children;
        }
      }
    }
    const toArray = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).map((n) => ({ ...n, children: toArray(n.children) }));
    return { tree: toArray(root), untagged };
  }
  /* ---------------- 生效条件 chips ---------------- */
  countDescendants(node) {
    let n = 0;
    for (const ch of node && node.children || []) {
      n += 1 + this.countDescendants(ch);
    }
    return n;
  }
  chipParts() {
    const parts = [];
    const kw = String(this.query || "").trim();
    if (kw) {
      parts.push({
        text: "\u201C" + kw + "\u201D",
        sub: "",
        clear: () => {
          this.query = "";
          if (this.search) this.search.value = "";
          if (this.clearBtn) this.clearBtn.classList.remove("is-visible");
          this.afterFilterChange();
        }
      });
    }
    if (this.refFilter) {
      parts.push({
        text: this.refFilter === "has" ? "\u5DF2\u5F15\u7528" : "\u672A\u5F15\u7528",
        sub: "",
        clear: () => this.setRefFilter("")
      });
    }
    if (this.untagged) {
      parts.push({
        text: "\u65E0\u6807\u7B7E",
        sub: "",
        clear: () => {
          this.untagged = false;
          this.afterFilterChange();
        }
      });
    }
    const forest = this.tagForest();
    const index = /* @__PURE__ */ new Map();
    const walk = (arr) => {
      for (const n of arr) {
        index.set(n.key, n);
        walk(n.children);
      }
    };
    walk(forest.tree);
    for (const t of this.tags) {
      const node = index.get(String(t).toLowerCase());
      const kids = node ? this.countDescendants(node) : 0;
      parts.push({
        text: "#" + t,
        sub: kids ? "\u542B " + kids : "",
        clear: () => {
          this.tags = this.tags.filter((x) => x !== t);
          this.afterFilterChange();
        }
      });
    }
    return parts;
  }
  renderChips() {
    const el = this.chipsEl;
    if (!el) return;
    el.empty();
    const parts = this.chipParts();
    if (!parts.length) {
      el.removeClass("show");
      this.positionFilterPop();
      return;
    }
    el.addClass("show");
    const MAX = 5;
    const shown = parts.slice(0, MAX);
    for (const p of shown) {
      const chip = el.createSpan({ cls: "qm-chip" });
      chip.createSpan({ text: p.text });
      if (p.sub) chip.createEl("em", { text: p.sub });
      const x = chip.createEl("button", { text: "\xD7" });
      x.setAttribute("type", "button");
      x.setAttribute("aria-label", "\u6E05\u9664");
      x.onclick = (e) => {
        e.stopPropagation();
        p.clear();
      };
    }
    const rest = parts.length - shown.length;
    if (rest > 0) {
      const more = el.createSpan({ cls: "qm-chip qm-chip-more", text: "+" + rest });
      more.setAttribute("title", "\u8FD8\u6709 " + rest + " \u4E2A\u6761\u4EF6");
      more.onclick = (e) => {
        e.stopPropagation();
        if (!this.pop) this.openFilterPanel();
      };
    }
    this.positionFilterPop();
  }
  /** 筛选浮层跟着工具行与 chips 一起下移 */
  positionFilterPop() {
    const pop = this.pop;
    if (!pop || this.popOwner !== this.filterBtn) return;
    let top = (this.toolrow.offsetTop || 0) + (this.toolrow.offsetHeight || 30) + 6;
    if (this.chipsEl && this.chipsEl.classList.contains("show")) {
      top += (this.chipsEl.offsetHeight || 0) + 7;
    }
    pop.style.top = Math.max(0, Math.round(top)) + "px";
  }
  /* ---------------- 渲染 ---------------- */
  setView(view) {
    if (view !== "list" && view !== "grid") return;
    if (this.view === view) return;
    this.view = view;
    if (this.viewListBtn) this.viewListBtn.classList.toggle("is-active", view === "list");
    if (this.viewGridBtn) this.viewGridBtn.classList.toggle("is-active", view === "grid");
    this.renderList();
  }
  renderList() {
    if (!this.listWrap) return;
    this.closeCardMenu();
    this.closeMenu();
    const cards = this.filteredCards();
    if (this.viewCountEl) this.viewCountEl.setText("\u5171 " + cards.length + " \u5F20");
    this.renderFilterBtnState();
    this.renderChips();
    this.renderSelectBar();
    const prevList = this.listWrap.querySelector(".qm-list");
    const keepScroll = prevList ? prevList.scrollTop : 0;
    this.stopLoadMore();
    this.currentListEl = null;
    this.listWrap.empty();
    if (!cards.length) {
      this.renderPlan = null;
      this.renderCursor = 0;
      const empty = this.listWrap.createDiv({ cls: "qm-empty" });
      empty.setText(
        this.cards.length ? "\u6CA1\u6709\u5339\u914D\u7684\u5361\u7247\u3002\u6362\u4E2A\u8BCD\uFF0C\u6216\u8005\u6E05\u9664\u7B5B\u9009\u3002" : "\u8FD8\u6CA1\u6709\u5361\u7247\u3002\u5728\u4E0A\u9762\u5199\u70B9\u4EC0\u4E48\uFF0CCtrl+Enter \u8BB0\u4E0B\u3002"
      );
      return;
    }
    this.renderCards(cards);
    let guard = 0;
    if (keepScroll > 0) {
      while (this.renderCursor < this.renderPlan.length && this.currentListEl.scrollHeight <= keepScroll + 400 && guard++ < 200) {
        this.renderNextBatch();
      }
    }
    if (this.currentListEl) this.currentListEl.scrollTop = keepScroll;
  }
  renderCards(cards) {
    const grid = this.view === "grid";
    this.currentListEl = this.listWrap.createDiv({
      cls: grid ? "qm-list cl-notes-grid" : "qm-list"
    });
    this.renderPlan = this.buildRenderPlan(cards);
    this.renderCursor = 0;
    this.renderNextBatch();
  }
  /** 把过滤后的卡片摊平成渲染计划：日期头 + 卡片，收起的分组只留头 */
  buildRenderPlan(cards) {
    if (this.view === "grid") {
      return cards.map((card) => ({ kind: "card", card }));
    }
    const searching = !!String(this.query || "").trim();
    const plan = [];
    let i = 0;
    while (i < cards.length) {
      const date = cards[i].date;
      const group = [];
      while (i < cards.length && cards[i].date === date) {
        group.push(cards[i]);
        i++;
      }
      const collapsed = !searching && this.collapsed.has(date);
      plan.push({ kind: "day", date, count: group.length, collapsed });
      if (!collapsed) {
        for (const card of group) plan.push({ kind: "card", card });
      }
    }
    return plan;
  }
  /** 渲染下一批；滚动到底部时由 IntersectionObserver 再调用 */
  renderNextBatch() {
    if (!this.renderPlan || !this.currentListEl) return;
    if (this.renderCursor >= this.renderPlan.length) {
      this.stopLoadMore();
      return;
    }
    const end = Math.min(this.renderCursor + this.batchSize, this.renderPlan.length);
    for (; this.renderCursor < end; this.renderCursor++) {
      const item = this.renderPlan[this.renderCursor];
      if (item.kind === "day") {
        const collapsed = item.collapsed;
        const day = this.currentListEl.createDiv({
          cls: "qm-day" + (collapsed ? " is-collapsed" : "")
        });
        day.createSpan({ cls: "qm-day-arrow", text: collapsed ? "\u25B6" : "\u25BC" });
        day.createSpan({ cls: "qm-day-text", text: item.date });
        day.createSpan({ cls: "qm-day-count", text: String(item.count) });
        day.onclick = () => {
          if (this.collapsed.has(item.date)) this.collapsed.delete(item.date);
          else this.collapsed.add(item.date);
          this.renderList();
        };
      } else {
        this.renderCard(this.currentListEl, item.card);
      }
    }
    if (this.renderCursor >= this.renderPlan.length) {
      this.stopLoadMore();
      return;
    }
    this.ensureLoadMore();
    this.scheduleLoadMoreCheck();
  }
  /** 哨兵一直在视口里时 IntersectionObserver 不会重复回调，补一次自检 */
  scheduleLoadMoreCheck() {
    window.setTimeout(() => {
      if (!this.loadMoreEl || !this.currentListEl || !this.renderPlan) return;
      if (this.renderCursor >= this.renderPlan.length) return;
      const rootRect = this.currentListEl.getBoundingClientRect();
      if (!rootRect.height) return;
      const sentinelRect = this.loadMoreEl.getBoundingClientRect();
      if (sentinelRect.top < rootRect.bottom + 700) this.renderNextBatch();
    }, 16);
  }
  /** 列表底部的哨兵：视口快到底时再渲染下一批 */
  ensureLoadMore() {
    if (!this.currentListEl) return;
    if (this.loadMoreEl && this.loadMoreEl.parentNode === this.currentListEl) {
      this.currentListEl.appendChild(this.loadMoreEl);
      return;
    }
    this.stopLoadMore();
    const el = this.currentListEl.createDiv({ cls: "cl-notes-loadmore" });
    this.loadMoreEl = el;
    if (typeof IntersectionObserver !== "function") return;
    this.loadMoreIO = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this.renderNextBatch();
      },
      { root: this.currentListEl, rootMargin: "700px 0px" }
    );
    this.loadMoreIO.observe(el);
  }
  stopLoadMore() {
    if (this.loadMoreIO) {
      this.loadMoreIO.disconnect();
      this.loadMoreIO = null;
    }
    if (this.loadMoreEl) {
      this.loadMoreEl.remove();
      this.loadMoreEl = null;
    }
  }
  /** 定位 / 打印等需要全量 DOM 时，把剩余批次一次补齐 */
  renderAllRemaining() {
    if (!this.renderPlan) return;
    let guard = 0;
    while (this.renderCursor < this.renderPlan.length && guard++ < 1e4) {
      this.renderNextBatch();
    }
  }
  renderCard(list, card) {
    const key = this.cardKey(card);
    const picked = this.selectMode && this.selected.has(key);
    const editing = this.editingKey === key;
    const sections = NovalBundle2.qmCardSections(card.body);
    const el = list.createDiv({ cls: "qm-card" + (picked ? " is-picked" : "") });
    el.setAttribute("data-qm-date", card.date || "");
    el.setAttribute("data-qm-time", card.time || "");
    el.setAttribute("data-qm-id", card.id || "");
    el.setAttribute("data-qm-key", key);
    if (this.selectMode) el.addClass("is-selectable");
    const head = el.createDiv({ cls: "qm-card-head" });
    if (this.selectMode) head.createSpan({ cls: "qm-tick", text: "\u2713" });
    head.createSpan({ cls: "qm-time", text: card.time || "" });
    const refDot = head.createSpan({ cls: "qm-ref" });
    this.paintRefDot(refDot, card);
    if (sections.appends.length) {
      const badge = head.createSpan({
        cls: "qm-append-badge",
        text: "\u8FFD\u52A0 " + sections.appends.length
      });
      badge.setAttribute("role", "button");
      badge.onclick = (ev) => {
        ev.stopPropagation();
        if (this.view === "grid") {
          if (this.appendClosed.has(key)) this.appendClosed.delete(key);
          else this.appendClosed.add(key);
        } else if (this.appendOpen.has(key)) {
          this.appendOpen.delete(key);
        } else {
          this.appendOpen.add(key);
        }
        this.renderList();
      };
    }
    const more = head.createEl("button", { cls: "qm-more" });
    more.setAttribute("type", "button");
    more.setAttribute("aria-label", "\u66F4\u591A\u64CD\u4F5C");
    more.setAttribute("title", "\u66F4\u591A\u64CD\u4F5C");
    setIconHtml(more, "more");
    more.onclick = (ev) => {
      ev.stopPropagation();
      this.openCardMenu(el, card, ev.currentTarget || more);
    };
    if (editing) {
      if (this.view === "grid") el.addClass("is-editing");
      this.renderEditBox(el, card, key, sections.original);
      el.onclick = (e) => e.stopPropagation();
      return;
    }
    const isGrid = this.view === "grid";
    const scrollEl = isGrid ? el.createDiv({ cls: "cl-notes-card-scroll" }) : el;
    const bodyEl = scrollEl.createDiv({ cls: "qm-body" });
    this.renderCardBody(bodyEl, card, sections.original);
    if (isGrid) {
      const tags = Array.from(bodyEl.querySelectorAll(".qm-tag"));
      if (tags.length) {
        const foot = el.createDiv({ cls: "qm-card-tags" });
        for (const tag of tags) foot.appendChild(tag);
      }
    }
    const appendsOpen = sections.appends.length && (isGrid ? !this.appendClosed.has(key) : this.appendOpen.has(key));
    if (appendsOpen) {
      this.renderAppendList(scrollEl, card, sections, key);
    }
    if (this.appendDrafting && this.appendDrafting.key === key) {
      this.renderAppendComposer(scrollEl, card, key);
    }
    el.onclick = (ev) => {
      if (this.selectMode) {
        this.toggleSelected(card, el);
        return;
      }
      if (!isGrid) return;
      const t = ev.target;
      if (t && typeof t.closest === "function" && t.closest("a, button, textarea, input, .qm-tag, .qm-ref, .qm-append-badge, .qm-append-acts")) {
        return;
      }
      this.openDetail(card);
    };
    el.addEventListener("dblclick", (e) => {
      if (this.selectMode || isGrid) return;
      const t = e.target;
      if (t && typeof t.closest === "function" && t.closest("a, .qm-tag, .qm-more, .qm-ref, .qm-append-badge, button, textarea")) {
        return;
      }
      if (e.preventDefault) e.preventDefault();
      this.beginEdit(card);
    });
  }
  /* ---------------- 编辑原始内容区（列表 / 回看共用） ---------------- */
  renderEditBox(el, card, key, original) {
    const ta = el.createEl("textarea", { cls: "qm-edit" });
    const draft = this.editingDraft;
    ta.value = draft && draft.key === key ? draft.text : String(original || "");
    ta.rows = Math.min(12, Math.max(2, ta.value.split("\n").length + 1));
    ta.addEventListener("input", () => {
      this.editingDraft = { key, text: ta.value };
    });
    window.setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 20);
    const bar = el.createDiv({ cls: "qm-edit-bar" });
    const cancel = bar.createEl("button", { cls: "qm-mini-btn", text: "\u53D6\u6D88" });
    cancel.onclick = (e) => {
      e.stopPropagation();
      this.cancelEdit();
    };
    const save = bar.createEl("button", { cls: "qm-mini-btn is-primary", text: "\u4FDD\u5B58" });
    save.onclick = async (e) => {
      e.stopPropagation();
      const text = this.editingDraft && this.editingDraft.key === key ? this.editingDraft.text : ta.value;
      if (!String(text || "").trim()) {
        new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
        return;
      }
      const ok = await this.noval.updateCard(card, text);
      if (!ok) {
        new Notice2("\u4FDD\u5B58\u5931\u8D25\uFF0C\u5361\u7247\u4F4D\u7F6E\u53EF\u80FD\u5DF2\u53D8\u5316");
        return;
      }
      this.editingKey = null;
      this.editingDraft = null;
      await this.reloadCards();
    };
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        save.onclick(e);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelEdit();
      }
    });
  }
  /* ---------------- 追加区（列表 / 回看共用） ---------------- */
  renderAppendList(el, card, sections, key) {
    const wrap = el.createDiv({ cls: "qm-append-list" });
    sections.appends.forEach((item, index) => {
      const row = wrap.createDiv({ cls: "qm-append-item" });
      const bar = row.createDiv({ cls: "qm-append-head" });
      bar.createSpan({ cls: "qm-append-time", text: item.label });
      const editing = this.appendEditing && this.appendEditing.key === key && this.appendEditing.index === index;
      if (editing) {
        const ta = row.createEl("textarea", { cls: "qm-edit qm-append-edit" });
        ta.value = this.appendEditing.text;
        window.setTimeout(() => {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }, 20);
        ta.addEventListener("input", () => {
          if (this.appendEditing && this.appendEditing.key === key) {
            this.appendEditing.text = ta.value;
          }
        });
        const editBar = row.createDiv({ cls: "qm-edit-bar" });
        const cancel = editBar.createEl("button", { cls: "qm-mini-btn", text: "\u53D6\u6D88" });
        cancel.onclick = (ev) => {
          ev.stopPropagation();
          this.appendEditing = null;
          this.renderAll();
        };
        const save = editBar.createEl("button", { cls: "qm-mini-btn is-primary", text: "\u4FDD\u5B58" });
        save.onclick = async (ev) => {
          ev.stopPropagation();
          const text = this.appendEditing && this.appendEditing.key === key ? this.appendEditing.text : ta.value;
          const ok = await this.noval.updateAppend(card, index, text);
          if (!ok) return;
          this.appendEditing = null;
          await this.reloadCards();
        };
        return;
      }
      const acts = bar.createDiv({ cls: "qm-append-acts" });
      const edit = acts.createEl("button", { cls: "qm-mini-btn", text: "\u7F16\u8F91" });
      edit.onclick = (ev) => {
        ev.stopPropagation();
        this.beginAppendEdit(card, index, item.text);
      };
      const del = acts.createEl("button", {
        cls: "qm-mini-btn qm-mini-btn-danger",
        text: "\u5220\u9664"
      });
      del.onclick = (ev) => {
        ev.stopPropagation();
        this.confirmDeleteAppend(card, index);
      };
      const textEl = row.createDiv({ cls: "qm-append-text" });
      this.renderCardBody(textEl, card, item.text);
    });
  }
  beginAppendEdit(card, index, text) {
    const key = this.cardKey(card);
    this.appendEditing = { key, index, text: String(text || "") };
    this.appendOpen.add(key);
    this.appendClosed.delete(key);
    this.renderAll();
  }
  confirmDeleteAppend(card, index) {
    new NovalBundle2.ConfirmModal(this.app, "\u5220\u9664\u8FD9\u6761\u8FFD\u52A0\uFF1F", async () => {
      const ok = await this.noval.deleteAppend(card, index);
      if (!ok) return;
      this.appendEditing = null;
      await this.reloadCards();
    }).open();
  }
  /** 从「···」进追加：展开这张卡并就地放一个输入框 */
  beginAppend(card) {
    const key = this.cardKey(card);
    this.appendDrafting = { key, text: "" };
    this.appendOpen.add(key);
    this.appendClosed.delete(key);
    this.renderAll();
  }
  renderAppendComposer(el, card, key) {
    const wrap = el.createDiv({ cls: "qm-append-composer" });
    const ta = wrap.createEl("textarea", {
      cls: "qm-input qm-append-input",
      attr: { rows: "2", placeholder: "\u8FFD\u52A0\u4E00\u6BB5\u2026" }
    });
    ta.value = this.appendDrafting && this.appendDrafting.key === key ? this.appendDrafting.text : "";
    ta.addEventListener("input", () => {
      if (this.appendDrafting && this.appendDrafting.key === key) {
        this.appendDrafting.text = ta.value;
      }
    });
    window.setTimeout(() => ta.focus(), 20);
    const bar = wrap.createDiv({ cls: "qm-append-bar" });
    bar.createDiv({ cls: "qm-kbd-hint", text: "Ctrl+Enter \u8FFD\u52A0" });
    const cancel = () => {
      this.appendDrafting = null;
      this.renderAll();
    };
    const cancelBtn = bar.createEl("button", { cls: "qm-mini-btn", text: "\u53D6\u6D88" });
    cancelBtn.onclick = (ev) => {
      ev.stopPropagation();
      cancel();
    };
    const save = bar.createEl("button", { cls: "qm-mini-btn is-primary", text: "\u8FFD\u52A0" });
    save.onclick = async (ev) => {
      ev.stopPropagation();
      const text = this.appendDrafting && this.appendDrafting.key === key ? this.appendDrafting.text : ta.value;
      if (!String(text || "").trim()) {
        new Notice2("\u5199\u70B9\u4EC0\u4E48\u518D\u8FFD\u52A0\u5427");
        return;
      }
      const ok = await this.noval.appendToCard(card, text);
      if (!ok) return;
      this.appendDrafting = null;
      this.appendOpen.add(key);
      await this.reloadCards();
    };
    ta.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        save.onclick(ev);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });
  }
  /* ---------------- 卡片详情浮窗（只在卡片视图里使用） ---------------- */
  detailCard() {
    if (!this.detailKey) return null;
    return this.cards.find((c) => this.cardKey(c) === this.detailKey) || null;
  }
  openDetail(card) {
    if (!card || !this.container) return;
    this.detailKey = this.cardKey(card);
    this.detailEditingBody = false;
    this.detailBodyDraft = "";
    this.detailEditingAppend = -1;
    this.detailAppendDraft = "";
    this.detailAppendInput = "";
    if (!this._detailKeys) {
      this._detailKeys = (ev) => {
        if (ev.key === "Escape" && this.detailEl) {
          ev.preventDefault();
          ev.stopPropagation();
          this.closeDetail();
        }
      };
      document.addEventListener("keydown", this._detailKeys, true);
    }
    this.renderDetail();
  }
  closeDetail() {
    if (this._detailKeys) {
      document.removeEventListener("keydown", this._detailKeys, true);
      this._detailKeys = null;
    }
    if (this.detailEl) {
      this.detailEl.remove();
      this.detailEl = null;
    }
    this.detailKey = null;
    this.detailEditingBody = false;
    this.detailBodyDraft = "";
    this.detailEditingAppend = -1;
    this.detailAppendDraft = "";
  }
  renderDetail() {
    const card = this.detailCard();
    if (!card || !this.container) {
      this.closeDetail();
      return;
    }
    let keepScroll = 0;
    if (this.detailEl) {
      const oldScroll = this.detailEl.querySelector(".cl-notes-detail-scroll");
      if (oldScroll) keepScroll = oldScroll.scrollTop;
      this.detailEl.remove();
    }
    const overlay = this.container.createDiv({ cls: "cl-notes-detail-overlay" });
    this.detailEl = overlay;
    overlay.addEventListener("mousedown", (ev) => {
      if (ev.target === overlay) this.closeDetail();
    });
    const dlg = overlay.createDiv({ cls: "cl-notes-detail" });
    const sections = NovalBundle2.qmCardSections(card.body);
    const head = dlg.createDiv({ cls: "cl-notes-detail-head" });
    head.createSpan({ cls: "cl-notes-detail-time", text: card.time || "" });
    const refDot = head.createSpan({ cls: "qm-ref" });
    this.paintRefDot(refDot, card);
    if (sections.appends.length) {
      head.createSpan({
        cls: "cl-notes-detail-badge",
        text: "\u8FFD\u52A0 " + sections.appends.length
      });
    }
    const close = head.createEl("button", { cls: "cl-notes-detail-close", text: "\u2715" });
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "\u5173\u95ED");
    close.onclick = () => this.closeDetail();
    const scroll = dlg.createDiv({ cls: "cl-notes-detail-scroll" });
    const label = scroll.createDiv({ cls: "cl-notes-detail-label" });
    label.createSpan({ text: "\u6B63\u6587" });
    if (!this.detailEditingBody) {
      const edit = label.createEl("button", { cls: "cl-notes-detail-link", text: "\u7F16\u8F91" });
      edit.setAttribute("type", "button");
      edit.onclick = () => {
        this.detailEditingBody = true;
        this.detailBodyDraft = String(sections.original || "");
        this.renderDetail();
      };
    }
    if (this.detailEditingBody) {
      const ta = scroll.createEl("textarea", { cls: "qm-edit cl-notes-detail-edit" });
      ta.value = this.detailBodyDraft;
      ta.addEventListener("input", () => {
        this.detailBodyDraft = ta.value;
      });
      window.setTimeout(() => ta.focus(), 20);
      const bar = scroll.createDiv({ cls: "cl-notes-detail-editbar" });
      const cancel = bar.createEl("button", { cls: "qm-mini-btn", text: "\u53D6\u6D88" });
      cancel.onclick = () => {
        this.detailEditingBody = false;
        this.detailBodyDraft = "";
        this.renderDetail();
      };
      const save = bar.createEl("button", { cls: "qm-mini-btn is-primary", text: "\u4FDD\u5B58" });
      save.onclick = async () => {
        const text = String(this.detailBodyDraft || "");
        if (!text.trim()) {
          new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
          return;
        }
        const ok = await this.noval.updateCard(card, text);
        if (!ok) {
          new Notice2("\u4FDD\u5B58\u5931\u8D25\uFF0C\u5361\u7247\u4F4D\u7F6E\u53EF\u80FD\u5DF2\u53D8\u5316");
          return;
        }
        this.detailEditingBody = false;
        this.detailBodyDraft = "";
        await this.reloadCards();
      };
      ta.addEventListener("keydown", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
          ev.preventDefault();
          save.onclick(ev);
        }
      });
    } else {
      const bodyEl = scroll.createDiv({ cls: "cl-notes-detail-body" });
      this.renderCardBody(bodyEl, card, sections.original, false);
      const tags = Array.from(bodyEl.querySelectorAll(".qm-tag"));
      if (tags.length) {
        const tagWrap = scroll.createDiv({ cls: "cl-notes-detail-tags" });
        for (const tag of tags) tagWrap.appendChild(tag);
      }
    }
    scroll.createDiv({ cls: "cl-notes-detail-divider", text: "\u8FFD\u52A0\u5185\u5BB9" });
    const list = scroll.createDiv({ cls: "cl-notes-detail-appends" });
    if (!sections.appends.length) {
      list.createDiv({ cls: "cl-notes-detail-empty", text: "\u8FD8\u6CA1\u6709\u8FFD\u52A0\u5185\u5BB9\u3002" });
    }
    sections.appends.forEach((item, index) => {
      const row = list.createDiv({ cls: "cl-notes-detail-append" });
      const bar = row.createDiv({ cls: "cl-notes-detail-append-head" });
      bar.createSpan({ cls: "cl-notes-detail-append-time", text: item.label });
      const editingAppend = this.detailEditingAppend === index;
      if (!editingAppend) {
        const acts = bar.createDiv({ cls: "cl-notes-detail-acts" });
        const edit = acts.createEl("button", { cls: "qm-mini-btn", text: "\u7F16\u8F91" });
        edit.onclick = () => {
          this.detailEditingAppend = index;
          this.detailAppendDraft = String(item.text || "");
          this.renderDetail();
        };
        const del = acts.createEl("button", {
          cls: "qm-mini-btn qm-mini-btn-danger",
          text: "\u5220\u9664"
        });
        del.onclick = () => {
          new NovalBundle2.ConfirmModal(this.app, "\u5220\u9664\u8FD9\u6761\u8FFD\u52A0\uFF1F", async () => {
            const ok = await this.noval.deleteAppend(card, index);
            if (!ok) return;
            this.detailEditingAppend = -1;
            await this.reloadCards();
          }).open();
        };
      }
      if (editingAppend) {
        const ta = row.createEl("textarea", { cls: "qm-edit cl-notes-detail-edit" });
        ta.value = this.detailAppendDraft;
        ta.addEventListener("input", () => {
          this.detailAppendDraft = ta.value;
        });
        window.setTimeout(() => ta.focus(), 20);
        const editBar = row.createDiv({ cls: "cl-notes-detail-editbar" });
        const cancel = editBar.createEl("button", { cls: "qm-mini-btn", text: "\u53D6\u6D88" });
        cancel.onclick = () => {
          this.detailEditingAppend = -1;
          this.detailAppendDraft = "";
          this.renderDetail();
        };
        const save = editBar.createEl("button", { cls: "qm-mini-btn is-primary", text: "\u4FDD\u5B58" });
        save.onclick = async () => {
          const text = String(this.detailAppendDraft || "");
          if (!text.trim()) {
            new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
            return;
          }
          const ok = await this.noval.updateAppend(card, index, text);
          if (!ok) return;
          this.detailEditingAppend = -1;
          this.detailAppendDraft = "";
          await this.reloadCards();
        };
        ta.addEventListener("keydown", (ev) => {
          if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
            ev.preventDefault();
            save.onclick(ev);
          }
        });
      } else {
        const textEl = row.createDiv({ cls: "cl-notes-detail-append-text" });
        this.renderCardBody(textEl, card, item.text, false);
      }
    });
    const foot = dlg.createDiv({ cls: "cl-notes-detail-foot" });
    const input = foot.createEl("textarea", {
      cls: "cl-notes-detail-input",
      attr: { rows: "2", placeholder: "\u8FFD\u52A0\u4E00\u6761\u2026" }
    });
    input.value = this.detailAppendInput;
    input.addEventListener("input", () => {
      this.detailAppendInput = input.value;
    });
    const footBar = foot.createDiv({ cls: "cl-notes-detail-footbar" });
    footBar.createSpan({ cls: "cl-notes-detail-hint", text: "Esc \u5173\u95ED \xB7 Ctrl+Enter \u4FDD\u5B58" });
    const addBtn = footBar.createEl("button", { cls: "qm-mini-btn is-primary", text: "\u8FFD\u52A0" });
    addBtn.onclick = async () => {
      const text = String(this.detailAppendInput || "").trim();
      if (!text) {
        new Notice2("\u5199\u70B9\u4EC0\u4E48\u518D\u8FFD\u52A0\u5427");
        return;
      }
      const ok = await this.noval.appendToCard(card, text);
      if (!ok) return;
      this.detailAppendInput = "";
      await this.reloadCards();
      if (this.detailEl) {
        const sc = this.detailEl.querySelector(".cl-notes-detail-scroll");
        if (sc) sc.scrollTop = sc.scrollHeight;
      }
    };
    input.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        addBtn.onclick(ev);
      }
    });
    if (keepScroll) scroll.scrollTop = keepScroll;
  }
  /** 引用小红点：数字与提示文案都与 Noval 的 paintRefDot 一致 */
  paintRefDot(el, card) {
    if (!el) return;
    const info = this.noval.refSummary ? this.noval.refSummary(card) : null;
    const n = info ? info.notes : 0;
    if (!n) {
      el.addClass("is-hidden");
      el.setAttribute("title", "");
      return;
    }
    el.removeClass("is-hidden");
    const places = info.places || n;
    const lines = [
      "\u88AB " + n + " \u7BC7\u7B14\u8BB0\u5F15\u7528" + (places > n ? " \xB7 \u5171 " + places + " \u5904" : "")
    ];
    const names = info.names || [];
    for (const nm of names.slice(0, 8)) lines.push("\xB7 " + nm);
    if (names.length > 8) lines.push("\xB7 \u2026\u8FD8\u6709 " + (names.length - 8) + " \u7BC7");
    if (info.ambiguous) lines.push("\uFF08\u6709\u540C\u540D\u6587\u4EF6\uFF0C\u94FE\u63A5\u53EF\u80FD\u6307\u9519\uFF0C\u6CE8\u610F\uFF09");
    el.setAttribute("title", lines.join("\n"));
  }
  renderCardBody(bodyEl, card, textOverride, interactive = true) {
    const text = textOverride != null ? String(textOverride) : NovalBundle2.qmCardSections(String(card.body || "")).original;
    TAG_RE.lastIndex = 0;
    let last = 0;
    let match;
    while ((match = TAG_RE.exec(text)) !== null) {
      if (match.index > last) {
        bodyEl.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      const tagValue = match[1];
      const tag = bodyEl.createSpan({ cls: "qm-tag", text: match[0] });
      if (!this.selectMode && interactive) {
        tag.onclick = (ev) => {
          ev.stopPropagation();
          this.setFilterTags([tagValue]);
        };
        // 右键标签 = 改标签（AI 纠错）；左键保持原有筛选行为不变
        tag.oncontextmenu = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openTagFix(this, card, tagValue, tag);
        };
        tag.setAttribute("title", "#" + tagValue + " · 左键筛选 · 右键改标签");
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      bodyEl.appendChild(document.createTextNode(text.slice(last)));
    }
  }
  /* ---------------- 弹层 ---------------- */
  showPop(owner, build) {
    this.closePop();
    const pop = this.toolrow.createDiv({ cls: "cl-notes-pop" });
    build(pop);
    this.pop = pop;
    this.popOwner = owner;
    owner.classList.add("is-pop-open");
  }
  closePop() {
    if (this.pop) this.pop.remove();
    if (this.popOwner) this.popOwner.classList.remove("is-pop-open");
    this.pop = null;
    this.popOwner = null;
    this.treeEl = null;
    this.renderFilterBtnState();
  }
  /* ---------------- 筛选浮层（与 Noval 同一套 DOM / 逻辑） ---------------- */
  openFilterPanel() {
    if (this.pop && this.popOwner === this.filterBtn) {
      this.closePop();
      return;
    }
    this.closeMenu();
    this.closePop();
    const pop = this.headEl.createDiv({ cls: "qm-pop" });
    this.pop = pop;
    this.popOwner = this.filterBtn;
    this.filterBtn.classList.add("is-pop-open");
    this.renderFilterPanel(0);
    this.positionFilterPop();
    pop.addClass("show");
    this.fitPopHeight();
  }
  renderFilterPanel(keepTop) {
    const el = this.pop;
    if (!el) return;
    if (keepTop == null) keepTop = this.treeEl ? this.treeEl.scrollTop || 0 : 0;
    el.empty();
    el.createDiv({ cls: "qm-pop-title", text: "\u7B5B\u9009" });
    el.createDiv({ cls: "qm-pop-label", text: "\u5F15\u7528\u60C5\u51B5" });
    const seg = el.createDiv({ cls: "qm-seg" });
    const refOpts = [["", "\u5168\u90E8"], ["has", "\u5DF2\u5F15\u7528"], ["none", "\u672A\u5F15\u7528"]];
    for (const [v, label] of refOpts) {
      const b = seg.createEl("button", {
        text: label,
        cls: this.refFilter === v ? "on" : ""
      });
      b.setAttribute("type", "button");
      b.onclick = (e) => {
        e.stopPropagation();
        this.setRefFilter(v);
      };
    }
    const lab = el.createDiv({ cls: "qm-pop-label" });
    lab.createSpan({ text: "\u6807\u7B7E" });
    if (this.tags.length) {
      lab.createSpan({ cls: "qm-pop-sel", text: "\u5DF2\u9009 " + this.tags.length });
    }
    const healthBtn = lab.createEl("button", { cls: "qm-tai-btn qm-tai-health", text: "\u5065\u5EB7" });
    healthBtn.setAttribute("type", "button");
    healthBtn.setAttribute("title", "\u6807\u7B7E\u5065\u5EB7\uFF1A\u5B64\u513F\u3001\u8FD1\u4E49\u3001\u590D\u7528\u7387");
    healthBtn.onclick = (e) => { e.stopPropagation(); this.closePop(); openTagHealth(this); };
    const treeWrap = el.createDiv({ cls: "qm-tree-wrap" });
    const tree = treeWrap.createDiv({ cls: "qm-tagtree" });
    this.treeEl = tree;
    tree.addEventListener("scroll", () => this.updateTreeMore());
    const forest = this.tagForest();
    const un = tree.createDiv({
      cls: "qm-tnode qm-tnode-untagged" + (this.untagged ? " is-on" : "")
    });
    un.setAttribute("title", "\u53EA\u770B\u6CA1\u6709\u5199\u6807\u7B7E\u7684\u5361\u7247");
    un.createSpan({ cls: "qm-caret is-blank" });
    un.createSpan({ cls: "qm-tname", text: "\u65E0\u6807\u7B7E" });
    un.createSpan({ cls: "qm-tcount", text: String(forest.untagged) });
    if (forest.untagged > 0) {
      const aiBtn = un.createEl("button", { cls: "qm-tai-btn", text: "AI \u6253\u6807" });
      aiBtn.setAttribute("type", "button");
      aiBtn.setAttribute("title", "AI \u7ED9\u5168\u90E8 " + forest.untagged + " \u5F20\u65E0\u6807\u7B7E\u5361\u7247\u6253\u6807\u7B7E");
      aiBtn.onclick = (e) => { e.stopPropagation(); this.closePop(); openBatchTag(this); };
    }
    un.createSpan({ cls: "qm-tmark", text: "\u2713" });
    un.onclick = () => {
      this.untagged = !this.untagged;
      if (this.untagged) this.tags = [];
      this.afterFilterChange();
    };
    for (const node of forest.tree) this.renderTagNode(tree, node, 0);
    const foot = el.createDiv({ cls: "qm-pop-foot" });
    const clear = foot.createEl("button", { cls: "qm-link-btn", text: "\u6E05\u9664\u7B5B\u9009" });
    clear.setAttribute("type", "button");
    clear.onclick = (e) => {
      e.stopPropagation();
      this.clearFilters();
    };
    const n = this.activeFilterCount();
    foot.createSpan({
      cls: "qm-pop-note",
      text: n ? "\u5DF2\u751F\u6548 " + n + " \u9879" : "\u6CA1\u6709\u751F\u6548\u7684\u7B5B\u9009"
    });
    this.updateTreeMore();
    if (keepTop && tree.scrollTop !== keepTop) tree.scrollTop = keepTop;
  }
  renderTagNode(parent, node, depth) {
    const key = node.key;
    const sel = this.isTagSelected(key);
    const covered = !sel && !!this.selectedAncestorPath(key);
    const some = !sel && !covered && this.hasSelectedBelow(node);
    const open = !!this.expanded[key];
    const kids = node.children.length > 0;
    const row = parent.createDiv({
      cls: "qm-tnode" + (sel ? " is-on" : "") + (some ? " is-some" : "") + (covered ? " is-inherit" : "") + (depth ? " is-child" : "")
    });
    row.setAttribute("title", "#" + node.path + " \xB7 " + node.count + " \u6761");
    const caret = row.createSpan({
      cls: "qm-caret" + (kids ? "" : " is-blank"),
      text: kids ? open ? "\u25BE" : "\u25B8" : ""
    });
    caret.onclick = (e) => {
      e.stopPropagation();
      if (!kids) return;
      if (this.expanded[key]) delete this.expanded[key];
      else this.expanded[key] = true;
      this.renderFilterPanel();
    };
    row.createSpan({ cls: "qm-tname", text: (depth ? "" : "#") + node.label });
    row.createSpan({ cls: "qm-tcount", text: String(node.count) });
    row.createSpan({ cls: "qm-tmark", text: "\u2713" });
    row.onclick = () => {
      if (covered) {
        new Notice2("\u5DF2\u5305\u542B\u5728 #" + this.selectedAncestorPath(key) + " \u91CC");
        return;
      }
      this.toggleTagFilter(node.path);
    };
    if (kids && open) {
      const box = parent.createDiv({ cls: "qm-tchildren" });
      for (const ch of node.children) this.renderTagNode(box, ch, depth + 1);
    }
  }
  /** 侧栏不高时收一点标签窗口，保证底部按钮可见 */
  fitPopHeight() {
    const pop = this.pop;
    const tree = this.treeEl;
    if (!pop || !tree || !this.container) return;
    tree.style.height = "";
    if (!this.container.clientHeight) return;
    const avail = this.container.clientHeight - pop.offsetTop - 10;
    const need = pop.offsetHeight;
    if (need > avail) {
      tree.style.height = Math.max(88, 200 - (need - avail)) + "px";
    }
  }
  updateTreeMore() {
    const tree = this.treeEl;
    if (!tree) return;
    const wrap = tree.parentNode;
    const rest = (tree.scrollHeight || 0) - (tree.scrollTop || 0) - (tree.clientHeight || 0);
    if (wrap && wrap.classList) wrap.classList.toggle("more", rest > 0.5);
  }
  openMoreMenu() {
    const hit = this.filteredCards().length;
    const total = this.cards.length;
    const cap = this.noval.settings && this.noval.settings.maxCards || 0;
    const capNote = cap > 0 && hit > cap ? " \xB7 \u663E\u793A\u6700\u8FD1 " + cap : "";
    const countLine = (hit === total ? "\u5171 " + total + " \u6761\u5361\u7247" : "\u5171 " + total + " \u6761 \xB7 \u547D\u4E2D " + hit + " \u6761") + capNote;
    const n = (this.noval.settings && this.noval.settings.trash || []).length;
    const untaggedCount = this.cards.filter((c) => !(c.tags || []).length).length;
    const items = [
      { title: countLine, icon: "arrow-right", disabled: true },
      { separator: true },
      {
        title: this.selectMode ? "\u9000\u51FA\u591A\u9009" : "\u591A\u9009",
        icon: "list-checks",
        onClick: () => this.toggleSelectMode()
      },
      {
        title: n ? "\u6700\u8FD1\u5220\u9664 " + n : "\u6700\u8FD1\u5220\u9664",
        icon: "trash-2",
        onClick: () => new NovalBundle2.TrashModal(this.app, this.noval).open()
      },
      {
        title: "\u6253\u5F00\u672C\u6708\u6587\u4EF6",
        icon: "file-text",
        onClick: () => this.noval.openCurrentMonthFile()
      },
      {
        title: "\u68C0\u67E5\u5B64\u513F\u5361\u7247",
        icon: "search-check",
        onClick: () => new NovalBundle2.OrphanModal(this.app, this.noval).open()
      },
      {
        title: "AI \u6574\u7406\u65E0\u6807\u7B7E" + (untaggedCount ? " (" + untaggedCount + ")" : ""),
        icon: "sparkles",
        onClick: () => openBatchTag(this)
      },
      {
        title: "\u6807\u7B7E\u5065\u5EB7",
        icon: "search-check",
        onClick: () => openTagHealth(this)
      },
      { separator: true },
      {
        title: "\u5728\u53F3\u4FA7\u680F\u6253\u5F00",
        icon: "panel-right",
        onClick: () => this.openSidebar()
      }
    ];
    return this.showMenu(items, this.moreBtn);
  }
  /* ---------------- 「更多」菜单（复刻 Noval 的 showMenu） ---------------- */
  showMenu(items, anchor) {
    if (this.menuEl && this.menuAnchor === anchor) {
      this.closeMenu();
      return;
    }
    this.closeMenu();
    this.closePop();
    const menu = this.toolrow.createDiv({ cls: "qm-menu" });
    for (const it of items) {
      if (it.separator) {
        menu.createDiv({ cls: "qm-menu-sep" });
        continue;
      }
      const row = menu.createDiv({
        cls: "qm-menu-item" + (it.disabled ? " is-disabled" : "") + (it.danger ? " is-danger" : "")
      });
      const ico = row.createSpan({ cls: "qm-menu-ico" });
      if (it.icon) setIcon2(ico, it.icon);
      row.createSpan({ cls: "qm-menu-label", text: it.title });
      if (!it.disabled) {
        row.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const fn = it.onClick;
          this.closeMenu();
          if (fn) fn();
        };
      }
    }
    const ar = anchor.getBoundingClientRect();
    const rr = this.toolrow.getBoundingClientRect();
    const menuH = menu.offsetHeight || 0;
    const below = ar.bottom - rr.top + 6;
    const above = ar.top - rr.top - menuH - 6;
    const spaceBelow = window.innerHeight - ar.bottom - 10;
    const spaceAbove = ar.top - 10;
    const top = menuH > spaceBelow && spaceAbove > spaceBelow ? above : below;
    menu.style.top = Math.max(0, Math.round(top)) + "px";
    menu.style.right = Math.max(0, Math.round(rr.right - ar.right)) + "px";
    this.menuEl = menu;
    this.menuAnchor = anchor;
    anchor.classList.add("is-pop-open");
    this._menuKey = (ev) => {
      if (ev.key === "Escape") this.closeMenu();
    };
    document.addEventListener("keydown", this._menuKey, true);
  }
  closeMenu() {
    if (this._menuKey) {
      document.removeEventListener("keydown", this._menuKey, true);
      this._menuKey = null;
    }
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    if (this.menuAnchor) {
      this.menuAnchor.classList.remove("is-pop-open");
      this.menuAnchor = null;
    }
  }
  /* ---------------- 多选（与 Noval 同一套交互） ---------------- */
  cardKey(card) {
    return (card.file ? card.file.path : "") + "|" + card.date + "|" + card.time + "|" + (card.id || String(card.body || "").slice(0, 24));
  }
  toggleSelectMode(force) {
    this.selectMode = typeof force === "boolean" ? force : !this.selectMode;
    this.selected.clear();
    this.renderList();
  }
  toggleSelected(card, box) {
    const key = this.cardKey(card);
    const on = !this.selected.has(key);
    if (on) this.selected.add(key);
    else this.selected.delete(key);
    if (box) box.classList.toggle("is-picked", on);
    const n = this.selected.size;
    if (this._selInfoEl) this._selInfoEl.setText("\u5DF2\u9009 " + n + " \u6761");
    if (this._selDelEl) {
      this._selDelEl.setText(n ? "\u5220\u9664\u6240\u9009 " + n : "\u5220\u9664\u6240\u9009");
      this._selDelEl.disabled = !n;
    }
  }
  renderSelectBar() {
    const el = this.selBarEl;
    if (!el) return;
    el.empty();
    if (!this.selectMode) {
      el.removeClass("show");
      if (this.listWrap) this.listWrap.removeClass("has-selbar");
      this._selInfoEl = null;
      this._selDelEl = null;
      return;
    }
    el.addClass("show");
    if (this.listWrap) this.listWrap.addClass("has-selbar");
    const n = this.selected.size;
    this._selInfoEl = el.createSpan({ cls: "qm-selbar-info", text: "\u5DF2\u9009 " + n + " \u6761" });
    const acts = el.createDiv({ cls: "qm-selbar-acts" });
    const cancel = acts.createEl("button", { text: "\u53D6\u6D88" });
    cancel.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      this.toggleSelectMode(false);
    };
    const del = acts.createEl("button", {
      cls: "is-danger",
      text: n ? "\u5220\u9664\u6240\u9009 " + n : "\u5220\u9664\u6240\u9009"
    });
    del.disabled = !n;
    del.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      if (!this.selected.size) return;
      this.deleteSelected();
    };
    this._selDelEl = del;
  }
  deleteSelected() {
    const picked = this.cards.filter((c) => this.selected.has(this.cardKey(c)));
    if (!picked.length) return;
    new NovalBundle2.ConfirmModal(
      this.app,
      "\u5220\u9664\u9009\u4E2D\u7684 " + picked.length + " \u6761\u5361\u7247\uFF1F",
      async () => {
        const res = await this.noval.deleteCards(picked);
        this.selectMode = false;
        this.selected.clear();
        await this.reloadCards();
        if (res && res.deleted && res.failed) {
          new Notice2("\u5DF2\u5220\u9664 " + res.deleted + " \u6761\uFF0C" + res.failed + " \u6761\u6CA1\u627E\u5230\u5DF2\u8DF3\u8FC7", 9e3);
        } else if (res && res.deleted) {
          new Notice2("\u5DF2\u5220\u9664 " + res.deleted + " \u6761\uFF0C\u53EF\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u6062\u590D", 9e3);
        } else {
          new Notice2("\u6CA1\u6709\u5220\u9664\uFF1A\u5361\u7247\u4F4D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 9e3);
        }
      },
      ""
    ).open();
  }
  /* ---------------- 回看（复刻 Noval 的覆盖视图） ---------------- */
  openReview() {
    if (!this.reviewEl) return;
    this.pickReview();
    this.reviewEl.addClass("show");
    this.renderReview();
  }
  closeReview() {
    if (!this.reviewEl) return;
    this.reviewEl.removeClass("show");
    this.reviewEl.empty();
  }
  pickReview() {
    const pool = this.cards.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    this.reviewCards = pool.slice(0, 5);
  }
  renderReview() {
    const el = this.reviewEl;
    if (!el) return;
    el.empty();
    const head = el.createDiv({ cls: "qm-review-head" });
    const back = head.createEl("button", { cls: "qm-review-back" });
    back.setAttribute("aria-label", "\u8FD4\u56DE\u5361\u7247");
    back.setAttribute("title", "\u8FD4\u56DE\u5361\u7247");
    setIconHtml(back, "back");
    back.onclick = () => this.closeReview();
    head.createSpan({ cls: "qm-review-title", text: "\u56DE\u770B" });
    const shuffle = head.createEl("button", { cls: "qm-review-shuffle", text: "\u6362\u4E00\u6279" });
    shuffle.onclick = () => {
      this.pickReview();
      this.renderReview();
    };
    el.createDiv({
      cls: "qm-review-sub",
      text: this.reviewCards.length ? "\u968F\u673A\u7FFB " + this.reviewCards.length + " \u5F20\u65E7\u5361\u7247" : "\u5361\u7247\u8FD8\u4E0D\u591F\uFF0C\u5148\u53BB\u8BB0\u51E0\u6761\u5427"
    });
    const list = el.createDiv({ cls: "qm-review-list" });
    for (const card of this.reviewCards) {
      const key = this.cardKey(card);
      const sections = NovalBundle2.qmCardSections(card.body);
      const box = list.createDiv({ cls: "qm-rv-card" });
      const rhead = box.createDiv({ cls: "qm-rv-head" });
      const meta = rhead.createDiv({ cls: "qm-rv-meta" });
      meta.createSpan({ text: String(card.date || "").slice(5) + " " + card.time });
      meta.createSpan({ cls: "qm-rv-sep", text: "\xB7" });
      meta.createSpan({ text: daysAgo(card.date) + " \u5929\u524D" });
      if (sections.appends.length) {
        const badge = rhead.createSpan({
          cls: "qm-append-badge",
          text: "\u8FFD\u52A0 " + sections.appends.length
        });
        badge.onclick = (ev) => {
          ev.stopPropagation();
          if (this.appendOpen.has(key)) this.appendOpen.delete(key);
          else this.appendOpen.add(key);
          this.renderReview();
        };
      }
      const more = rhead.createEl("button", { cls: "qm-rv-more" });
      more.setAttribute("type", "button");
      more.setAttribute("aria-label", "\u66F4\u591A\u64CD\u4F5C");
      setIconHtml(more, "more");
      more.onclick = (ev) => {
        ev.stopPropagation();
        this.openCardMenu(box, card, more);
      };
      box.addEventListener("dblclick", (e) => {
        const t = e.target;
        if (t && typeof t.closest === "function" && t.closest("a, .qm-tag, .qm-more, .qm-rv-more, .qm-append-badge, button, textarea")) {
          return;
        }
        if (e.preventDefault) e.preventDefault();
        this.beginEdit(card);
      });
      if (this.editingKey === key) {
        this.renderEditBox(box, card, key, sections.original);
        continue;
      }
      const bodyEl = box.createDiv({ cls: "qm-rv-body" });
      this.renderCardBody(bodyEl, card, sections.original);
      if (sections.appends.length && this.appendOpen.has(key)) {
        this.renderAppendList(box, card, sections, key);
      }
      if (this.appendDrafting && this.appendDrafting.key === key) {
        this.renderAppendComposer(box, card, key);
      }
    }
  }
  /** 回看里存的是一批旧对象：卡片被改 / 删后换成本轮的新对象，找不到就移除 */
  syncReviewCards() {
    if (!Array.isArray(this.reviewCards)) return;
    const used = /* @__PURE__ */ new Set();
    const next = [];
    for (const old of this.reviewCards) {
      const want = this.cardKey(old);
      let hit = this.cards.find((c) => !used.has(this.cardKey(c)) && this.cardKey(c) === want);
      if (!hit) {
        hit = this.cards.find(
          (c) => !used.has(this.cardKey(c)) && c.filePath === old.filePath && c.date === old.date && c.time === old.time
        );
      }
      if (!hit) continue;
      used.add(this.cardKey(hit));
      next.push(hit);
    }
    this.reviewCards = next;
  }
  openCardMenu(cardEl, card, anchorBtn) {
    const info = this.noval.refSummary ? this.noval.refSummary(card) : null;
    const n = info ? info.notes : 0;
    const anchor = anchorBtn || cardEl.querySelector(".qm-more");
    const items = [
      {
        title: "\u590D\u5236\u5168\u6587",
        icon: "copy",
        onClick: async () => {
          await this.noval.copy(NovalBundle2.qmPasteText(card.body));
          new Notice2("\u5DF2\u590D\u5236\u5361\u7247\u5168\u6587");
        }
      },
      { title: "\u590D\u5236\u94FE\u63A5", icon: "link", onClick: () => this.copyRef(card) },
      { title: "\u7F16\u8F91", icon: "pencil", onClick: () => this.beginEdit(card) },
      { title: "\u8FFD\u52A0", icon: "plus", onClick: () => this.beginAppend(card) },
      {
        title: "AI \u6253\u6807\u7B7E",
        icon: "sparkles",
        onClick: () => openTagBar(this, cardEl, card)
      },
      { separator: true }
    ];
    if (this.noval.refsReady && !this.noval.refsReady()) {
      items.push({ title: "\u5F15\u7528\u7EDF\u8BA1\u51C6\u5907\u4E2D\u2026", icon: "corner-down-right", disabled: true });
    } else if (n) {
      items.push({
        title: "\u88AB " + n + " \u7BC7\u7B14\u8BB0\u5F15\u7528\u2026",
        icon: "corner-down-right",
        onClick: () => new NovalBundle2.RefListModal(this.app, info, (r) => this.openRef(r.path, r.line)).open()
      });
    } else {
      items.push({
        title: "\u8FD8\u6CA1\u6709\u7B14\u8BB0\u5F15\u7528\u8FD9\u5F20\u5361\u7247",
        icon: "corner-down-right",
        disabled: true
      });
    }
    items.push({
      title: "\u5728\u6587\u4EF6\u4E2D\u5B9A\u4F4D",
      icon: "file-search",
      onClick: () => this.locateCard(card)
    });
    items.push({ separator: true });
    items.push({
      title: "\u5220\u9664",
      icon: "trash-2",
      danger: true,
      onClick: () => this.confirmDelete(card)
    });
    return this.showMenu(items, anchor);
  }
  /** 复制块链接：跟随「嵌入」开关，与 Noval 一致 */
  async copyRef(card) {
    const hadId = !!card.id && card.idOnLastLine;
    const id = await this.noval.ensureId(card);
    if (!id) {
      new Notice2("\u6CA1\u627E\u5230\u8FD9\u5F20\u5361\u7247\uFF0C\u8BF7\u6539\u7528\u300C\u590D\u5236\u5168\u6587\u300D");
      return;
    }
    const bang = this.noval.settings.blockRefEmbed ? "!" : "";
    const ref = bang + "[[" + this.noval.linkTarget(card) + "#^" + id + "]]";
    await this.noval.copy(ref);
    new Notice2(
      (hadId ? "\u5DF2\u590D\u5236\uFF1A" : "\u5DF2\u4E3A\u8FD9\u6761\u5361\u7247\u8865\u4E0A\u5757 ID\uFF0C\u5DF2\u590D\u5236\uFF1A") + ref,
      7e3
    );
  }
  /** 跳到引用这张卡片的那篇笔记（新标签页打开） */
  async openRef(path, line) {
    const file = this.app.vault.getAbstractFileByPath(String(path || ""));
    if (!(file instanceof TFile)) {
      new Notice2("\u8FD9\u7BC7\u7B14\u8BB0\u627E\u4E0D\u5230\u4E86\uFF0C\u53EF\u80FD\u5DF2\u5220\u9664\u6216\u6539\u540D");
      return;
    }
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      const opts = typeof line === "number" && line >= 0 ? { eState: { line } } : void 0;
      await leaf.openFile(file, opts);
    } catch (e) {
      new Notice2("\u6253\u4E0D\u5F00\u8FD9\u7BC7\u7B14\u8BB0\uFF1A" + (e && e.message ? e.message : "\u672A\u77E5\u539F\u56E0"));
    }
  }
  beginEdit(card) {
    if (this.selectMode) {
      new Notice2("\u5148\u9000\u51FA\u591A\u9009\uFF0C\u518D\u7F16\u8F91\u5361\u7247");
      return;
    }
    const key = this.cardKey(card);
    if (this.editingKey === key) return;
    this.editingKey = key;
    this.editingDraft = {
      key,
      text: NovalBundle2.qmCardSections(String(card.body || "")).original
    };
    this.renderAll();
  }
  cancelEdit() {
    this.editingKey = null;
    this.editingDraft = null;
    this.renderAll();
  }
  /** 列表与回看共用一次刷新：回看打开时两个都要重画 */
  renderAll() {
    this.renderList();
    if (this.reviewEl && this.reviewEl.hasClass("show")) this.renderReview();
  }
  /** 在月份文件里定位到这张卡所在的那一行 */
  async locateCard(card) {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) {
      new Notice2("\u8FD9\u5F20\u5361\u7247\u6240\u5728\u7684\u6587\u4EF6\u627E\u4E0D\u5230\u4E86");
      return;
    }
    let hit = null;
    try {
      const text = String(await this.app.vault.read(file) || "").replace(/\r\n?/g, "\n");
      hit = NovalBundle2.qmLocateCard(text, card, {
        strict: this.noval.settings.strictCardId !== false
      });
    } catch (e) {
      hit = null;
    }
    if (!hit) {
      new Notice2("\u5361\u7247\u4F4D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u5237\u65B0\u540E\u518D\u8BD5");
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    if (!leaf || typeof leaf.openFile !== "function") {
      new Notice2("\u6253\u4E0D\u5F00\u8FD9\u4E2A\u6587\u4EF6");
      return;
    }
    await leaf.openFile(file, { eState: { line: hit.lineIndex } });
    const view = leaf.view;
    if (view && view.editor) {
      const from = { line: hit.lineIndex, ch: 0 };
      const to = { line: hit.lineEnd, ch: 0 };
      view.editor.setCursor(from);
      view.editor.scrollIntoView({ from, to }, true);
      view.editor.focus();
    }
  }
  confirmDelete(card) {
    const info = this.noval.refSummary ? this.noval.refSummary(card) : null;
    const n = info ? info.notes : 0;
    const detail = n ? "\u8FD9\u5F20\u5361\u8FD8\u88AB " + n + " \u7BC7\u7B14\u8BB0\u5F15\u7528\uFF0C\u5220\u9664\u540E\u8FD9\u4E9B\u5F15\u7528\u4F1A\u5931\u6548\u3002" : "";
    new NovalBundle2.ConfirmModal(
      this.app,
      "\u5220\u9664\u8FD9\u6761\u5361\u7247\uFF1F",
      async () => {
        await this.noval.deleteCard(card);
        await this.reloadCards();
      },
      detail
    ).open();
  }
  closeCardMenu() {
    if (this.cardMenu) this.cardMenu.remove();
    this.cardMenu = null;
  }
  /* ---------------- 动作 ---------------- */
  async capture() {
    const text = this.input ? this.input.value.trim() : "";
    if (!text) return;
    if (!this.noval || typeof this.noval.appendCard !== "function") {
      new Notice2("Noval \u6CA1\u6709\u52A0\u8F7D\u6210\u529F\uFF0C\u6682\u65F6\u4E0D\u80FD\u8BB0\u5F55");
      return;
    }
    this.saveBtn.disabled = true;
    this.saveBtn.classList.add("is-disabled");
    let ok = false;
    try {
      ok = await this.noval.appendCard(text);
    } catch (e) {
      console.error("[noval] \u5199\u5165\u5361\u7247\u5931\u8D25", e);
    }
    if (ok) {
      this.input.value = "";
      this.input.style.height = "";
    }
    this.saveBtn.disabled = false;
    this.saveBtn.classList.remove("is-disabled");
    if (!this.input.value.trim()) {
      this.saveBtn.disabled = true;
      this.saveBtn.classList.add("is-disabled");
    }
    this.reloadCards();
  }
  openCard(card, newLeaf) {
    if (!card || !card.filePath) return;
    const ref = card.id ? card.filePath + "#^" + card.id : card.filePath;
    try {
      this.app.workspace.openLinkText(ref, "", "tab");
    } catch (e) {
      this.app.workspace.openLinkText(card.filePath, "", "tab");
    }
  }
  openSidebar() {
    if (this.hostView && this.hostView.openNoval) {
      this.hostView.openNoval();
      return;
    }
    this.app.commands.executeCommandById("noval:open-cards");
  }
};
module.exports = { NovalNotesPanel: NovalNotesPanel2 };
