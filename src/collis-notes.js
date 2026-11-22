/** 卡片笔记面板：把 Collis 侧栏的卡片视图复刻进工作台主区域。
 *
 *  数据读写直接交给内置的 Collis 插件实例（readAllCards / appendCard），
 *  所以卡片格式、月份文件、块 ID 都与右侧栏完全一致。
 *  面板本身只负责排版和交互，不碰存储层。
 */

const { Notice, setIcon, TFile } = require("obsidian");
const CollisBundle = require("../vendor/collis-core.js");

/** 与 Collis 原版完全一致的图标（qmIcon 里那份 SVG） */
const ICONS = {
  search:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  review:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4.3l2.8 1.7"/></svg>',
  filter:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/></svg>',
  more:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  back:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
};

function setIconHtml(parent, name) {
  if (parent && ICONS[name]) parent.innerHTML = ICONS[name];
}

function daysAgo(date) {
  const parts = String(date || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return 0;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - target) / 86400000));
}

const TAG_RE = /#([^\s#\[\]()]+)/g;

class CollisNotesPanel {
  constructor(app, collis, hostView) {
    this.app = app;
    this.collis = collis;
    this.hostView = hostView || null;

    this.container = null;
    this.listWrap = null;
    this.subEl = null;
    this.pop = null;
    this.popOwner = null;
    this.cardMenu = null;
    // 「更多」菜单 / 多选：与 Collis 同一套状态
    this.menuEl = null;
    this.menuAnchor = null;
    this._menuKey = null;
    this.selectMode = false;
    this.selected = new Set();
    this.selBarEl = null;
    this._selInfoEl = null;
    this._selDelEl = null;
    // 行内编辑：与 Collis 同一套 key / 草稿
    this.editingKey = null;
    this.editingDraft = null;
    // 追加区：哪些卡片展开着、正在写哪条、正在改哪条
    this.appendOpen = new Set();
    this.appendDrafting = null;
    this.appendEditing = null;

    this.cards = [];
    this.query = "";
    // 筛选状态与 Collis 完全一致：引用情况 / 多选标签 / 无标签
    this.refFilter = "";
    this.tags = [];
    this.untagged = false;
    this.expanded = {};
    this.collapsed = new Set();

    this._loading = false;
    this._pending = false;
    this._outside = null;
    // 从首页点某条速记进来时，记住要定位的卡片
    this.pendingFocus = null;
  }

  /* ---------------- 生命周期 ---------------- */

  mount(containerEl) {
    // 同一实例可能被重复挂载（顶部刷新会重建整页），先清掉旧的监听与弹层。
    if (this._outside) document.removeEventListener("mousedown", this._outside);
    this._outside = null;
    this.closeMenu();
    this.closePop();
    this.closeCardMenu();

    this.container = containerEl;
    this.container.empty();
    this.container.addClass("wb-notes-panel");
    // 借用 Collis 的按钮 / 卡片样式作用域（.qm-view 前缀规则）。
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
    this.closeMenu();
    this.closePop();
    this.closeCardMenu();
    if (this.container) this.container.empty();
    this.container = null;
    this.listWrap = null;
    this.subEl = null;
    this.cards = [];
  }

  /* ---------------- 结构 ---------------- */

  buildHead() {
    // 页面顶部不再放标题，直接是搜索与工具按钮这一排。
    // 尺寸全部交给样式表：内联 width / flex 会盖掉窄视图下的自适应规则。
    const head = this.container.createDiv({ cls: "wb-notes-head" });
    head.style.position = "relative";
    const actions = head.createDiv({ cls: "wb-notes-actions wb-notes-toolrow" });
    actions.style.position = "relative";
    this.headEl = head;
    this.toolrow = actions;

    const box = actions.createDiv({ cls: "qm-searchbox wb-notes-search" });
    const searchIcon = box.createDiv({ cls: "qm-search-ico" });
    setIconHtml(searchIcon, "search");
    const search = box.createEl("input", {
      cls: "qm-search",
      attr: { type: "text", placeholder: "搜索卡片、#标签、日期" }
    });
    this.search = search;
    const clear = box.createEl("button", { cls: "qm-search-clear", text: "×" });
    this.clearBtn = clear;

    search.addEventListener("input", () => {
      this.query = search.value;
      clear.classList.toggle("is-visible", !!search.value);
      this.renderList();
      if (this.pop) this.renderFilterPanel();
    });
    clear.onclick = () => {
      search.value = "";
      this.query = "";
      clear.classList.remove("is-visible");
      search.focus();
      this.renderList();
    };

    // 三个按钮完全按 Collis 原版：类名、图标、aria / title 都一致
    const reviewBtn = this.iconButton(actions, "review", "回看", "回看（翻几张旧卡片）");
    reviewBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.openReview();
    };

    const filterBtn = this.iconButton(actions, "filter", "筛选", "筛选");
    this.filterBtn = filterBtn;
    this.filterDot = filterBtn.createSpan({ cls: "qm-filter-dot is-hidden" });
    filterBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.openFilterPanel();
    };

    const moreBtn = this.iconButton(actions, "more", "更多", "更多");
    this.moreBtn = moreBtn;
    moreBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.openMoreMenu();
    };
  }

  buildBody() {
    const body = this.container.createDiv({ cls: "wb-notes-body" });

    // 生效条件 chips：紧贴搜索行下方，和 Collis 一致
    this.chipsEl = body.createDiv({ cls: "qm-chips" });

    // 记录输入块
    const composer = body.createDiv({ cls: "qm-composer" });
    const input = composer.createEl("textarea", {
      cls: "qm-input",
      attr: { placeholder: "记录一下…", rows: "1", spellcheck: "false" }
    });
    this.input = input;

    const foot = composer.createDiv({ cls: "qm-composer-foot" });
    foot.createDiv({ cls: "qm-kbd-hint", text: "Ctrl+Enter 记下" });
    const save = foot.createEl("button", { cls: "qm-save is-disabled", text: "记下" });
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

    // 卡片列表
    this.listWrap = body.createDiv({ cls: "wb-notes-listwrap" });

    // 多选浮条：与 Collis 同一个 .qm-selbar
    this.selBarEl = body.createDiv({ cls: "qm-selbar" });

    // 回看：和 Collis 一样是覆盖在内容区上的视图
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
    if (!this.container) return;
    if (this._loading) {
      this._pending = true;
      return;
    }
    if (!this.collis || typeof this.collis.readAllCards !== "function") {
      if (this.subEl) this.subEl.setText("Collis 没有加载成功，请查看控制台日志。");
      return;
    }

    this._loading = true;
    let cards = [];
    try {
      cards = await this.collis.readAllCards();
    } catch (e) {
      console.error("[workbench] 读取卡片失败", e);
      cards = [];
    }
    this._loading = false;

    if (!this.container) return;
    this.cards = Array.isArray(cards) ? cards : [];
    this.renderList();
    this.applyPendingFocus();

    // 回看打开着：把内存里那批旧对象换成本轮的新卡片，否则编辑 / 追加改的还是旧内容
    if (this.reviewEl && this.reviewEl.hasClass("show")) {
      this.syncReviewCards();
      this.renderReview();
    }

    if (this._pending) {
      this._pending = false;
      this.load();
    }
  }

  refresh() {
    this.load();
  }

  /** 首页点速记时调用：切到卡片笔记后定位到这一条。 */
  focusCard(card) {
    if (!card) return;
    this.pendingFocus = card;
    // 正在读卡片时先记下来，等 load() 完成后再定位
    if (this.container && !this._loading && this.cards.length) this.applyPendingFocus();
  }

  applyPendingFocus() {
    const card = this.pendingFocus;
    if (!card || !this.listWrap || this._loading) return;

    // 先把可能挡住这张卡的搜索与筛选清掉，再展开它所在的日期组
    let changed = false;
    if (this.query) {
      this.query = "";
      if (this.search) this.search.value = "";
      if (this.clearBtn) this.clearBtn.classList.remove("is-visible");
      changed = true;
    }
    if (this.refFilter || (this.tags && this.tags.length) || this.untagged) {
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
        new Notice("这条速记已不在当前卡片列表里，可能刚被删除或改过时间。");
        return;
      }
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.addClass("is-focused");
      const badge = target.createDiv({ cls: "qm-focus-badge", text: "已定位" });
      new Notice(
        "已定位到 " +
        (card.date ? card.date.slice(5) + " " : "") +
        (card.time || "") +
        " 的速记"
      );
      window.setTimeout(() => {
        target.removeClass("is-focused");
        badge.remove();
      }, 3600);
    }, 60);
  }

  filteredCards() {
    const raw = String(this.query || "").trim().toLowerCase();
    // 「#标签」只搜标签，普通词搜正文 / 标签 / 日期
    const tagQuery = raw.startsWith("#") ? raw.slice(1) : "";
    const ref = this.effectiveRefFilter();

    return this.cards.filter((card) => {
      // 引用情况
      if (ref) {
        const n = this.refCount(card);
        if (ref === "has" && n === 0) return false;
        if (ref === "none" && n > 0) return false;
      }
      // 无标签 / 标签多选（选父标签时包含子标签）
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

      return (
        String(card.bodyLower || "").includes(raw) ||
        lowerTags.some((t) => t.includes(raw)) ||
        String(card.date || "").includes(raw)
      );
    });
  }

  /** 生效条件数：搜索词也算一条，和 Collis 一致 */
  activeFilterCount() {
    return (
      (String(this.query || "").trim() ? 1 : 0) +
      (this.refFilter ? 1 : 0) +
      this.tags.length +
      (this.untagged ? 1 : 0)
    );
  }

  /** 引用筛选实际生效值：索引没建好时按「全部」 */
  effectiveRefFilter() {
    if (!this.refFilter) return "";
    if (!this.collis || typeof this.collis.refsReady !== "function") return "";
    return this.collis.refsReady() ? this.refFilter : "";
  }

  refCount(card) {
    if (!this.collis || typeof this.collis.refCount !== "function") return 0;
    try {
      return this.collis.refCount(card) || 0;
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
      new Notice("已包含在 #" + anc + " 里");
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

  /** 正文里点标签：只用这一个标签筛选，换掉原来的多选条件（与 Collis 侧栏一致） */
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
    const root = new Map();
    let untagged = 0;

    for (const card of this.cards) {
      const tags = card.tags || [];
      if (!tags.length) {
        untagged += 1;
        continue;
      }
      const seen = new Set();
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
            node = { key, label: part, path: acc, count: 0, children: new Map() };
            level.set(key, node);
          }
          // 同一张卡里父子标签都写了时，各层只算一次
          if (!seen.has(key)) {
            node.count += 1;
            seen.add(key);
          }
          level = node.children;
        }
      }
    }

    const toArray = (map) =>
      [...map.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .map((n) => ({ ...n, children: toArray(n.children) }));

    return { tree: toArray(root), untagged };
  }

  /* ---------------- 生效条件 chips ---------------- */

  countDescendants(node) {
    let n = 0;
    for (const ch of (node && node.children) || []) {
      n += 1 + this.countDescendants(ch);
    }
    return n;
  }

  chipParts() {
    const parts = [];

    // 搜索也算一条生效条件，和 Collis 一样
    const kw = String(this.query || "").trim();
    if (kw) {
      parts.push({
        text: "\u201c" + kw + "\u201d",
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
        text: this.refFilter === "has" ? "已引用" : "未引用",
        sub: "",
        clear: () => this.setRefFilter("")
      });
    }

    if (this.untagged) {
      parts.push({
        text: "无标签",
        sub: "",
        clear: () => {
          this.untagged = false;
          this.afterFilterChange();
        }
      });
    }

    const forest = this.tagForest();
    const index = new Map();
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
        sub: kids ? "含 " + kids : "",
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

    // 一行放不下就折成 +N：点它去筛选面板看全
    const MAX = 5;
    const shown = parts.slice(0, MAX);
    for (const p of shown) {
      const chip = el.createSpan({ cls: "qm-chip" });
      chip.createSpan({ text: p.text });
      if (p.sub) chip.createEl("em", { text: p.sub });
      const x = chip.createEl("button", { text: "\u00d7" });
      x.setAttribute("type", "button");
      x.setAttribute("aria-label", "清除");
      x.onclick = (e) => {
        e.stopPropagation();
        p.clear();
      };
    }

    const rest = parts.length - shown.length;
    if (rest > 0) {
      const more = el.createSpan({ cls: "qm-chip qm-chip-more", text: "+" + rest });
      more.setAttribute("title", "还有 " + rest + " 个条件");
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

  renderList() {
    if (!this.listWrap) return;
    this.closeCardMenu();
    // 列表重画后旧菜单的锚点就失效了，先收起来
    this.closeMenu();

    const cards = this.filteredCards();
    // 有生效条件时按钮常亮并带小圆点，和 Collis 一致
    this.renderFilterBtnState();
    this.renderChips();
    this.renderSelectBar();

    const keepScroll = this.listWrap.scrollTop;
    this.listWrap.empty();

    if (!cards.length) {
      const empty = this.listWrap.createDiv({ cls: "qm-empty" });
      empty.setText(
        this.cards.length
          ? "没有匹配的卡片。换个词，或者清除筛选。"
          : "还没有卡片。在上面写点什么，Ctrl+Enter 记下。"
      );
      return;
    }

    this.renderCards(cards);

    this.listWrap.scrollTop = keepScroll;
  }

  renderCards(cards) {
    const list = this.listWrap.createDiv({ cls: "qm-list" });
    const searching = !!this.query.trim();

    let i = 0;
    while (i < cards.length) {
      const date = cards[i].date;
      const group = [];
      while (i < cards.length && cards[i].date === date) {
        group.push(cards[i]);
        i++;
      }

      const collapsed = !searching && this.collapsed.has(date);
      const day = list.createDiv({ cls: "qm-day" + (collapsed ? " is-collapsed" : "") });
      day.createSpan({ cls: "qm-day-arrow", text: collapsed ? "\u25b6" : "\u25bc" });
      day.createSpan({ cls: "qm-day-text", text: date });
      day.createSpan({ cls: "qm-day-count", text: String(group.length) });
      day.onclick = () => {
        if (this.collapsed.has(date)) this.collapsed.delete(date);
        else this.collapsed.add(date);
        this.renderList();
      };

      if (collapsed) continue;
      for (const card of group) this.renderCard(list, card);
    }
  }

  renderCard(list, card) {
    const key = this.cardKey(card);
    const picked = this.selectMode && this.selected.has(key);
    const editing = this.editingKey === key;
    // 正文按标记行拆成「原始内容 + 各条追加」，追加默认收起
    const sections = CollisBundle.qmCardSections(card.body);
    const el = list.createDiv({ cls: "qm-card" + (picked ? " is-picked" : "") });
    // 定位用的坐标：日期 + 时间 + 块 ID，不依赖 file 字段的类型差异
    el.setAttribute("data-qm-date", card.date || "");
    el.setAttribute("data-qm-time", card.time || "");
    el.setAttribute("data-qm-id", card.id || "");
    if (this.selectMode) el.addClass("is-selectable");

    const head = el.createDiv({ cls: "qm-card-head" });
    // 勾号和 Collis 一样放在时间里侧，靠 .is-picked 控制显隐
    if (this.selectMode) head.createSpan({ cls: "qm-tick", text: "\u2713" });
    head.createSpan({ cls: "qm-time", text: card.time || "" });
    // 时间后面的引用小红点：和 Collis 的 mountRefDot 一致
    const refDot = head.createSpan({ cls: "qm-ref" });
    this.paintRefDot(refDot, card);

    // 「追加 N」徽标：只有存在追加时才出现，点一下展开 / 收起
    if (sections.appends.length) {
      const badge = head.createSpan({
        cls: "qm-append-badge",
        text: "追加 " + sections.appends.length
      });
      badge.setAttribute("role", "button");
      badge.onclick = (ev) => {
        ev.stopPropagation();
        if (this.appendOpen.has(key)) this.appendOpen.delete(key);
        else this.appendOpen.add(key);
        this.renderList();
      };
    }

    const more = head.createEl("button", { cls: "qm-more" });
    more.setAttribute("type", "button");
    more.setAttribute("aria-label", "更多操作");
    more.setAttribute("title", "更多操作");
    setIconHtml(more, "more");
    more.onclick = (ev) => {
      ev.stopPropagation();
      this.openCardMenu(el, card, ev.currentTarget || more);
    };

    if (editing) {
      this.renderEditBox(el, card, key, sections.original);
      el.onclick = (e) => e.stopPropagation();
      return;
    }

    const bodyEl = el.createDiv({ cls: "qm-body" });
    this.renderCardBody(bodyEl, card, sections.original);

    if (sections.appends.length && this.appendOpen.has(key)) {
      this.renderAppendList(el, card, sections, key);
    }
    if (this.appendDrafting && this.appendDrafting.key === key) {
      this.renderAppendComposer(el, card, key);
    }

    // 单击不做事；双击进编辑。多选模式下单击用于勾选。
    el.onclick = () => {
      if (this.selectMode) this.toggleSelected(card, el);
    };

    // 与 Collis bindCardEdit 一致：链接、标签、「···」、引用点保持原生语义
    el.addEventListener("dblclick", (e) => {
      if (this.selectMode) return;
      const t = e.target;
      if (
        t &&
        typeof t.closest === "function" &&
        t.closest("a, .qm-tag, .qm-more, .qm-ref, .qm-append-badge, button, textarea")
      ) {
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
    const cancel = bar.createEl("button", { cls: "qm-mini-btn", text: "取消" });
    cancel.onclick = (e) => {
      e.stopPropagation();
      this.cancelEdit();
    };
    const save = bar.createEl("button", { cls: "qm-mini-btn is-primary", text: "保存" });
    save.onclick = async (e) => {
      e.stopPropagation();
      const text = this.editingDraft && this.editingDraft.key === key
        ? this.editingDraft.text
        : ta.value;
      if (!String(text || "").trim()) {
        new Notice("内容不能为空");
        return;
      }
      const ok = await this.collis.updateCard(card, text);
      if (!ok) {
        new Notice("保存失败，卡片位置可能已变化");
        return;
      }
      this.editingKey = null;
      this.editingDraft = null;
      await this.load();
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

      const editing =
        this.appendEditing &&
        this.appendEditing.key === key &&
        this.appendEditing.index === index;

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
        const cancel = editBar.createEl("button", { cls: "qm-mini-btn", text: "取消" });
        cancel.onclick = (ev) => {
          ev.stopPropagation();
          this.appendEditing = null;
          this.renderAll();
        };
        const save = editBar.createEl("button", { cls: "qm-mini-btn is-primary", text: "保存" });
        save.onclick = async (ev) => {
          ev.stopPropagation();
          const text = this.appendEditing && this.appendEditing.key === key
            ? this.appendEditing.text
            : ta.value;
          const ok = await this.collis.updateAppend(card, index, text);
          if (!ok) return;
          this.appendEditing = null;
          await this.load();
        };
        return;
      }

      const acts = bar.createDiv({ cls: "qm-append-acts" });
      const edit = acts.createEl("button", { cls: "qm-mini-btn", text: "编辑" });
      edit.onclick = (ev) => {
        ev.stopPropagation();
        this.beginAppendEdit(card, index, item.text);
      };
      const del = acts.createEl("button", {
        cls: "qm-mini-btn qm-mini-btn-danger",
        text: "删除"
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
    this.renderAll();
  }

  confirmDeleteAppend(card, index) {
    new CollisBundle.ConfirmModal(this.app, "删除这条追加？", async () => {
      const ok = await this.collis.deleteAppend(card, index);
      if (!ok) return;
      this.appendEditing = null;
      await this.load();
    }).open();
  }

  /** 从「···」进追加：展开这张卡并就地放一个输入框 */
  beginAppend(card) {
    const key = this.cardKey(card);
    this.appendDrafting = { key, text: "" };
    this.appendOpen.add(key);
    this.renderAll();
  }

  renderAppendComposer(el, card, key) {
    const wrap = el.createDiv({ cls: "qm-append-composer" });
    const ta = wrap.createEl("textarea", {
      cls: "qm-input qm-append-input",
      attr: { rows: "2", placeholder: "追加一段…" }
    });
    ta.value = this.appendDrafting && this.appendDrafting.key === key
      ? this.appendDrafting.text
      : "";
    ta.addEventListener("input", () => {
      if (this.appendDrafting && this.appendDrafting.key === key) {
        this.appendDrafting.text = ta.value;
      }
    });
    window.setTimeout(() => ta.focus(), 20);

    const bar = wrap.createDiv({ cls: "qm-append-bar" });
    bar.createDiv({ cls: "qm-kbd-hint", text: "Ctrl+Enter 追加" });

    const cancel = () => {
      this.appendDrafting = null;
      this.renderAll();
    };
    const cancelBtn = bar.createEl("button", { cls: "qm-mini-btn", text: "取消" });
    cancelBtn.onclick = (ev) => {
      ev.stopPropagation();
      cancel();
    };
    const save = bar.createEl("button", { cls: "qm-mini-btn is-primary", text: "追加" });
    save.onclick = async (ev) => {
      ev.stopPropagation();
      const text = this.appendDrafting && this.appendDrafting.key === key
        ? this.appendDrafting.text
        : ta.value;
      if (!String(text || "").trim()) {
        new Notice("写点什么再追加吧");
        return;
      }
      const ok = await this.collis.appendToCard(card, text);
      if (!ok) return;
      this.appendDrafting = null;
      this.appendOpen.add(key);
      await this.load();
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

  /** 引用小红点：数字与提示文案都与 Collis 的 paintRefDot 一致 */
  paintRefDot(el, card) {
    if (!el) return;
    const info = this.collis.refSummary ? this.collis.refSummary(card) : null;
    const n = info ? info.notes : 0;
    if (!n) {
      el.addClass("is-hidden");
      el.setAttribute("title", "");
      return;
    }
    el.removeClass("is-hidden");

    const places = info.places || n;
    const lines = [
      "被 " + n + " 篇笔记引用" + (places > n ? " · 共 " + places + " 处" : "")
    ];
    const names = info.names || [];
    for (const nm of names.slice(0, 8)) lines.push("· " + nm);
    if (names.length > 8) lines.push("· …还有 " + (names.length - 8) + " 篇");
    if (info.ambiguous) lines.push("（有同名文件，链接可能指错，注意）");
    el.setAttribute("title", lines.join("\n"));
  }

  renderCardBody(bodyEl, card, textOverride) {
    const text = textOverride != null
      ? String(textOverride)
      : CollisBundle.qmCardSections(String(card.body || "")).original;
    TAG_RE.lastIndex = 0;
    let last = 0;
    let match;
    while ((match = TAG_RE.exec(text)) !== null) {
      if (match.index > last) {
        bodyEl.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      // 必须在循环体内用 const 接住当次匹配：否则 onclick 闭包拿到的是
      // 循环结束后的 match（已为 null），点标签会抛错、筛选与 chips 都不生效。
      const tagValue = match[1];
      const tag = bodyEl.createSpan({ cls: "qm-tag", text: match[0] });
      if (!this.selectMode) {
        tag.onclick = (ev) => {
          ev.stopPropagation();
          // 与侧栏 Collis 一致：正文点标签 = 只用这一个标签筛选（换掉原条件）
          this.setFilterTags([tagValue]);
        };
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
    const pop = this.toolrow.createDiv({ cls: "wb-notes-pop" });
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

  /* ---------------- 筛选浮层（与 Collis 同一套 DOM / 逻辑） ---------------- */

  openFilterPanel() {
    if (this.pop && this.popOwner === this.filterBtn) {
      this.closePop();
      return;
    }
    // 菜单和筛选浮层都贴着右侧，同时挂着会打架
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

    el.createDiv({ cls: "qm-pop-title", text: "筛选" });

    /* ---- 引用情况 ---- */
    el.createDiv({ cls: "qm-pop-label", text: "引用情况" });
    const seg = el.createDiv({ cls: "qm-seg" });
    const refOpts = [["", "全部"], ["has", "已引用"], ["none", "未引用"]];
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

    /* ---- 标签 ---- */
    const lab = el.createDiv({ cls: "qm-pop-label" });
    lab.createSpan({ text: "标签" });
    if (this.tags.length) {
      lab.createSpan({ cls: "qm-pop-sel", text: "已选 " + this.tags.length });
    }

    const treeWrap = el.createDiv({ cls: "qm-tree-wrap" });
    const tree = treeWrap.createDiv({ cls: "qm-tagtree" });
    this.treeEl = tree;
    tree.addEventListener("scroll", () => this.updateTreeMore());

    const forest = this.tagForest();

    // 「无标签」单独一行，和 Collis 一致
    const un = tree.createDiv({
      cls: "qm-tnode qm-tnode-untagged" + (this.untagged ? " is-on" : "")
    });
    un.setAttribute("title", "只看没有写标签的卡片");
    un.createSpan({ cls: "qm-caret is-blank" });
    un.createSpan({ cls: "qm-tname", text: "无标签" });
    un.createSpan({ cls: "qm-tcount", text: String(forest.untagged) });
    un.createSpan({ cls: "qm-tmark", text: "\u2713" });
    un.onclick = () => {
      this.untagged = !this.untagged;
      if (this.untagged) this.tags = [];
      this.afterFilterChange();
    };

    for (const node of forest.tree) this.renderTagNode(tree, node, 0);

    /* ---- 底部 ---- */
    const foot = el.createDiv({ cls: "qm-pop-foot" });
    const clear = foot.createEl("button", { cls: "qm-link-btn", text: "清除筛选" });
    clear.setAttribute("type", "button");
    clear.onclick = (e) => {
      e.stopPropagation();
      this.clearFilters();
    };
    const n = this.activeFilterCount();
    foot.createSpan({
      cls: "qm-pop-note",
      text: n ? "已生效 " + n + " 项" : "没有生效的筛选"
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
      cls:
        "qm-tnode" +
        (sel ? " is-on" : "") +
        (some ? " is-some" : "") +
        (covered ? " is-inherit" : "") +
        (depth ? " is-child" : "")
    });
    row.setAttribute("title", "#" + node.path + " \u00b7 " + node.count + " 条");

    const caret = row.createSpan({
      cls: "qm-caret" + (kids ? "" : " is-blank"),
      text: kids ? (open ? "\u25be" : "\u25b8") : ""
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
        new Notice("已包含在 #" + this.selectedAncestorPath(key) + " 里");
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
    // 与 Collis 的 openMoreMenu 同一份条目：计数行、多选、最近删除、本月文件、孤儿卡片
    const hit = this.filteredCards().length;
    const total = this.cards.length;
    const cap = (this.collis.settings && this.collis.settings.maxCards) || 0;
    const capNote = cap > 0 && hit > cap ? " \u00b7 显示最近 " + cap : "";
    const countLine =
      (hit === total ? "共 " + total + " 条卡片" : "共 " + total + " 条 \u00b7 命中 " + hit + " 条") + capNote;
    const n = ((this.collis.settings && this.collis.settings.trash) || []).length;

    const items = [
      { title: countLine, icon: "arrow-right", disabled: true },
      { separator: true },
      {
        title: this.selectMode ? "退出多选" : "多选",
        icon: "list-checks",
        onClick: () => this.toggleSelectMode()
      },
      {
        title: n ? "最近删除 " + n : "最近删除",
        icon: "trash-2",
        onClick: () => new CollisBundle.TrashModal(this.app, this.collis).open()
      },
      {
        title: "打开本月文件",
        icon: "file-text",
        onClick: () => this.collis.openCurrentMonthFile()
      },
      {
        title: "检查孤儿卡片",
        icon: "search-check",
        onClick: () => new CollisBundle.OrphanModal(this.app, this.collis).open()
      },
      { separator: true },
      {
        title: "在右侧栏打开",
        icon: "panel-right",
        onClick: () => this.openSidebar()
      }
    ];

    return this.showMenu(items, this.moreBtn);
  }

  /* ---------------- 「更多」菜单（复刻 Collis 的 showMenu） ---------------- */

  showMenu(items, anchor) {
    // 再点一次同一个按钮就是收起
    if (this.menuEl && this.menuAnchor === anchor) {
      this.closeMenu();
      return;
    }
    this.closeMenu();
    // 筛选浮层和菜单都贴着右侧，同时挂着会打架
    this.closePop();

    const menu = this.toolrow.createDiv({ cls: "qm-menu" });
    for (const it of items) {
      if (it.separator) {
        menu.createDiv({ cls: "qm-menu-sep" });
        continue;
      }
      const row = menu.createDiv({
        cls:
          "qm-menu-item" +
          (it.disabled ? " is-disabled" : "") +
          (it.danger ? " is-danger" : "")
      });
      const ico = row.createSpan({ cls: "qm-menu-ico" });
      if (it.icon) setIcon(ico, it.icon);
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

    // 贴着按钮右下角；下方放不下就翻到按钮上方，和 qmMenuPlace 的行为一致
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

  /* ---------------- 多选（与 Collis 同一套交互） ---------------- */

  cardKey(card) {
    return (
      (card.file ? card.file.path : "") +
      "|" +
      card.date +
      "|" +
      card.time +
      "|" +
      (card.id || String(card.body || "").slice(0, 24))
    );
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
    if (this._selInfoEl) this._selInfoEl.setText("已选 " + n + " 条");
    if (this._selDelEl) {
      this._selDelEl.setText(n ? "删除所选 " + n : "删除所选");
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
    this._selInfoEl = el.createSpan({ cls: "qm-selbar-info", text: "已选 " + n + " 条" });

    const acts = el.createDiv({ cls: "qm-selbar-acts" });
    const cancel = acts.createEl("button", { text: "取消" });
    cancel.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      this.toggleSelectMode(false);
    };

    const del = acts.createEl("button", {
      cls: "is-danger",
      text: n ? "删除所选 " + n : "删除所选"
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
    new CollisBundle.ConfirmModal(
      this.app,
      "删除选中的 " + picked.length + " 条卡片？",
      async () => {
        const res = await this.collis.deleteCards(picked);
        this.selectMode = false;
        this.selected.clear();
        await this.load();
        if (res && res.deleted && res.failed) {
          new Notice("已删除 " + res.deleted + " 条，" + res.failed + " 条没找到已跳过", 9000);
        } else if (res && res.deleted) {
          new Notice("已删除 " + res.deleted + " 条，可在「最近删除」恢复", 9000);
        } else {
          new Notice("没有删除：卡片位置已变化，请刷新后重试", 9000);
        }
      },
      ""
    ).open();
  }

  /* ---------------- 回看（复刻 Collis 的覆盖视图） ---------------- */

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
    back.setAttribute("aria-label", "返回卡片");
    back.setAttribute("title", "返回卡片");
    setIconHtml(back, "back");
    back.onclick = () => this.closeReview();

    head.createSpan({ cls: "qm-review-title", text: "回看" });

    const shuffle = head.createEl("button", { cls: "qm-review-shuffle", text: "换一批" });
    shuffle.onclick = () => {
      this.pickReview();
      this.renderReview();
    };

    el.createDiv({
      cls: "qm-review-sub",
      text: this.reviewCards.length
        ? "随机翻 " + this.reviewCards.length + " 张旧卡片"
        : "卡片还不够，先去记几条吧"
    });

    const list = el.createDiv({ cls: "qm-review-list" });
    for (const card of this.reviewCards) {
      const key = this.cardKey(card);
      const sections = CollisBundle.qmCardSections(card.body);
      const box = list.createDiv({ cls: "qm-rv-card" });

      const rhead = box.createDiv({ cls: "qm-rv-head" });
      const meta = rhead.createDiv({ cls: "qm-rv-meta" });
      meta.createSpan({ text: String(card.date || "").slice(5) + " " + card.time });
      meta.createSpan({ cls: "qm-rv-sep", text: "·" });
      meta.createSpan({ text: daysAgo(card.date) + " 天前" });

      // 「追加 N」：与卡片列表同一枚徽标，默认收起
      if (sections.appends.length) {
        const badge = rhead.createSpan({
          cls: "qm-append-badge",
          text: "追加 " + sections.appends.length
        });
        badge.onclick = (ev) => {
          ev.stopPropagation();
          if (this.appendOpen.has(key)) this.appendOpen.delete(key);
          else this.appendOpen.add(key);
          this.renderReview();
        };
      }

      // 右上「···」：菜单与卡片列表完全一致，追加入口也在这里
      const more = rhead.createEl("button", { cls: "qm-rv-more" });
      more.setAttribute("type", "button");
      more.setAttribute("aria-label", "更多操作");
      setIconHtml(more, "more");
      more.onclick = (ev) => {
        ev.stopPropagation();
        this.openCardMenu(box, card, more);
      };

      // 单击不做事；双击进编辑（改的是原始内容）。追加区自己的按钮不抢双击
      box.addEventListener("dblclick", (e) => {
        const t = e.target;
        if (
          t &&
          typeof t.closest === "function" &&
          t.closest("a, .qm-tag, .qm-more, .qm-rv-more, .qm-append-badge, button, textarea")
        ) {
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
    const used = new Set();
    const next = [];
    for (const old of this.reviewCards) {
      const want = this.cardKey(old);
      let hit = this.cards.find((c) => !used.has(this.cardKey(c)) && this.cardKey(c) === want);
      if (!hit) {
        hit = this.cards.find(
          (c) =>
            !used.has(this.cardKey(c)) &&
            c.filePath === old.filePath &&
            c.date === old.date &&
            c.time === old.time
        );
      }
      if (!hit) continue;
      used.add(this.cardKey(hit));
      next.push(hit);
    }
    this.reviewCards = next;
  }

  openCardMenu(cardEl, card, anchorBtn) {
    const info = this.collis.refSummary ? this.collis.refSummary(card) : null;
    const n = info ? info.notes : 0;
    const anchor = anchorBtn || cardEl.querySelector(".qm-more");

    const items = [
      {
        title: "复制全文",
        icon: "copy",
        onClick: async () => {
          await this.collis.copy(CollisBundle.qmPasteText(card.body));
          new Notice("已复制卡片全文");
        }
      },
      { title: "复制链接", icon: "link", onClick: () => this.copyRef(card) },
      { title: "编辑", icon: "pencil", onClick: () => this.beginEdit(card) },
      { title: "追加", icon: "plus", onClick: () => this.beginAppend(card) },
      { separator: true }
    ];

    if (this.collis.refsReady && !this.collis.refsReady()) {
      // 索引还没建好时说清楚，别让人误以为「没被引用过」
      items.push({ title: "引用统计准备中…", icon: "corner-down-right", disabled: true });
    } else if (n) {
      items.push({
        title: "被 " + n + " 篇笔记引用…",
        icon: "corner-down-right",
        onClick: () =>
          new CollisBundle.RefListModal(this.app, info, (r) => this.openRef(r.path, r.line)).open()
      });
    } else {
      items.push({
        title: "还没有笔记引用这张卡片",
        icon: "corner-down-right",
        disabled: true
      });
    }

    items.push({
      title: "在文件中定位",
      icon: "file-search",
      onClick: () => this.locateCard(card)
    });
    items.push({ separator: true });
    items.push({
      title: "删除",
      icon: "trash-2",
      danger: true,
      onClick: () => this.confirmDelete(card)
    });

    return this.showMenu(items, anchor);
  }

  /** 复制块链接：跟随「嵌入」开关，与 Collis 一致 */
  async copyRef(card) {
    const hadId = !!card.id && card.idOnLastLine;
    const id = await this.collis.ensureId(card);
    if (!id) {
      new Notice("没找到这张卡片，请改用「复制全文」");
      return;
    }
    const bang = this.collis.settings.blockRefEmbed ? "!" : "";
    const ref = bang + "[[" + this.collis.linkTarget(card) + "#^" + id + "]]";
    await this.collis.copy(ref);
    new Notice(
      (hadId ? "已复制：" : "已为这条卡片补上块 ID，已复制：") + ref,
      7000
    );
  }

  /** 跳到引用这张卡片的那篇笔记（新标签页打开） */
  async openRef(path, line) {
    const file = this.app.vault.getAbstractFileByPath(String(path || ""));
    if (!(file instanceof TFile)) {
      new Notice("这篇笔记找不到了，可能已删除或改名");
      return;
    }
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      const opts =
        typeof line === "number" && line >= 0 ? { eState: { line } } : undefined;
      await leaf.openFile(file, opts);
    } catch (e) {
      new Notice("打不开这篇笔记：" + (e && e.message ? e.message : "未知原因"));
    }
  }

  beginEdit(card) {
    if (this.selectMode) {
      new Notice("先退出多选，再编辑卡片");
      return;
    }
    const key = this.cardKey(card);
    if (this.editingKey === key) return;
    this.editingKey = key;
    this.editingDraft = {
      key,
      text: CollisBundle.qmCardSections(String(card.body || "")).original
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
      new Notice("这张卡片所在的文件找不到了");
      return;
    }

    let hit = null;
    try {
      const text = String((await this.app.vault.read(file)) || "").replace(/\r\n?/g, "\n");
      hit = CollisBundle.qmLocateCard(text, card, {
        strict: this.collis.settings.strictCardId !== false
      });
    } catch (e) {
      hit = null;
    }
    if (!hit) {
      new Notice("卡片位置已变化，刷新后再试");
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    if (!leaf || typeof leaf.openFile !== "function") {
      new Notice("打不开这个文件");
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
    const info = this.collis.refSummary ? this.collis.refSummary(card) : null;
    const n = info ? info.notes : 0;
    const detail = n
      ? "这张卡还被 " + n + " 篇笔记引用，删除后这些引用会失效。"
      : "";
    new CollisBundle.ConfirmModal(
      this.app,
      "删除这条卡片？",
      async () => {
        await this.collis.deleteCard(card);
        await this.load();
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
    if (!this.collis || typeof this.collis.appendCard !== "function") {
      new Notice("Collis 没有加载成功，暂时不能记录");
      return;
    }

    this.saveBtn.disabled = true;
    this.saveBtn.classList.add("is-disabled");
    let ok = false;
    try {
      ok = await this.collis.appendCard(text);
    } catch (e) {
      console.error("[workbench] 写入卡片失败", e);
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
    this.load();
  }

  openCard(card, newLeaf) {
    if (!card || !card.filePath) return;
    const ref = card.id ? card.filePath + "#^" + card.id : card.filePath;
    try {
      // 新标签打开，避免把工作台所在的叶子替换掉
      this.app.workspace.openLinkText(ref, "", "tab");
    } catch (e) {
      this.app.workspace.openLinkText(card.filePath, "", "tab");
    }
  }

  openSidebar() {
    if (this.hostView && this.hostView.openCollis) {
      this.hostView.openCollis();
      return;
    }
    this.app.commands.executeCommandById("collis:open-cards");
  }
}

module.exports = { CollisNotesPanel };
