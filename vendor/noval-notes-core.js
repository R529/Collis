"use strict";
var {
  Plugin: Plugin2,
  ItemView: ItemView2,
  Modal: Modal2,
  MarkdownView,
  SuggestModal,
  Notice: Notice2,
  PluginSettingTab: PluginSettingTab2,
  Setting: Setting2,
  TFile,
  TFolder,
  Menu: Menu2,
  addIcon: addIcon2,
  setIcon: setIcon2,
  moment
} = require("obsidian");
var VIEW_TYPE_QM = "qm-cards-view";
var QM_TREE_H = 252;
var QM_ICONS = {
  // 搜索：放大镜
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  // 回看：带回环的钟
  review: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4.3l2.8 1.7"/></svg>',
  // 筛选：三条渐短的横线
  filter: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/></svg>',
  // 更多：三个点
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  // 返回
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
};
function qmMenuPlace(anchor, root, w, h) {
  const rootW = root.width || 0;
  const rootH = root.height || 0;
  let left = anchor.right - root.left - w;
  const maxLeft = rootW ? Math.max(6, rootW - w - 6) : left;
  left = Math.max(6, Math.min(left, maxLeft));
  let top = anchor.bottom - root.top + 6;
  if (rootH && top + h > rootH - 6) {
    const above = anchor.top - root.top - h - 6;
    top = above >= 6 ? above : Math.max(6, rootH - h - 6);
  }
  return { left: Math.round(left), top: Math.round(top) };
}
function qmSelbarGap(viewBottom, statusTop, base) {
  const fallback = typeof base === "number" ? base : 10;
  if (typeof viewBottom !== "number" || typeof statusTop !== "number") return fallback;
  const overlap = Math.round(viewBottom - statusTop);
  if (overlap <= 0) return fallback;
  return overlap + 6;
}
function qmStatusCover(viewBottom, statusTop) {
  if (typeof viewBottom !== "number" || typeof statusTop !== "number") return 0;
  const overlap = Math.round(viewBottom - statusTop);
  return overlap > 0 ? overlap : 0;
}
function qmHasBlockRef(text, id) {
  if (!text || !id) return false;
  try {
    const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\^" + esc + "(?![A-Za-z0-9-])").test(String(text));
  } catch (e) {
    return false;
  }
}
var QM_REVIEW_N = 5;
function qmShuffle(list) {
  const a = (list || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
function qmIcon(parent, name) {
  if (!parent || !QM_ICONS[name]) return;
  parent.innerHTML = QM_ICONS[name];
}
var ICON_ID = "noval-mark";
var ICON_MARK = /* @__PURE__ */ (() => {
  return '<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="17" rx="5" stroke-dasharray="3 2.6"/><path d="M6 15.5C8.2 10.5 11 10.2 11.8 12.4C12.6 14.6 15.4 14.8 17.6 10.2"/><circle cx="18.6" cy="6.6" r="1.5" fill="currentColor" stroke="none"/></g>';
})();
var DEFAULT_SETTINGS2 = {
  folderPath: "00-Inbox/\u901F\u8BB0",
  quickTags: [],
  maxCards: 500,
  trash: [],
  autoPruneEmptyDates: true,
  blockRefEmbed: false,
  collapsedDates: [],
  strictCardId: true,
  // 没提交完的手稿：{ text, at }。只存本机，不写进任何笔记文件
  draft: { text: "", at: 0 }
};
var DRAFT_TTL = 7 * 24 * 60 * 60 * 1e3;
var DRAFT_MAX = 5e3;
var MONTH_FILE_RE = /^\d{4}-\d{2}\.md$/;
function genId() {
  let s = "";
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function padTime(t) {
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(t);
  return (m[1].length === 1 ? "0" + m[1] : m[1]) + ":" + m[2];
}
function baseOf(path) {
  const name = String(path || "").split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}
var QM_CARD_RE = /^[-*][ \t]+(\d{1,2}:\d{2})[ \t]+(.*)$/;
var QM_CONT_INDENT = "  ";
function qmBodyLines(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}
function qmFormatEntry(time, bodyLines, id) {
  const src = bodyLines && bodyLines.length ? bodyLines : [""];
  const out = src.map((l, i) => {
    const prefix = i === 0 ? "- " + time + " " : QM_CONT_INDENT;
    const hardBreak = i < src.length - 1 && l.trim() ? "  " : "";
    return prefix + l + hardBreak;
  });
  const last = out.length - 1;
  if (id) out[last] = out[last].replace(/[ \t]+$/, "") + " ^" + id;
  return out;
}
function qmCardBlockEnd(lines, start) {
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (!/^[ \t]/.test(lines[i])) break;
    end = i;
  }
  if (end > start) {
    for (let i = end; i >= start; i--) {
      if (/[ \t]\^[A-Za-z0-9-]{4,}[ \t]*$/.test(lines[i])) {
        end = i;
        break;
      }
    }
  }
  while (end > start && lines[end].trim() === "") end--;
  return end;
}
var QM_APPEND_RE = /^〔追加[ \t]+([^〕]+)〕$/;
function qmCardSections(body) {
  const lines = String(body == null ? "" : body).replace(/\r\n?/g, "\n").split("\n");
  const original = [];
  const appends = [];
  let cur = null;
  for (const raw of lines) {
    const line = String(raw == null ? "" : raw).replace(/[ \t]+$/, "");
    const m = line.trim().match(QM_APPEND_RE);
    if (m) {
      cur = { label: m[1].trim(), lines: [] };
      appends.push(cur);
      continue;
    }
    (cur ? cur.lines : original).push(line);
  }
  const tidy = (arr) => {
    while (arr.length && !arr[0].trim()) arr.shift();
    while (arr.length && !arr[arr.length - 1].trim()) arr.pop();
    return arr.join("\n");
  };
  return {
    original: tidy(original),
    appends: appends.map((a) => ({ label: a.label, text: tidy(a.lines) }))
  };
}
function qmComposeBody(original, appends) {
  const out = qmBodyLines(original || "");
  for (const a of appends || []) {
    out.push("\u3014\u8FFD\u52A0 " + a.label + "\u3015");
    for (const l of qmBodyLines(a.text || "")) out.push(l);
  }
  return out.join("\n");
}
function qmBlockBody(lines, hit) {
  const out = [];
  for (let i = hit.lineIndex; i <= hit.lineEnd; i++) {
    let s = String(lines[i] == null ? "" : lines[i]);
    if (i === hit.lineIndex) s = s.replace(/^[-*][ \t]+(\d{1,2}:\d{2})[ \t]+/, "");
    else s = s.replace(/^ {2}|^\t/, "");
    s = s.replace(/[ \t]*\^[A-Za-z0-9-]+[ \t]*$/, "");
    out.push(s.replace(/[ \t]+$/, ""));
  }
  return out.join("\n");
}
function qmReplaceBlock(lines, hit, bodyText, id) {
  const entry = qmFormatEntry(hit.time, qmBodyLines(bodyText), id);
  lines.splice(hit.lineIndex, hit.lineEnd - hit.lineIndex + 1, ...entry);
  return lines.join("\n");
}
function qmCollectIds(content) {
  const ids = /* @__PURE__ */ new Set();
  const re = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/gm;
  let m;
  while ((m = re.exec(String(content || ""))) !== null) ids.add(m[1]);
  return ids;
}
function qmLooksLikeCardFile(content) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  let inDate = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*$/.test(line)) {
      inDate = true;
      continue;
    }
    if (!inDate) return false;
    if (/^##?[ \t]/.test(line)) return false;
    if (QM_CARD_RE.test(line)) continue;
    if (/^[ \t]/.test(line)) continue;
    return false;
  }
  return true;
}
function qmInsertCardLines(content, date, entryLines) {
  const raw = String(content || "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n");
  const headerRe = new RegExp("^##[ \\t]+" + escapeRe(date) + "[ \\t]*$");
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      hi = i;
      break;
    }
  }
  if (hi === -1) {
    let body = raw.replace(/\s+$/, "");
    if (body) body += "\n\n";
    return body + "## " + date + "\n\n" + entryLines.join("\n") + "\n";
  }
  let last = -1;
  for (let i = hi + 1; i < lines.length; i++) {
    if (/^##[ \t]/.test(lines[i])) break;
    if (lines[i].trim()) last = i;
  }
  if (last >= 0) {
    lines.splice(last + 1, 0, ...entryLines);
    return lines.join("\n");
  }
  const tail = lines[hi + 1];
  if (tail !== void 0 && tail.trim() === "") {
    lines.splice(hi + 2, 0, ...entryLines);
  } else {
    lines.splice(hi + 1, 0, "", ...entryLines);
  }
  return lines.join("\n");
}
function qmPruneEmptyDateSections(content, onlyDate) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const headerRe = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(headerRe);
    if (!hm) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    let hasContent = false;
    while (j < lines.length && !headerRe.test(lines[j])) {
      if (lines[j].trim()) {
        hasContent = true;
        break;
      }
      j++;
    }
    if (hasContent || onlyDate && hm[1] !== onlyDate) {
      out.push(lines[i]);
      continue;
    }
    i = j - 1;
    while (out.length && !out[out.length - 1].trim()) out.pop();
    if (out.length) out.push("");
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.length ? out.join("\n") + "\n" : "";
}
function qmStripEmptyDateSections(content, skipDates) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const headerRe = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/;
  const skip = skipDates instanceof Set ? skipDates : new Set(skipDates || []);
  const out = [];
  const removed = [];
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(headerRe);
    if (!hm || skip.has(hm[1])) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    let hasContent = false;
    while (j < lines.length) {
      if (headerRe.test(lines[j])) break;
      if (lines[j].trim()) {
        hasContent = true;
        break;
      }
      j++;
    }
    if (hasContent) {
      out.push(lines[i]);
      continue;
    }
    removed.push(hm[1]);
    i = j - 1;
    while (out.length && !out[out.length - 1].trim()) out.pop();
    if (out.length) out.push("");
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { text: out.length ? out.join("\n") + "\n" : "", removed };
}
function qmInsertRestoredCard(content, date, time, entryLines) {
  const raw = String(content || "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const out = lines.concat(lines.length ? [""] : [], entryLines);
    return out.join("\n").replace(/\n+$/, "") + "\n";
  }
  const hRe = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/;
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(hRe);
    if (m && m[1] === date) {
      hi = i;
      break;
    }
  }
  if (hi === -1) {
    let at2 = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(hRe);
      if (m && m[1] > date) {
        at2 = i;
        break;
      }
    }
    const head = lines.slice(0, at2);
    const tail = lines.slice(at2);
    while (head.length && !head[head.length - 1].trim()) head.pop();
    while (tail.length && !tail[0].trim()) tail.shift();
    const out = head.concat(head.length ? [""] : [], ["## " + date, ""], entryLines);
    if (tail.length) out.push("", ...tail);
    return out.join("\n").replace(/\n+$/, "") + "\n";
  }
  let at = hi + 1;
  for (let i = hi + 1; i < lines.length; i++) {
    if (/^##[ \t]/.test(lines[i])) break;
    const cm = lines[i].match(QM_CARD_RE);
    if (!cm) continue;
    const end = qmCardBlockEnd(lines, i);
    if (padTime(cm[1]) <= time) at = end + 1;
    i = end;
  }
  if (at === hi + 1) {
    if (lines[at] !== void 0 && !lines[at].trim()) lines.splice(at + 1, 0, ...entryLines);
    else lines.splice(at, 0, "", ...entryLines);
  } else {
    lines.splice(at, 0, ...entryLines);
  }
  return lines.join("\n");
}
function qmPasteText(body) {
  const lines = String(body || "").replace(/\r\n?/g, "\n").split("\n");
  return lines.map((l, i) => i < lines.length - 1 && l.trim() ? l + "  " : l).join("\n");
}
function qmFirstLine(body, max) {
  const limit = typeof max === "number" ? max : 18;
  const line = String(body || "").replace(/\r\n?/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  const flat = line.replace(/\s+/g, " ");
  return flat.length > limit ? flat.slice(0, limit) + "\u2026" : flat;
}
function qmBaseName(p) {
  return String(p || "").split("/").pop().replace(/\.md$/i, "").toLowerCase();
}
function qmParseBlockRef(raw) {
  const s = String(raw || "");
  const at = s.indexOf("#^");
  if (at < 0) return null;
  let target = s.slice(0, at).replace(/^!?\[\[/, "").replace(/\]\]$/, "").trim();
  let id = s.slice(at + 2);
  const cut = id.search(/[|\]\s]/);
  if (cut >= 0) id = id.slice(0, cut);
  id = id.trim().toLowerCase();
  if (!id) return null;
  return { target, id };
}
function qmRefFolder(path) {
  const parts = String(path == null ? "" : path).split("/");
  if (parts.length < 2) return "";
  return parts.slice(0, -1).join("/");
}
function qmBigrams(text) {
  const t = String(text == null ? "" : text).toLowerCase().replace(/\s+/g, "");
  const out = /* @__PURE__ */ new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function qmBigramScore(a, b) {
  const A = qmBigrams(a);
  const B = qmBigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}
function qmAppendHits(parent, text, words) {
  const src = String(text == null ? "" : text);
  const low = src.toLowerCase();
  const marks = [];
  for (const w of words || []) {
    const needle = String(w || "").toLowerCase();
    if (!needle) continue;
    let i = low.indexOf(needle);
    while (i !== -1 && marks.length < 64) {
      marks.push([i, i + needle.length]);
      i = low.indexOf(needle, i + needle.length);
    }
  }
  if (!marks.length) {
    parent.createSpan({ text: src });
    return;
  }
  marks.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([m[0], m[1]]);
  }
  let at = 0;
  for (const span of merged) {
    if (span[0] > at) parent.createSpan({ text: src.slice(at, span[0]) });
    parent.createSpan({ text: src.slice(span[0], span[1]), cls: "qm-hit" });
    at = span[1];
  }
  if (at < src.length) parent.createSpan({ text: src.slice(at) });
}
function qmLinkLine(link) {
  try {
    const pos = link && link.position;
    const start = pos && pos.start;
    const n = start && start.line;
    return typeof n === "number" && n >= 0 ? n : -1;
  } catch (e) {
    return -1;
  }
}
function qmAggregateRefs(items) {
  const out = /* @__PURE__ */ new Map();
  for (const it of items || []) {
    if (!it || !it.destPath || !it.id) continue;
    const key = it.destPath + "#^" + String(it.id).toLowerCase();
    let e = out.get(key);
    if (!e) out.set(key, e = { notes: /* @__PURE__ */ new Set(), places: 0, ambiguous: false, by: /* @__PURE__ */ new Map() });
    e.places += 1;
    if (it.sourcePath) {
      e.notes.add(it.sourcePath);
      const line = typeof it.line === "number" && it.line >= 0 ? it.line : -1;
      const lines = e.by.get(it.sourcePath);
      if (lines) {
        if (line >= 0) lines.push(line);
      } else {
        e.by.set(it.sourcePath, line >= 0 ? [line] : []);
      }
    }
    if (it.ambiguous) e.ambiguous = true;
  }
  return out;
}
function qmBodySegments(body) {
  const text = String(body == null ? "" : body);
  const out = [];
  if (!text) return out;
  const re = /#([^\s#\[\]()]+)|\bhttps?:\/\/[^\s<>"'，。；：！？、（）【】《》]+/g;
  const pushText = (s) => {
    if (s) out.push({ kind: "text", text: s });
  };
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const at = m.index;
    if (at > last) pushText(text.slice(last, at));
    if (raw.charAt(0) === "#") {
      out.push({ kind: "tag", text: raw, value: m[1] });
      last = at + raw.length;
      continue;
    }
    const trimmed = raw.replace(/[.,;:!?)\]}]+$/, "");
    out.push({ kind: "url", text: trimmed });
    last = at + trimmed.length;
    re.lastIndex = last;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}
function parseCards(content, filePath, opts) {
  const strict = !!(opts && opts.strict);
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const cards = [];
  let curDate = "";
  const fileBase = baseOf(filePath);
  const dupSeen = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hm = line.match(/^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/);
    if (hm) {
      curDate = hm[1];
      continue;
    }
    const cm = line.match(QM_CARD_RE);
    if (!cm) continue;
    const end = qmCardBlockEnd(lines, i);
    const parts = [cm[2] || ""];
    for (let j = i + 1; j <= end; j++) {
      parts.push(lines[j].replace(/^ {2}|^\t/, ""));
    }
    const lastPart = String(parts[parts.length - 1] || "").replace(/[ \t]+$/, "");
    const endId = lastPart.match(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/);
    if (strict && !endId) {
      let hasAnyId = false;
      for (let j = i; j <= end; j++) {
        if (/[ \t]\^[A-Za-z0-9-]{4,}[ \t]*$/.test(lines[j])) {
          hasAnyId = true;
          break;
        }
      }
      if (!hasAnyId) {
        i = end;
        continue;
      }
    }
    let body = parts.map((p) => p.replace(/[ \t]+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
    const ids = [];
    body = body.replace(/[ \t]\^([A-Za-z0-9-]+)[ \t]*(?=$|\n)/gm, (m, p1) => {
      ids.push(p1);
      return "";
    });
    body = body.replace(/[ \t]+$/gm, "");
    const id = endId ? endId[1] : ids[ids.length - 1] || "";
    const idOnLastLine = !!endId;
    const tags = [];
    const tagRe = /#([^\s#\[\]()]+)/g;
    let tm;
    while ((tm = tagRe.exec(body)) !== null) tags.push(tm[1]);
    const dupKey = (curDate || "") + "\0" + line;
    const dupIndex = dupSeen.get(dupKey) || 0;
    dupSeen.set(dupKey, dupIndex + 1);
    cards.push({
      date: curDate || "\u672A\u5206\u7EC4",
      time: padTime(cm[1]),
      body,
      // 搜索时每次都 toLowerCase() 会产生大量临时字符串，这里预存一份
      bodyLower: body.toLowerCase(),
      tags,
      lineIndex: i,
      lineEnd: end,
      id,
      idOnLastLine,
      dupIndex,
      raw: line,
      filePath,
      fileBase
    });
    i = end;
  }
  return cards;
}
function qmFindOrphans(content, filePath, opts) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const strict = !(opts && opts.strict === false);
  const visible = parseCards(content, filePath, { strict });
  const covered = /* @__PURE__ */ new Set();
  for (const c of visible) for (let i = c.lineIndex; i <= c.lineEnd; i++) covered.add(i);
  const headerRe = /^##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*$/;
  const itemRe = /^[-*][ \t]+/;
  const idRe = /[ \t]\^([A-Za-z0-9-]{4,})[ \t]*$/;
  const timeRe = /^[-*][ \t]+\d{1,2}:\d{1,2}[ \t]/;
  const out = [];
  for (let start = 0; start < lines.length; start++) {
    if (!itemRe.test(lines[start]) || covered.has(start)) continue;
    let end = start;
    for (let j = start + 1; j < lines.length; j++) {
      if (headerRe.test(lines[j]) || itemRe.test(lines[j])) break;
      if (lines[j].trim()) end = j;
    }
    let overlap = false;
    for (let j = start; j <= end; j++) {
      if (covered.has(j)) {
        overlap = true;
        break;
      }
    }
    if (overlap) {
      start = end;
      continue;
    }
    let mainId = "";
    for (let j = start; j <= end; j++) {
      const mm = lines[j].match(idRe);
      if (mm) mainId = mm[1];
    }
    let date = "";
    for (let j = start; j >= 0; j--) {
      const hm = lines[j].match(/^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/);
      if (hm) {
        date = hm[1];
        break;
      }
    }
    const slice = lines.slice(start, end + 1);
    out.push({
      filePath,
      date,
      id: mainId,
      lineStart: start,
      lineEnd: end,
      // HAS_TIME_NO_ID：首行有时间但仍不显示（缺 ID / 时间格式不合规）
      // NO_TIME：首行没有 HH:mm（含完全手写的条目）
      reason: timeRe.test(lines[start]) ? "HAS_TIME_NO_ID" : "NO_TIME",
      lines: slice,
      preview: slice.join(" ").replace(idRe, "").replace(/[ \t]+/g, " ").trim().slice(0, 64)
    });
    start = end;
  }
  return out;
}
function qmOrphanFingerprint(o) {
  const first = o && Array.isArray(o.lines) && o.lines.length ? String(o.lines[0] || "") : "";
  return first.replace(/^[-*][ \t]+/, "").replace(/^\d{1,2}:\d{1,2}[ \t]+/, "").replace(/[ \t]*\^([A-Za-z0-9-]{4,})[ \t]*$/, "").replace(/[ \t]+$/, "").trim();
}
function qmMatchOrphan(list, item) {
  if (!Array.isArray(list) || !item) return null;
  if (item.id) {
    const byId = list.filter((o) => o.id === item.id);
    if (byId.length === 1) return byId[0];
    if (byId.length > 1) {
      const fp2 = qmOrphanFingerprint(item);
      const same = byId.filter((o) => qmOrphanFingerprint(o) === fp2);
      if (same.length) return typeof item.lineStart === "number" ? same.sort((a, b) => Math.abs(a.lineStart - item.lineStart) - Math.abs(b.lineStart - item.lineStart))[0] : same[0];
    }
  }
  const fp = qmOrphanFingerprint(item);
  if (fp) {
    const byBody = list.filter((o) => qmOrphanFingerprint(o) === fp);
    if (byBody.length === 1) return byBody[0];
    if (byBody.length > 1 && typeof item.lineStart === "number") {
      return byBody.sort((a, b) => Math.abs(a.lineStart - item.lineStart) - Math.abs(b.lineStart - item.lineStart))[0];
    }
  }
  return null;
}
function qmSuggestOrphanTime(content, filePath, orphan, opts) {
  const want = String(opts && opts.time || "").trim();
  const wm = want.match(/^(\d{1,2}):(\d{1,2})$/);
  if (wm) return wm[1].padStart(2, "0") + ":" + wm[2].padStart(2, "0");
  const cards = parseCards(content, filePath, { strict: false }).filter((c) => !orphan.date || c.date === orphan.date);
  const times = cards.map((c) => c.time).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
  if (!times.length) return "00:00";
  const p = times[times.length - 1].split(":").map(Number);
  let h = p[0], m = p[1] + 1;
  if (m >= 60) {
    m = 0;
    h = (h + 1) % 24;
  }
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function qmRebuildOrphanLines(orphan, time, newId) {
  const src = Array.isArray(orphan && orphan.lines) ? orphan.lines.slice() : [];
  const ids = [];
  const body = src.map((l, idx) => {
    let s = String(l == null ? "" : l);
    s = s.replace(/[ \t]*\^([A-Za-z0-9-]{4,})[ \t]*$/, (mm, id2) => {
      ids.push(id2);
      return "";
    });
    s = idx === 0 ? s.replace(/^[-*][ \t]+/, "") : s.replace(/^ {2}|^\t/, "");
    if (idx === 0) s = s.replace(/^\d{1,2}:\d{1,2}[ \t]+/, "");
    return s.replace(/[ \t]+$/, "");
  });
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (!body.length) return null;
  const t = /^\d{1,2}:\d{2}$/.test(String(time || "")) ? padTime(time) : "00:00";
  const id = String(newId || "") || (ids.length ? ids[ids.length - 1] : "");
  return qmFormatEntry(t, body, id);
}
function qmLocateCard(content, card, opts) {
  if (!card || !card.filePath) return null;
  const cards = parseCards(content, card.filePath, opts);
  if (card.id) {
    const hits = cards.filter((c) => c.id === card.id);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const exact = hits.filter((c) => c.time === card.time && c.body === card.body);
      return exact.length === 1 ? exact[0] : null;
    }
    return null;
  }
  const same = cards.filter((c) => c.date === card.date && c.raw === card.raw);
  if (!same.length) return null;
  const i = typeof card.dupIndex === "number" ? card.dupIndex : 0;
  if (same[i] && same[i].body === card.body) return same[i];
  const byBody = same.filter((c) => c.body === card.body);
  return byBody.length === 1 ? byBody[0] : null;
}
function qmParseQuery(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  const out = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const phrase = m[1];
    const tok = phrase !== void 0 ? phrase : m[2];
    if (!tok) continue;
    if (phrase !== void 0) {
      out.push({ kind: "text", value: tok.toLowerCase() });
      continue;
    }
    if (tok.charAt(0) === "#" && tok.length > 1) {
      out.push({ kind: "tag", value: tok.slice(1) });
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) {
      out.push({ kind: "date", value: tok });
      continue;
    }
    if (/^\d{4}-\d{2}$/.test(tok)) {
      out.push({ kind: "month", value: tok });
      continue;
    }
    if (/^\d{2}-\d{2}$/.test(tok)) {
      out.push({ kind: "md", value: tok });
      continue;
    }
    if (/^\d{1,2}:\d{2}$/.test(tok)) {
      out.push({ kind: "time", value: padTime(tok) });
      continue;
    }
    out.push({ kind: "text", value: tok.toLowerCase() });
  }
  return out;
}
function qmCardMatches(card, conds) {
  if (!conds || !conds.length) return true;
  const date = String(card && card.date || "");
  const time = String(card && card.time || "");
  const text = card && typeof card.bodyLower === "string" ? card.bodyLower : String(card && card.body || "").toLowerCase();
  for (const c of conds) {
    if (c.kind === "tag") {
      if (!qmCardHasPath(card, c.value)) return false;
    } else if (c.kind === "date") {
      if (date !== c.value) return false;
    } else if (c.kind === "month") {
      if (date.slice(0, 7) !== c.value) return false;
    } else if (c.kind === "md") {
      if (date.slice(5) !== c.value) return false;
    } else if (c.kind === "time") {
      if (time !== c.value) return false;
    } else if (text.indexOf(c.value) === -1) {
      return false;
    }
  }
  return true;
}
function sortCards(cards) {
  cards.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.time !== b.time) return a.time < b.time ? 1 : -1;
    if (a.filePath !== b.filePath) return a.filePath < b.filePath ? 1 : -1;
    return b.lineIndex - a.lineIndex;
  });
  return cards;
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function collectAllTags(cards, quickTags) {
  const count = /* @__PURE__ */ new Map();
  for (const c of cards || []) {
    for (const t of c.tags || []) {
      const tag = String(t || "").trim();
      if (!tag) continue;
      count.set(tag, (count.get(tag) || 0) + 1);
    }
  }
  const prefer = /* @__PURE__ */ new Map();
  for (const t of quickTags || []) {
    const tag = String(t || "").replace(/^#/, "").trim();
    if (tag && count.has(tag)) prefer.set(tag, 1);
  }
  return Array.from(count.entries()).sort((a, b) => {
    const pa = prefer.has(a[0]) ? 1 : 0;
    const pb = prefer.has(b[0]) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : 1;
  }).map((x) => x[0]);
}
var TagSuggest = class {
  constructor(textarea, container, getTags2) {
    this.ta = textarea;
    this.container = container;
    this.getTags = getTags2;
    this.el = null;
    this.items = [];
    this.index = 0;
    this.active = false;
    this.q = null;
    this.seq = 0;
    this.navigated = false;
    this._onInput = () => this.update();
    this._onKey = (e) => this.onKey(e);
    this._onBlur = () => window.setTimeout(() => this.hide(), 160);
    this._onClick = () => this.update();
    this._onKeyup = (e) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) !== -1) this.update();
    };
    textarea.addEventListener("input", this._onInput);
    textarea.addEventListener("keydown", this._onKey, true);
    textarea.addEventListener("blur", this._onBlur);
    textarea.addEventListener("click", this._onClick);
    textarea.addEventListener("keyup", this._onKeyup);
  }
  destroy() {
    this.hide();
    this.ta.removeEventListener("input", this._onInput);
    this.ta.removeEventListener("keydown", this._onKey, true);
    this.ta.removeEventListener("blur", this._onBlur);
    this.ta.removeEventListener("click", this._onClick);
    this.ta.removeEventListener("keyup", this._onKeyup);
  }
  /** 取光标前正在输入的 #片段 */
  query() {
    const pos = this.ta.selectionStart;
    if (pos === null || pos === void 0) return null;
    const before = String(this.ta.value || "").slice(0, pos);
    const m = before.match(/#([^\s#\[\]()]*)$/);
    if (!m) return null;
    const start = pos - m[0].length;
    if (start > 0 && !/[\s]/.test(before.charAt(start - 1))) return null;
    return { start, end: pos, partial: m[1] };
  }
  update() {
    const q = this.query();
    if (!q) {
      this.hide();
      return;
    }
    const mySeq = ++this.seq;
    Promise.resolve().then(() => this.getTags()).then((all) => {
      if (mySeq !== this.seq) return;
      this.applyQuery(q, Array.isArray(all) ? all : []);
    }).catch(() => {
    });
  }
  applyQuery(q, all) {
    const p = String(q.partial || "").toLowerCase();
    const matched = all.filter((t) => String(t).toLowerCase().indexOf(p) !== -1).slice(0, 20);
    const exact = all.some((t) => String(t).toLowerCase() === p);
    const items = matched.map((t) => ({ tag: t, create: false }));
    if (p && !exact) items.push({ tag: q.partial, create: true });
    if (!items.length) {
      this.hide();
      return;
    }
    this.q = q;
    this.items = items;
    this.index = 0;
    this.render();
  }
  render() {
    this.navigated = false;
    if (!this.el) {
      this.el = this.container.createDiv({ cls: "qm-suggest" });
    }
    this.el.empty();
    this.items.forEach((it, i) => {
      const row = this.el.createDiv({
        cls: "qm-suggest-item" + (i === this.index ? " is-active" : "") + (it.create ? " is-create" : "")
      });
      row.setText(it.create ? "\u65B0\u5EFA #" + it.tag : "#" + it.tag);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.pick(i);
      });
      row.addEventListener("mouseenter", () => {
        this.index = i;
        this.navigated = true;
        this.highlight();
      });
    });
    const top = this.ta.offsetTop + this.ta.offsetHeight + 4;
    const left = this.ta.offsetLeft;
    const width = Math.max(140, Math.min(this.ta.offsetWidth || 200, 280));
    this.el.style.top = top + "px";
    this.el.style.left = left + "px";
    this.el.style.width = width + "px";
    this.active = true;
  }
  highlight() {
    if (!this.el) return;
    Array.from(this.el.children).forEach((r, i) => {
      if (i === this.index) r.addClass("is-active");
      else r.removeClass("is-active");
    });
  }
  hide() {
    this.seq++;
    this.active = false;
    this.q = null;
    this.items = [];
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
  onKey(e) {
    if (!this.active || !this.items.length) return;
    const n = this.items.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      this.navigated = true;
      this.index = (this.index + 1) % n;
      this.highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      this.navigated = true;
      this.index = (this.index - 1 + n) % n;
      this.highlight();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;
      if (e.key === "Enter" && !this.navigated) {
        this.hide();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.pick(this.index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    }
  }
  pick(i) {
    const it = this.items[i];
    if (!it || !this.q) return;
    const v = String(this.ta.value || "");
    const q = this.q;
    const head = v.slice(0, q.start);
    const tail = v.slice(q.end);
    const insert = "#" + it.tag + (/^[\s]/.test(tail) ? "" : " ");
    const next = head + insert + tail;
    this.ta.value = next;
    const caret = head.length + insert.length;
    try {
      this.ta.setSelectionRange(caret, caret);
    } catch (err) {
    }
    this.hide();
    this.ta.focus();
  }
};
var ConfirmModal = class extends Modal2 {
  constructor(app, text, onConfirm, detail, confirmText) {
    super(app);
    this.text = text;
    this.onConfirm = onConfirm;
    this.detail = detail || "";
    this.confirmText = confirmText || "\u5220\u9664";
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    if (modalEl && modalEl.addClass) modalEl.addClass("qm-modal");
    contentEl.createEl("div", { text: this.text, cls: "qm-confirm-text" });
    if (this.detail) {
      contentEl.createEl("div", { text: this.detail, cls: "qm-confirm-detail" });
    }
    const bar = contentEl.createDiv({ cls: "qm-edit-bar" });
    const cancel = bar.createEl("button", { text: "\u53D6\u6D88", cls: "qm-mini-btn" });
    cancel.onclick = () => this.close();
    const ok = bar.createEl("button", { text: this.confirmText, cls: "qm-mini-btn is-primary" });
    ok.onclick = () => {
      this.close();
      this.onConfirm();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DraftSwitchModal = class extends Modal2 {
  constructor(app, opts) {
    super(app);
    this.opts = opts || {};
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    if (modalEl && modalEl.addClass) modalEl.addClass("qm-modal");
    contentEl.createEl("div", { text: "\u53E6\u4E00\u6761\u5361\u7247\u8FD8\u6CA1\u4FDD\u5B58", cls: "qm-confirm-text" });
    contentEl.createEl("div", {
      text: "\u300C" + String(this.opts.preview || "") + "\u300D\u6539\u8FC7\u4F46\u6CA1\u4FDD\u5B58\u3002\u8981\u5148\u5B58\u4E0B\u6765\uFF0C\u518D\u7F16\u8F91\u8FD9\u6761\u5417\uFF1F",
      cls: "qm-confirm-detail"
    });
    const bar = contentEl.createDiv({ cls: "qm-edit-bar" });
    const stay = bar.createEl("button", { text: "\u7559\u5728\u8FD9\u6761", cls: "qm-mini-btn" });
    stay.onclick = () => this.close();
    const drop = bar.createEl("button", { text: "\u653E\u5F03\u4FEE\u6539", cls: "qm-mini-btn" });
    drop.onclick = () => {
      this.close();
      if (typeof this.opts.onDiscard === "function") this.opts.onDiscard();
    };
    const save = bar.createEl("button", { text: "\u4FDD\u5B58\u5E76\u7EE7\u7EED", cls: "qm-mini-btn is-primary" });
    save.onclick = async () => {
      if (typeof this.opts.onSave !== "function") {
        this.close();
        return;
      }
      const okSaved = await this.opts.onSave();
      if (okSaved !== false) this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CardPickerModal = class extends SuggestModal {
  constructor(app, plugin, opts) {
    super(app);
    this.plugin = plugin;
    this.opts = opts || {};
    this.limit = 30;
    this.setPlaceholder("\u641C\u7D22\u5361\u7247\uFF1A\u5173\u952E\u8BCD \xB7 #\u6807\u7B7E \xB7 2026-11");
    this.emptyStateText = "\u6CA1\u6709\u5339\u914D\u7684\u5361\u7247";
  }
  // 每次敲字都会调一次；数据没预热过就现读，不再依赖启动时的预热
  async getSuggestions(query) {
    const rows = await this.plugin.suggestCardsAsync(query);
    this._rows = rows;
    if (this.modalEl) {
      const recent = !String(query || "").trim() && rows.length > 0;
      if (recent) this.modalEl.addClass("is-recent");
      else this.modalEl.removeClass("is-recent");
    }
    return rows;
  }
  renderSuggestion(item, el) {
    this.plugin.renderSuggestRow(item, el);
  }
  /**
   * 当前高亮的那条候选。
   * 原生把 suggestions / selectedSuggestion 留在内部字段里（没进 d.ts），
   * 所以先判存在再用；取不到就退回列表里标了 is-selected 的那一行。
   */
  currentRow() {
    const list = this.suggestions;
    if (Array.isArray(list) && list.length) {
      let i = this.selectedSuggestion;
      if (typeof i !== "number" || i < 0 || i >= list.length) i = 0;
      if (list[i]) return list[i];
    }
    const rows = this._rows || [];
    const root = this.resultContainerEl || this.modalEl;
    if (!rows.length || !root || typeof root.querySelectorAll !== "function") return null;
    const items = root.querySelectorAll(".suggestion-item");
    let at = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].classList && items[i].classList.contains("is-selected")) {
        at = i;
        break;
      }
    }
    return rows[at] || rows[0] || null;
  }
  onChooseSuggestion(item, evt) {
    if (this._chosen) return;
    this._chosen = true;
    const plain = !!(evt && evt.shiftKey);
    const ed = this.opts.editor || this.plugin.currentEditor();
    if (!ed) {
      void this.plugin.insertIntoCurrentNote(item.card, plain);
      return;
    }
    this.plugin.insertCardRef(item.card, ed, this.opts.from, this.opts.to, plain);
  }
  onOpen() {
    super.onOpen();
    if (this.modalEl) this.modalEl.addClass("qm-picker-modal");
    if (this.modalEl) this.modalEl.removeClass("is-recent");
    if (typeof this.setInstructions === "function") {
      this.setInstructions([
        { command: "\u2191\u2193", purpose: "\u9009\u62E9" },
        { command: "\u56DE\u8F66", purpose: "\u63D2\u5165\u5F15\u7528" },
        { command: "Shift+\u56DE\u8F66", purpose: "\u63D2\u5165\u7EAF\u6587\u672C" }
      ]);
    }
    this._shiftEnter = (e) => {
      if (!e || e.key !== "Enter" || !e.shiftKey || e.isComposing) return;
      if (!this.inputEl || e.target !== this.inputEl) return;
      const item = this.currentRow();
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      this.onChooseSuggestion(item, { shiftKey: true });
      this.close();
    };
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("keydown", this._shiftEnter, true);
    }
  }
  onClose() {
    if (this._shiftEnter && typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener("keydown", this._shiftEnter, true);
    }
    this._shiftEnter = null;
    super.onClose();
  }
};
var RefListModal = class extends Modal2 {
  constructor(app, info, onPick) {
    super(app);
    this.info = info || { notes: 0, places: 0, list: [] };
    this.onPick = onPick;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("qm-refpanel");
    if (modalEl) modalEl.addClass("qm-modal-wide");
    const n = this.info.notes || 0;
    const places = this.info.places || n;
    contentEl.createEl("div", { text: "\u88AB " + n + " \u7BC7\u7B14\u8BB0\u5F15\u7528", cls: "qm-refpanel-title" });
    contentEl.createEl("div", {
      text: places > n ? "\u5171 " + places + " \u5904 \xB7 \u70B9\u51FB\u8DF3\u5230\u5F15\u7528\u6240\u5728\u4F4D\u7F6E" : "\u70B9\u51FB\u8DF3\u5230\u5F15\u7528\u6240\u5728\u4F4D\u7F6E",
      cls: "qm-refpanel-sub"
    });
    const box = contentEl.createDiv({ cls: "qm-reflist" });
    for (const r of this.info.list || []) {
      const row = box.createDiv({ cls: "qm-reflist-row" });
      row.setAttr("tabindex", "0");
      const main = row.createDiv({ cls: "qm-reflist-main" });
      main.createEl("span", { text: r.name, cls: "qm-reflist-name" });
      const folder = qmRefFolder(r.path);
      if (folder) main.createEl("span", { text: folder, cls: "qm-reflist-path" });
      if (r.places > 1) row.createEl("span", { text: r.places + " \u5904", cls: "qm-reflist-n" });
      const go = () => {
        this.close();
        if (typeof this.onPick === "function") this.onPick(r);
      };
      row.onclick = go;
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TrashModal = class extends Modal2 {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.modalEl && this.modalEl.addClass) this.modalEl.addClass("qm-trash-modal");
    contentEl.createEl("div", { text: "\u6700\u8FD1\u5220\u9664", cls: "qm-modal-title" });
    const list = Array.isArray(this.plugin.settings.trash) ? this.plugin.settings.trash : [];
    if (!list.length) {
      contentEl.createEl("div", { text: "\u6700\u8FD1\u6CA1\u6709\u5220\u9664\u8FC7\u5361\u7247\u3002", cls: "qm-hint" });
    } else {
      contentEl.createEl("div", {
        text: "\u4FDD\u7559\u6700\u8FD1 50 \u6761\u3002\u6062\u590D\u4F1A\u6309\u539F\u65E5\u671F\u63D2\u56DE\uFF1B\u5220\u9664\u662F\u5F7B\u5E95\u5220\u6389\uFF0C\u4E0D\u80FD\u64A4\u9500\u3002",
        cls: "qm-hint"
      });
      const wrap = contentEl.createDiv({ cls: "qm-trash-list" });
      for (const it of list) {
        const row = wrap.createDiv({ cls: "qm-trash-item" });
        const main = row.createDiv({ cls: "qm-trash-main" });
        const txt = String(it.body || "").replace(/\s*\n\s*/g, " \u23CE ");
        main.createDiv({ cls: "qm-trash-body", text: txt || "\uFF08\u7A7A\uFF09" });
        main.createDiv({
          cls: "qm-trash-meta",
          text: (it.date || "\u672A\u5206\u7EC4") + " " + (it.time || "")
        });
        const acts = row.createDiv({ cls: "qm-trash-acts" });
        const undo = acts.createEl("button", { text: "\u6062\u590D", cls: "qm-mini-btn is-primary" });
        undo.onclick = async () => {
          await this.plugin.restoreTrash(it.uid);
          this.onOpen();
        };
        const drop = acts.createEl("button", {
          text: "\u5220\u9664",
          cls: "qm-mini-btn qm-mini-btn-danger"
        });
        drop.setAttr("title", "\u5F7B\u5E95\u5220\u9664\u8FD9\u4E00\u6761");
        drop.onclick = () => {
          new ConfirmModal(
            this.app,
            "\u5F7B\u5E95\u5220\u9664\u8FD9\u4E00\u6761\uFF1F",
            async () => {
              await this.plugin.dropTrash(it.uid);
              this.onOpen();
            },
            "\u5220\u9664\u540E\u5C31\u771F\u7684\u6CA1\u4E86\uFF0C\u4E0D\u80FD\u6062\u590D\u3002",
            "\u5220\u9664"
          ).open();
        };
      }
    }
    const bar = contentEl.createDiv({ cls: "qm-trash-bar" });
    if (list.length) {
      const clear = bar.createEl("button", {
        text: "\u6E05\u7A7A\u5168\u90E8 " + list.length + " \u6761",
        cls: "qm-mini-btn qm-mini-btn-danger qm-trash-clear"
      });
      clear.onclick = () => {
        new ConfirmModal(
          this.app,
          "\u6E05\u7A7A\u6700\u8FD1\u5220\u9664\u91CC\u7684 " + list.length + " \u6761\uFF1F",
          async () => {
            await this.plugin.clearTrash();
            this.onOpen();
          },
          "\u6E05\u7A7A\u540E\u8FD9\u4E9B\u5185\u5BB9\u5C31\u771F\u7684\u6CA1\u4E86\uFF0C\u4E0D\u80FD\u6062\u590D\u3002",
          "\u6E05\u7A7A"
        ).open();
      };
    }
    const close = bar.createEl("button", { text: "\u5173\u95ED", cls: "qm-mini-btn" });
    close.onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var OrphanModal = class extends Modal2 {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.items = [];
    this._fresh = false;
  }
  /** 重新扫描：强制重读速记文件，再把整窗重画一次 */
  async rescan() {
    this._fresh = true;
    await this.onOpen();
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.modalEl && this.modalEl.addClass) this.modalEl.addClass("qm-orphan-modal");
    contentEl.createEl("div", { text: "\u68C0\u67E5\u5B64\u513F\u5361\u7247", cls: "qm-modal-title" });
    contentEl.createEl("div", {
      text: "\u300C\u6062\u590D\u5361\u7247\u300D\u4F1A\u628A\u5B83\u53D8\u6210\u6B63\u5E38\u5361\u7247\u5E76\u4FDD\u7559\u539F\u6765\u7684\u5F15\u7528\uFF1B\u300C\u5220\u9664\u300D\u4F1A\u79FB\u5165\u300C\u6700\u8FD1\u5220\u9664\u300D\uFF0C\u53EF\u4EE5\u6062\u590D\u3002",
      cls: "qm-hint"
    });
    const list = contentEl.createDiv({ cls: "qm-orphan-list" });
    this.items = await this.plugin.findOrphans(this._fresh);
    if (!this.items.length) {
      list.createEl("div", { text: "\u6CA1\u6709\u53D1\u73B0\u5B64\u513F\u5361\u7247\u3002", cls: "qm-hint" });
    } else {
      for (const it of this.items) {
        const row = list.createDiv({ cls: "qm-orphan-item" });
        const main = row.createDiv({ cls: "qm-orphan-main" });
        main.createDiv({ cls: "qm-orphan-body", text: it.preview || "\uFF08\u7A7A\uFF09" });
        main.createDiv({
          cls: "qm-orphan-meta",
          text: (it.date || "\u672A\u5206\u7EC4") + " \xB7 \u7B2C " + (it.lineStart + 1) + " \u884C \xB7 " + (it.id ? "^" + it.id : "\u65E0\u5757 ID")
        });
        const acts = row.createDiv({ cls: "qm-orphan-acts" });
        const restore = acts.createEl("button", { text: "\u6062\u590D\u5361\u7247", cls: "qm-mini-btn is-primary" });
        restore.setAttr("title", "\u6309\u5F53\u524D\u89C4\u5219\u6539\u6210\u6807\u51C6\u5361\u7247\u5E76\u663E\u793A\u5728\u5217\u8868\u91CC");
        restore.onclick = async () => {
          const ok = await this.plugin.restoreOrphan(it);
          if (ok) this.onOpen();
        };
        const drop = acts.createEl("button", { text: "\u5220\u9664", cls: "qm-mini-btn qm-mini-btn-danger" });
        drop.setAttr("title", "\u5F7B\u5E95\u6E05\u7406\u8FD9\u4E00\u6BB5\uFF08\u53EF\u5728\u6700\u8FD1\u5220\u9664\u91CC\u6062\u590D\uFF09");
        drop.onclick = () => {
          new ConfirmModal(
            this.app,
            "\u5220\u9664\u8FD9\u6BB5\u5B64\u513F\u5361\u7247\uFF1F",
            async () => {
              const ok = await this.plugin.deleteOrphan(it);
              if (ok) this.onOpen();
            },
            "\u8FD9\u4E00\u6BB5\u4F1A\u4ECE\u901F\u8BB0\u6587\u4EF6\u91CC\u79FB\u9664\uFF0C\u4F46\u53EF\u4EE5\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u91CC\u6062\u590D\u3002",
            "\u5220\u9664"
          ).open();
        };
      }
    }
    const bar = contentEl.createDiv({ cls: "qm-trash-bar" });
    const allCls = "qm-mini-btn qm-mini-btn-danger qm-trash-clear" + (this.items.length ? "" : " is-disabled");
    const all = bar.createEl("button", { text: "\u5168\u90E8\u5220\u9664", cls: allCls });
    all.setAttr("title", this.items.length ? "\u5220\u9664\u4E0A\u9762\u5217\u51FA\u7684\u5168\u90E8\u5B64\u513F\u5361\u7247\uFF0C\u53EF\u4ECE\u300C\u6700\u8FD1\u5220\u9664\u300D\u9010\u6761\u6062\u590D" : "\u5F53\u524D\u6CA1\u6709\u53EF\u5220\u9664\u7684\u5B64\u513F\u5361\u7247");
    if (this.items.length) {
      all.onclick = () => {
        new ConfirmModal(
          this.app,
          "\u5220\u9664\u5168\u90E8\u5B64\u513F\u5361\u7247\uFF1F",
          async () => {
            const res = await this.plugin.deleteOrphans(this.items);
            new Notice2("\u5DF2\u6E05\u7406 " + res.deleted + " \u6761" + (res.failed ? "\uFF0C" + res.failed + " \u6761\u672A\u627E\u5230\u5DF2\u8DF3\u8FC7" : "") + "\uFF0C\u53EF\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u6062\u590D", 8e3);
            this.onOpen();
          },
          "\u8FD9 " + this.items.length + " \u6BB5\u4F1A\u4ECE\u901F\u8BB0\u6587\u4EF6\u91CC\u79FB\u9664\uFF0C\u4E4B\u540E\u4ECD\u53EF\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u91CC\u9010\u6761\u6062\u590D\u3002",
          "\u5168\u90E8\u5220\u9664"
        ).open();
      };
    }
    const rescan = bar.createEl("button", { text: "\u91CD\u65B0\u626B\u63CF", cls: "qm-mini-btn" });
    rescan.setAttr("title", "\u91CD\u65B0\u8BFB\u53D6\u901F\u8BB0\u6587\u4EF6\u5E76\u68C0\u67E5\u5B64\u513F\u5361\u7247");
    rescan.onclick = () => this.rescan();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CaptureModal = class extends Modal2 {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    if (modalEl && modalEl.addClass) modalEl.addClass("qm-modal");
    contentEl.createEl("div", { text: "\u8BB0\u4E00\u6761", cls: "qm-modal-title" });
    const taWrap = contentEl.createDiv({ cls: "qm-modal-wrap" });
    const ta = taWrap.createEl("textarea", { cls: "qm-input qm-modal-input" });
    ta.setAttr("placeholder", "\u60F3\u5230\u4EC0\u4E48\u5C31\u5199\u4EC0\u4E48\uFF0C\u4E0D\u9700\u8981\u6807\u9898\u2026\uFF08\u8F93\u5165 # \u9009\u62E9\u6807\u7B7E\uFF09");
    ta.rows = 5;
    this._ta = ta;
    this._closingBySubmit = false;
    this._draftHintEl = null;
    this._draftRestored = false;
    const draft = this.plugin.draftAlive();
    if (draft) {
      ta.value = draft;
      this._draftRestored = true;
      this._draftHintEl = taWrap.createDiv({
        cls: "qm-draft-hint",
        text: "\u5DF2\u6062\u590D\u4E0A\u6B21\u6CA1\u8BB0\u5B8C\u7684\u5185\u5BB9"
      });
    }
    ta.addEventListener("input", () => {
      this.dismissDraftHint();
      this.plugin.queueDraft(ta.value);
    });
    const tagList = [];
    const suggest = new TagSuggest(ta, taWrap, () => tagList);
    this._suggest = suggest;
    (async () => {
      let tags = [];
      try {
        const cards = await this.plugin.cardsForSuggest();
        tags = collectAllTags(cards, this.plugin.settings.quickTags);
      } catch (e) {
        tags = [];
      }
      if (!tags.length) return;
      tagList.push(...tags);
      suggest.update();
      const bar = contentEl.createDiv({ cls: "qm-quick-tags" });
      for (const t of tags.slice(0, 8)) {
        const chip = bar.createSpan({ text: "#" + t, cls: "qm-quick-tag" });
        chip.onclick = () => {
          const cur = ta.value;
          ta.value = cur.replace(/\s+$/, "") + (cur.trim() ? " " : "") + "#" + t + " ";
          this.dismissDraftHint();
          ta.focus();
        };
      }
    })();
    contentEl.createEl("div", {
      cls: "qm-hint",
      text: "Enter \u6362\u884C \xB7 Ctrl+Enter \u4FDD\u5B58 \xB7 Esc \u53D6\u6D88"
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit(ta.value);
      }
    });
    const bar2 = contentEl.createDiv({ cls: "qm-edit-bar" });
    const cancel = bar2.createEl("button", { text: "\u53D6\u6D88", cls: "qm-mini-btn" });
    cancel.onclick = () => this.close();
    const ok = bar2.createEl("button", { text: "\u4FDD\u5B58", cls: "qm-mini-btn is-primary" });
    ok.onclick = () => this.submit(ta.value);
    window.setTimeout(() => ta.focus(), 30);
  }
  /** 开始改动就把「已恢复上次没记完的内容」收掉，不再一直显示 */
  dismissDraftHint() {
    if (!this._draftHintEl) return;
    this._draftHintEl.remove();
    this._draftHintEl = null;
  }
  async submit(value) {
    const text = String(value || "").trim();
    this._closingBySubmit = true;
    if (!text) {
      this.close();
      await this.plugin.clearDraft();
      return;
    }
    this.close();
    if (await this.plugin.appendCard(text)) {
      this._draftRestored = false;
      await this.plugin.clearDraft();
    } else {
      await this.plugin.saveDraft(text);
    }
  }
  onClose() {
    if (!this._closingBySubmit && this._ta) {
      const v = String(this._ta.value || "");
      if (v.trim()) void this.plugin.saveDraft(v);
      else if (this._draftRestored) void this.plugin.clearDraft();
    }
    this._draftHintEl = null;
    if (this._suggest) {
      this._suggest.destroy();
      this._suggest = null;
    }
    this.contentEl.empty();
  }
};
var QM_TAG_SEP = "/";
function qmSegs(tag) {
  if (typeof tag !== "string") return [];
  const out = [];
  for (const raw of tag.split(QM_TAG_SEP)) {
    const s = raw.trim();
    if (s) out.push(s);
  }
  return out;
}
function qmLowerPath(path) {
  return qmSegs(path).map((s) => s.toLowerCase()).join(QM_TAG_SEP);
}
function qmPickLabel(freq) {
  let best = "";
  let bestN = -1;
  for (const [label, n] of freq) {
    if (n > bestN) {
      best = label;
      bestN = n;
    } else if (n === bestN && label < best) {
      best = label;
    }
  }
  return best;
}
function qmBuildTagForest(cards) {
  const index = /* @__PURE__ */ new Map();
  const list = cards || [];
  let untagged = 0;
  for (let i = 0; i < list.length; i++) {
    const card = list[i] || {};
    const seen = /* @__PURE__ */ new Set();
    let hasTag = false;
    for (const t of card.tags || []) {
      const segs = qmSegs(t);
      if (!segs.length) continue;
      hasTag = true;
      for (let d = 1; d <= segs.length; d++) {
        const part = segs.slice(0, d);
        const key = part.map((x) => x.toLowerCase()).join(QM_TAG_SEP);
        let node = index.get(key);
        if (!node) {
          node = { key, labelFreq: /* @__PURE__ */ new Map(), cards: /* @__PURE__ */ new Set() };
          index.set(key, node);
        }
        const label = part.join(QM_TAG_SEP);
        node.labelFreq.set(label, (node.labelFreq.get(label) || 0) + 1);
        if (!seen.has(key)) {
          node.cards.add(i);
          seen.add(key);
        }
      }
    }
    if (!hasTag) untagged++;
  }
  const nodes = /* @__PURE__ */ new Map();
  for (const [key, n] of index) {
    const path = qmPickLabel(n.labelFreq);
    nodes.set(key, {
      key,
      path,
      label: qmSegs(path).slice(-1)[0] || path,
      count: n.cards.size,
      children: []
    });
  }
  const roots = [];
  for (const [key, node] of nodes) {
    const cut = key.lastIndexOf(QM_TAG_SEP);
    const parent = cut < 0 ? null : nodes.get(key.slice(0, cut));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (arr) => {
    arr.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"));
    for (const n of arr) sortNodes(n.children);
  };
  sortNodes(roots);
  return { tree: roots, untagged };
}
function qmCountTagDescendants(node) {
  let n = 0;
  for (const ch of node && node.children || []) {
    n += 1 + qmCountTagDescendants(ch);
  }
  return n;
}
function qmDaysAgo(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  then.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - then) / 864e5));
}
function qmCardHasPath(card, pathLower) {
  const want = qmSegs(pathLower).map((s) => s.toLowerCase());
  if (!want.length) return false;
  for (const t of card && card.tags || []) {
    const segs = qmSegs(t).map((x) => x.toLowerCase());
    if (segs.length < want.length) continue;
    let ok = true;
    for (let i = 0; i < want.length; i++) {
      if (segs[i] !== want[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
function qmCardIsUntagged(card) {
  for (const t of card && card.tags || []) {
    if (qmSegs(t).length) return false;
  }
  return true;
}
var CardsView = class extends ItemView2 {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.state = {
      search: "",
      // 标签筛选：多选，取并集（存完整路径，保留原始大小写）
      tags: [],
      // 「无标签」筛选：与标签多选互斥
      untagged: false,
      // 引用筛选：'' 全部 / 'has' 只看已引用 / 'none' 只看未引用
      refFilter: "",
      // 筛选浮层是否展开
      filterOpen: false,
      // 标签树的展开状态（按小写路径记）
      expanded: {},
      editingKey: null,
      // 正在编辑但还没保存的文本：列表被重画时用它恢复，避免白打一遍
      editingDraft: null,
      cards: [],
      // 卡片视图：list 保留日期时间线；grid 只铺卡片、不显示日期头
      view: "list",
      // 折叠的日期（只影响渲染，不改文件）
      collapsed: new Set(plugin.settings && plugin.settings.collapsedDates || []),
      // 多选删除
      selectMode: false,
      selected: /* @__PURE__ */ new Set(),
      // 回看：覆盖式视图，只在内存里
      reviewOpen: false,
      review: [],
      // 目标笔记里已有的块 ID：「已插入」以笔记内容为准，不是「这一轮点过没有」
      insertedIds: /* @__PURE__ */ new Set(),
      // 这一轮展示过哪些卡：换一批时尽量不重样
      reviewShown: /* @__PURE__ */ new Set(),
      // 只给没有块 ID 的老卡用（没法从内容判断，只能记这一轮）
      reviewDone: {},
      // 追加区：展开过的卡片、正在写的追加、正在改的某条追加
      appendOpen: /* @__PURE__ */ new Set(),
      appendDraft: null,
      appendEdit: null
    };
    this._lastDown = 0;
    this._dblRisk = false;
    this._noIdHint = false;
    this._refBadges = /* @__PURE__ */ new Map();
  }
  getViewType() {
    return VIEW_TYPE_QM;
  }
  getDisplayText() {
    return "Noval";
  }
  getIcon() {
    return ICON_ID;
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("qm-view");
    const wrap = root.createDiv({ cls: "qm-root" });
    this.wrapEl = wrap;
    const composer = wrap.createDiv({ cls: "qm-composer" });
    this.inputEl = composer.createEl("textarea", { cls: "qm-input" });
    this.inputEl.setAttr("placeholder", "\u8BB0\u5F55\u4E00\u4E0B\u2026");
    this.inputEl.rows = 2;
    this._manualH = false;
    this.autoGrow = () => {
      if (this._manualH) return;
      const el = this.inputEl;
      el.style.height = "auto";
      el.style.height = Math.min(160, el.scrollHeight) + "px";
    };
    this.draftHintEl = null;
    this._draftRestored = false;
    const draft = this.plugin.draftAlive();
    if (draft) {
      this.inputEl.value = draft;
      this._draftRestored = true;
      this.autoGrow();
      this.draftHintEl = composer.createDiv({
        cls: "qm-draft-hint",
        text: "\u5DF2\u6062\u590D\u4E0A\u6B21\u6CA1\u8BB0\u5B8C\u7684\u5185\u5BB9"
      });
    }
    const compFoot = composer.createDiv({ cls: "qm-composer-foot" });
    compFoot.createSpan({ cls: "qm-kbd-hint", text: "Ctrl+Enter \u8BB0\u4E0B" });
    this.saveBtnEl = compFoot.createEl("button", { cls: "qm-save", text: "\u8BB0\u4E0B" });
    this.saveBtnEl.onclick = () => this.saveInput();
    const grip = composer.createDiv({ cls: "qm-grip" });
    grip.setAttr("title", "\u4E0A\u4E0B\u62D6\u52A8\uFF0C\u8C03\u6574\u8F93\u5165\u6846\u9AD8\u5EA6\uFF08\u53CC\u51FB\u8FD8\u539F\uFF09");
    grip.setAttr("aria-label", "\u8C03\u6574\u8F93\u5165\u6846\u9AD8\u5EA6");
    grip.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M10 3 3 10"/><path d="M10 6.4 6.4 10"/></svg>';
    grip.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this._manualH = true;
      const startY = e.clientY;
      const startH = this.inputEl.offsetHeight || 38;
      const doc = this.inputEl.ownerDocument || document;
      try {
        if (grip.setPointerCapture && e.pointerId != null) grip.setPointerCapture(e.pointerId);
      } catch (err) {
      }
      const onMove = (ev) => {
        const h = Math.max(38, Math.min(400, startH + (ev.clientY - startY)));
        this.inputEl.style.height = h + "px";
      };
      const stop = () => {
        doc.removeEventListener("pointermove", onMove);
        doc.removeEventListener("pointerup", stop);
        doc.removeEventListener("pointercancel", stop);
        try {
          if (grip.releasePointerCapture && e.pointerId != null) grip.releasePointerCapture(e.pointerId);
        } catch (err) {
        }
      };
      doc.addEventListener("pointermove", onMove);
      doc.addEventListener("pointerup", stop);
      doc.addEventListener("pointercancel", stop);
    });
    grip.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this._manualH = false;
      this.inputEl.style.height = "";
      this.autoGrow();
    });
    this.syncSaveBtn = () => {
      if (!this.saveBtnEl) return;
      const empty = !String(this.inputEl.value || "").trim();
      this.saveBtnEl.disabled = empty;
      this.saveBtnEl.toggleClass("is-disabled", empty);
    };
    this.syncSaveBtn();
    this.inputEl.addEventListener("input", () => {
      this.autoGrow();
      this.dismissDraftHint();
      this.syncSaveBtn();
      this.plugin.queueDraft(this.inputEl.value);
    });
    this.tagSuggest = new TagSuggest(this.inputEl, composer, () => this.tagPool());
    this.inputEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.saveInput();
      }
    });
    const toolrow = wrap.createDiv({ cls: "qm-toolrow" });
    this.toolRowEl = toolrow;
    const searchbox = toolrow.createDiv({ cls: "qm-searchbox" });
    const sIco = searchbox.createSpan({ cls: "qm-search-ico" });
    qmIcon(sIco, "search");
    this.searchEl = searchbox.createEl("input", { cls: "qm-search" });
    this.searchEl.setAttr("type", "text");
    this.searchEl.setAttr("placeholder", "\u641C\u7D22\u5361\u7247\u3001#\u6807\u7B7E\u3001\u65E5\u671F");
    this.syncSearchClear = () => {
      if (!this.searchClearEl) return;
      this.searchClearEl.toggleClass("is-visible", !!String(this.searchEl.value || "").trim());
    };
    this.searchEl.addEventListener("input", () => {
      this.syncSearchClear();
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._searchTimer = null;
        this.state.search = this.searchEl.value.trim();
        if (this.state.selectMode) this.state.selected.clear();
        this.renderChips();
        this.renderFilterBtnState();
        this.renderList();
      }, 120);
    });
    this.searchClearEl = searchbox.createEl("button", {
      cls: "qm-search-clear",
      text: "\xD7"
    });
    this.searchClearEl.setAttr("aria-label", "\u6E05\u7A7A\u641C\u7D22");
    this.searchClearEl.onclick = () => {
      this.searchEl.value = "";
      this.state.search = "";
      this.syncSearchClear();
      if (this.state.selectMode) this.state.selected.clear();
      this.renderChips();
      this.renderFilterBtnState();
      this.renderList();
      this.searchEl.focus();
    };
    const reviewBtn = toolrow.createEl("button", { cls: "qm-icon-btn" });
    reviewBtn.setAttr("type", "button");
    reviewBtn.setAttr("aria-label", "\u56DE\u770B");
    reviewBtn.setAttr("title", "\u56DE\u770B\uFF08\u7FFB\u51E0\u5F20\u65E7\u5361\u7247\uFF09");
    qmIcon(reviewBtn, "review");
    reviewBtn.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      this.openReview();
    };
    this.filterBtnEl = toolrow.createEl("button", { cls: "qm-icon-btn" });
    this.filterBtnEl.setAttr("type", "button");
    this.filterBtnEl.setAttr("aria-label", "\u7B5B\u9009");
    this.filterBtnEl.setAttr("title", "\u7B5B\u9009");
    qmIcon(this.filterBtnEl, "filter");
    this.filterDotEl = this.filterBtnEl.createSpan({ cls: "qm-filter-dot is-hidden" });
    this.filterBtnEl.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      this.toggleFilterPanel();
    };
    this.moreBtnEl = toolrow.createEl("button", { cls: "qm-icon-btn" });
    this.moreBtnEl.setAttr("type", "button");
    this.moreBtnEl.setAttr("aria-label", "\u66F4\u591A");
    this.moreBtnEl.setAttr("title", "\u66F4\u591A");
    qmIcon(this.moreBtnEl, "more");
    this.moreBtnEl.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      this.openMoreMenu(e);
    };
    this.popEl = wrap.createDiv({ cls: "qm-pop" });
    this.chipsEl = wrap.createDiv({ cls: "qm-chips" });
    this.listEl = wrap.createDiv({ cls: "qm-list" });
    this.selectBarEl = wrap.createDiv({ cls: "qm-selbar" });
    this.reviewEl = wrap.createDiv({ cls: "qm-review" });
    this._onDocDown = (e) => {
      if (!this.state || !this.state.filterOpen) return;
      const t = e.target;
      if (t && t.isConnected === false) return;
      if (t && typeof t.closest === "function" && t.closest(".qm-pop")) return;
      if (t && this.filterBtnEl && typeof this.filterBtnEl.contains === "function") {
        if (t === this.filterBtnEl || this.filterBtnEl.contains(t)) return;
      }
      this.closeFilterPanel();
    };
    document.addEventListener("mousedown", this._onDocDown, true);
    this.registerDomEvent(window, "resize", () => {
      this.syncSelbarGap();
    });
    try {
      if (typeof ResizeObserver === "function" && this.wrapEl) {
        const ro = new ResizeObserver(() => this.syncSelbarGap());
        ro.observe(this.wrapEl);
        this.register(() => ro.disconnect());
      }
    } catch (e) {
    }
    const onChange = async (f, oldPath) => {
      if (!(f instanceof TFile)) return;
      const inFolder = this.plugin.isCardFilePath(f.path) || oldPath && this.plugin.isCardFilePath(oldPath);
      if (!inFolder) return;
      if (await this.plugin.isOwnWrite(f)) return;
      this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(this.app.vault.on("rename", onChange));
    await this.refresh();
    this.syncSelbarGap();
  }
  async onClose() {
    try {
      this.closeMenu();
    } catch (e) {
    }
    if (this._onDocDown) {
      document.removeEventListener("mousedown", this._onDocDown, true);
      this._onDocDown = null;
    }
    if (this.inputEl) {
      const v = String(this.inputEl.value || "");
      if (v.trim()) void this.plugin.saveDraft(v);
      else if (this._draftRestored) void this.plugin.clearDraft();
    }
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }
    if (this.tagSuggest) {
      this.tagSuggest.destroy();
      this.tagSuggest = null;
    }
    this.contentEl.empty();
  }
  /** 标签候选池：卡片数据没换就直接复用，避免每敲一个字重算一遍 */
  tagPool() {
    const cards = this.state ? this.state.cards : [];
    if (!this._tagCache || this._tagCache.ref !== cards) {
      this._tagCache = {
        ref: cards,
        list: collectAllTags(cards, this.plugin.settings.quickTags)
      };
    }
    return this._tagCache.list;
  }
  /**
   * 外部改动（编辑器手改、同步、别处写入）触发的重读。
   * 编辑器里连续敲字会连发很多次 modify，合并成一次，别每敲一下重建整个列表。
   */
  scheduleRefresh() {
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      this.refresh();
    }, 150);
  }
  /** 开始改动就把「已恢复上次没记完的内容」收掉，不再一直显示 */
  dismissDraftHint() {
    if (!this.draftHintEl) return;
    this.draftHintEl.remove();
    this.draftHintEl = null;
  }
  insertTag(tag) {
    const cur = this.inputEl.value;
    const add = "#" + tag + " ";
    const needsSpace = cur.length > 0 && !/\s$/.test(cur);
    this.inputEl.value = cur + (needsSpace ? " " : "") + add;
    this.dismissDraftHint();
    this.inputEl.focus();
  }
  async saveInput() {
    const text = String(this.inputEl.value || "").trim();
    if (!text) {
      new Notice2("\u5199\u70B9\u4EC0\u4E48\u518D\u8BB0\u4E0B\u5427");
      return;
    }
    const ok = await this.plugin.appendCard(text);
    if (!ok) return;
    this.inputEl.value = "";
    this._manualH = false;
    if (this.inputEl.style) this.inputEl.style.height = "";
    if (this.autoGrow) this.autoGrow();
    if (this.syncSaveBtn) this.syncSaveBtn();
    this.dismissDraftHint();
    this._draftRestored = false;
    await this.plugin.clearDraft();
    this.inputEl.focus();
  }
  async refresh() {
    if (this._refreshing) {
      this._dirty = true;
      return;
    }
    this._refreshing = true;
    try {
      const cards = await this.plugin.readAllCards();
      if (!this.state) return;
      this.state.cards = cards;
      this._loadedOnce = true;
      this.plugin.refreshRefs();
      this.renderFilters();
      this.renderList();
      if (this.state.reviewOpen) {
        this.syncReview();
        this.renderReview();
      }
    } finally {
      this._refreshing = false;
      if (this._dirty) {
        this._dirty = false;
        this.refresh();
      }
    }
  }
  /**
   * 插件自己写完一个文件后的定向更新：只重解析这一个文件，
   * 换掉它在列表里的那部分，其它月份不重读。省掉一次整文件夹重读。
   */
  applyFileCards(path, content) {
    if (!this.state) return;
    if (!this._loadedOnce) {
      this.refresh();
      return;
    }
    const next = parseCards(content, path, {
      strict: this.plugin.settings.strictCardId !== false
    });
    const rest = this.state.cards.filter((c) => c.filePath !== path);
    this.state.cards = sortCards(rest.concat(next));
    if (this.state.selected && this.state.selected.size) {
      const alive = new Set(this.state.cards.map((c) => this.cardKey(c)));
      for (const k of Array.from(this.state.selected)) {
        if (!alive.has(k)) this.state.selected.delete(k);
      }
    }
    this.renderFilters();
    this.renderList({ keepScroll: true });
    if (this.state.reviewOpen) {
      this.syncReview();
      this.renderReview();
    }
    if (this._refreshing) this._dirty = true;
  }
  /** 数据没变、只是要更新一下界面文字（比如「最近删除」条数） */
  rerender() {
    if (!this.state || !this._loadedOnce) return;
    this.renderFilters();
    this.renderList();
    if (this.state.reviewOpen) {
      this.syncReview();
      this.renderReview();
    }
  }
  /**
   * 回看是内存里的一批旧对象：卡片被改 / 删之后要把它们换成本轮的新对象，
   * 否则展开追加、编辑时改的还是旧内容。找不到的就从这一批里移除。
   */
  syncReview() {
    if (!Array.isArray(this.state.review)) return;
    const cards = this.state.cards || [];
    const used = /* @__PURE__ */ new Set();
    const next = [];
    for (const old of this.state.review) {
      const ok = this.cardKey(old);
      let hit = cards.find((c) => !used.has(this.cardKey(c)) && this.cardKey(c) === ok);
      if (!hit) {
        hit = cards.find(
          (c) => !used.has(this.cardKey(c)) && c.filePath === old.filePath && c.date === old.date && c.time === old.time
        );
      }
      if (!hit) continue;
      used.add(this.cardKey(hit));
      next.push(hit);
    }
    this.state.review = next;
  }
  /** 引用筛选的实际生效值：索引没建好时一律按「全部」，免得把卡片全判成未引用 */
  effectiveRefFilter() {
    const v = this.state.refFilter;
    if (!v) return "";
    if (!this.plugin.refsReady()) return "";
    return v;
  }
  setRefFilter(v) {
    this.state.refFilter = v || "";
    if (this.state.selectMode) this.state.selected.clear();
    this.renderFilters();
    this.renderList();
  }
  /** 现在有几项筛选在生效（引用算一项，标签每个算一项，无标签算一项） */
  /** 生效条件数：搜索词也算一条，跟 chips 上看到的一致 */
  activeFilterCount() {
    return (String(this.state.search || "").trim() ? 1 : 0) + (this.state.refFilter ? 1 : 0) + (this.state.tags || []).length + (this.state.untagged ? 1 : 0);
  }
  /** 筛选按钮的「亮着」与右下小圆点：有生效条件才亮 */
  renderFilterBtnState() {
    if (!this.filterBtnEl) return;
    const n = this.activeFilterCount();
    this.filterBtnEl.toggleClass("is-active", n > 0);
    if (this.filterDotEl) this.filterDotEl.toggleClass("is-hidden", !n);
  }
  /** chips / 面板 / 按钮一次性对齐；数据没变（比如只改了引用索引）时也能安全调用 */
  renderFilters() {
    this.renderChips();
    this.renderFilterBtnState();
    if (this.state.filterOpen) {
      this.renderFilterPanel();
      this.positionPop();
      this.fitPopHeight();
      this.updateTreeMore();
    }
    this.syncListGap();
  }
  /* ---------------- 标签：父子树 + 多选 ---------------- */
  /** 标签森林按 cards 引用缓存：同一批卡片不为每次重画重算一遍 */
  tagForest() {
    const cards = this.state.cards;
    if (!this._forest || this._forest.ref !== cards) {
      const f = qmBuildTagForest(cards);
      this._forest = { ref: cards, tree: f.tree, untagged: f.untagged };
    }
    return this._forest;
  }
  isTagSelected(keyLower) {
    return (this.state.tags || []).some((t) => qmLowerPath(t) === keyLower);
  }
  /** 最近的、已被选中的祖先：用于「已包含在 #写作 里」的提示 */
  selectedAncestorPath(keyLower) {
    const parts = String(keyLower || "").split(QM_TAG_SEP);
    for (let i = parts.length - 1; i >= 1; i--) {
      const p = parts.slice(0, i).join(QM_TAG_SEP);
      const hit = (this.state.tags || []).find((t) => qmLowerPath(t) === p);
      if (hit) return hit;
    }
    return "";
  }
  /** 这个节点的后代里有没有被选中的（用于半选状态） */
  hasSelectedBelow(node) {
    for (const ch of node.children || []) {
      if (this.isTagSelected(ch.key) || this.hasSelectedBelow(ch)) return true;
    }
    return false;
  }
  /** 勾一个标签：被祖先覆盖时忽略；已选则取消；未选则加入，并把它下面已选的子标签合并掉 */
  toggleTagFilter(path) {
    const key = qmLowerPath(path);
    if (!key) return;
    const anc = this.selectedAncestorPath(key);
    if (anc) {
      new Notice2("\u5DF2\u5305\u542B\u5728 #" + anc + " \u91CC");
      return;
    }
    const cur = (this.state.tags || []).slice();
    const at = cur.findIndex((t) => qmLowerPath(t) === key);
    if (at >= 0) {
      cur.splice(at, 1);
    } else {
      const rest = cur.filter((t) => qmLowerPath(t).indexOf(key + QM_TAG_SEP) !== 0);
      cur.length = 0;
      for (const t of rest) cur.push(t);
      cur.push(path);
      this.state.expanded[key] = true;
    }
    this.state.untagged = false;
    this.state.tags = cur;
    if (this.state.selectMode) this.state.selected.clear();
    this.renderFilters();
    this.renderList();
  }
  setFilterTags(list) {
    this.state.tags = (list || []).filter(Boolean);
    if (this.state.tags.length) this.state.untagged = false;
    if (this.state.selectMode) this.state.selected.clear();
    this.renderFilters();
    this.renderList();
  }
  clearFilters() {
    this.state.refFilter = "";
    this.state.tags = [];
    this.state.untagged = false;
    this.state.search = "";
    if (this.searchEl) this.searchEl.value = "";
    if (this.syncSearchClear) this.syncSearchClear();
    if (this.state.selectMode) this.state.selected.clear();
    this.renderFilters();
    this.renderList();
  }
  /* ---------------- 生效条件 chips ---------------- */
  chipParts() {
    const parts = [];
    const kw = String(this.state.search || "").trim();
    if (kw) {
      parts.push({
        text: "\u201C" + kw + "\u201D",
        sub: "",
        clear: () => {
          this.state.search = "";
          if (this.searchEl) this.searchEl.value = "";
          if (this.syncSearchClear) this.syncSearchClear();
          if (this.state.selectMode) this.state.selected.clear();
          this.renderFilters();
          this.renderList();
        }
      });
    }
    const rf = this.state.refFilter;
    if (rf) {
      parts.push({
        text: rf === "has" ? "\u5DF2\u5F15\u7528" : "\u672A\u5F15\u7528",
        sub: "",
        clear: () => this.setRefFilter("")
      });
    }
    if (this.state.untagged) {
      parts.push({
        text: "\u65E0\u6807\u7B7E",
        sub: "",
        clear: () => {
          this.state.untagged = false;
          this.renderFilters();
          this.renderList();
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
    for (const t of this.state.tags || []) {
      const node = index.get(qmLowerPath(t));
      const kids = node ? qmCountTagDescendants(node) : 0;
      parts.push({
        text: "#" + t,
        sub: kids ? "\u542B " + kids : "",
        clear: () => this.setFilterTags((this.state.tags || []).filter((x) => x !== t))
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
      return;
    }
    el.addClass("show");
    const MAX = 3;
    const shown = parts.slice(0, MAX);
    for (const p of shown) {
      const chip = el.createSpan({ cls: "qm-chip" });
      chip.createSpan({ text: p.text });
      if (p.sub) chip.createEl("em", { text: p.sub });
      const x = chip.createEl("button", { text: "\xD7" });
      x.setAttr("aria-label", "\u6E05\u9664");
      x.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        p.clear();
      };
    }
    const rest = parts.length - shown.length;
    if (rest > 0) {
      const more = el.createSpan({ cls: "qm-chip qm-chip-more", text: "+" + rest });
      more.setAttr("title", "\u8FD8\u6709 " + rest + " \u4E2A\u6761\u4EF6");
      more.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.openFilterPanel();
      };
    }
    if (this.state && this.state.filterOpen) this.positionPop();
  }
  /* ---------------- 筛选浮层 ---------------- */
  toggleFilterPanel() {
    if (this.state.filterOpen) this.closeFilterPanel();
    else this.openFilterPanel();
  }
  openFilterPanel() {
    this.state.filterOpen = true;
    this.renderChips();
    this.renderFilterPanel();
    this.positionPop();
    if (this.popEl) this.popEl.addClass("show");
    this.fitPopHeight();
    this.updateTreeMore();
    this.syncListGap();
  }
  closeFilterPanel() {
    this.state.filterOpen = false;
    if (this.popEl) this.popEl.removeClass("show");
    this.syncListGap();
  }
  /** 浮层跟着工具行（和 chips）走：面板不参与布局，位置只能自己算 */
  positionPop() {
    const pop = this.popEl;
    const bar = this.toolRowEl;
    if (!pop || !bar) return;
    let top = 0;
    if (typeof bar.offsetTop === "number") {
      top = bar.offsetTop + bar.offsetHeight + 6;
    } else if (typeof bar.getBoundingClientRect === "function" && this.wrapEl) {
      const wr = this.wrapEl.getBoundingClientRect();
      const tr = bar.getBoundingClientRect();
      top = tr.bottom - wr.top + 6;
    }
    if (this.chipParts().length && this.chipsEl && typeof this.chipsEl.offsetHeight === "number") {
      top += this.chipsEl.offsetHeight + 7;
    }
    pop.style.top = Math.max(0, Math.round(top)) + "px";
  }
  /**
   * 侧栏不高的时候，面板底部会顶出可视区（外面 overflow:hidden 会把它切掉）。
   * 这时把标签窗口收一点，保证「清除筛选」和最后几行永远能看到。
   */
  fitPopHeight() {
    const pop = this.popEl;
    const wrap = this.wrapEl;
    const tree = this.treeEl;
    if (!pop || !wrap || !tree) return;
    if (!wrap.clientHeight) return;
    tree.style.height = "";
    const top = parseFloat(pop.style.top || "0") || 0;
    const avail = wrap.clientHeight - top - 10;
    const need = pop.offsetHeight;
    if (need > avail) {
      const h = Math.max(88, QM_TREE_H - (need - avail));
      tree.style.height = h + "px";
    }
  }
  /**
   * 面板是覆盖式浮层（和截图一致）：打开时卡片区不位移、不被挤压，
   * 面板像菜单一样浮在列表上面。关掉就恢复原样。
   * 早期版本往列表上补过一段 padding（怕结果被面板挡住），那会让卡片整体下跳，已去掉。
   */
  syncListGap() {
    const list = this.listEl;
    if (!list) return;
    if (list.style.paddingTop) list.style.paddingTop = "";
  }
  renderFilterPanel() {
    const el = this.popEl;
    if (!el) return;
    const keepTop = this.treeEl ? this.treeEl.scrollTop || 0 : 0;
    el.empty();
    el.createDiv({ cls: "qm-pop-title", text: "\u7B5B\u9009" });
    el.createDiv({ cls: "qm-pop-label", text: "\u5F15\u7528\u60C5\u51B5" });
    const seg = el.createDiv({ cls: "qm-seg" });
    const refOpts = [["", "\u5168\u90E8"], ["has", "\u5DF2\u5F15\u7528"], ["none", "\u672A\u5F15\u7528"]];
    for (const [v, label] of refOpts) {
      const b = seg.createEl("button", {
        text: label,
        cls: this.state.refFilter === v ? "on" : ""
      });
      b.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.setRefFilter(v);
      };
    }
    const lab = el.createDiv({ cls: "qm-pop-label" });
    lab.createSpan({ text: "\u6807\u7B7E" });
    if ((this.state.tags || []).length) {
      lab.createSpan({ cls: "qm-pop-sel", text: "\u5DF2\u9009 " + this.state.tags.length });
    }
    const treeWrap = el.createDiv({ cls: "qm-tree-wrap" });
    const tree = treeWrap.createDiv({ cls: "qm-tagtree" });
    this.treeEl = tree;
    tree.addEventListener("scroll", () => this.updateTreeMore());
    const forest = this.tagForest();
    const un = tree.createDiv({
      cls: "qm-tnode qm-tnode-untagged" + (this.state.untagged ? " is-on" : "")
    });
    un.setAttr("title", "\u53EA\u770B\u6CA1\u6709\u5199\u6807\u7B7E\u7684\u5361\u7247");
    un.createSpan({ cls: "qm-caret is-blank" });
    un.createSpan({ cls: "qm-tname", text: "\u65E0\u6807\u7B7E" });
    un.createSpan({ cls: "qm-tcount", text: String(forest.untagged) });
    un.createSpan({ cls: "qm-tmark", text: "\u2713" });
    un.onclick = () => {
      this.state.untagged = !this.state.untagged;
      if (this.state.untagged) this.state.tags = [];
      if (this.state.selectMode) this.state.selected.clear();
      this.renderFilters();
      this.renderList();
    };
    for (const node of forest.tree) this.renderTagNode(tree, node, 0);
    const foot = el.createDiv({ cls: "qm-pop-foot" });
    const clear = foot.createEl("button", { cls: "qm-link-btn", text: "\u6E05\u9664\u7B5B\u9009" });
    clear.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
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
  /**
   * 标签树的一行：折叠三角 / 名字 / 命中数 / 勾选框。
   * 三种状态互斥：自己选中 → 后代选中（半选）→ 祖先已选、被覆盖（淡色勾，不可点）。
   */
  renderTagNode(parent, node, depth) {
    const key = node.key;
    const sel = this.isTagSelected(key);
    const covered = !sel && !!this.selectedAncestorPath(key);
    const some = !sel && !covered && this.hasSelectedBelow(node);
    const open = !!this.state.expanded[key];
    const kids = node.children.length > 0;
    const row = parent.createDiv({
      cls: "qm-tnode" + (sel ? " is-on" : "") + (some ? " is-some" : "") + (covered ? " is-inherit" : "") + (depth ? " is-child" : "")
    });
    row.setAttr("title", "#" + node.path + " \xB7 " + node.count + " \u6761");
    const caret = row.createSpan({
      cls: "qm-caret" + (kids ? "" : " is-blank"),
      text: kids ? open ? "\u25BE" : "\u25B8" : ""
    });
    caret.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      if (!kids) return;
      if (this.state.expanded[key]) delete this.state.expanded[key];
      else this.state.expanded[key] = true;
      this.renderFilterPanel();
      this.syncListGap();
    };
    row.createSpan({ cls: "qm-tname", text: (depth ? "" : "#") + node.label });
    row.createSpan({ cls: "qm-tcount", text: String(node.count) });
    row.createSpan({ cls: "qm-tmark", text: "\u2713" });
    row.onclick = () => this.toggleTagFilter(node.path);
    if (kids && open) {
      const box = parent.createDiv({ cls: "qm-tchildren" });
      for (const ch of node.children) this.renderTagNode(box, ch, depth + 1);
    }
  }
  /** 标签窗口还有内容没露出来时，底部渐隐提示「还能往下翻」 */
  updateTreeMore() {
    const tree = this.treeEl;
    const wrap = tree && (tree.parentNode || tree.parent);
    if (!tree || !wrap) return;
    const rest = (tree.scrollHeight || 0) - (tree.scrollTop || 0) - (tree.clientHeight || 0);
    wrap.toggleClass("more", rest > 0.5);
  }
  /* ---------------- 下拉菜单（自绘，贴着按钮） ---------------- */
  /**
   * 原来用 Obsidian 原生 Menu：它固定在鼠标点、宽度也不受控，侧栏里总是偏一块。
   * 这里自己画一个：贴着触发按钮、右边缘对齐，放不下就翻到上方。
   * 返回的 items 是普通对象数组（每项带 click()），调用方只认这个。
   */
  showMenu(items, anchor) {
    for (const it of items) {
      if (!it.click) {
        it.click = () => {
          if (!it.disabled && it.onClick) it.onClick();
        };
      }
    }
    this.menuItems = items;
    if (this.menuOpen && anchor && this.menuAnchor === anchor) {
      this.closeMenu();
      return { items };
    }
    this.closeMenu();
    const root = this.wrapEl;
    const canPaint = typeof document !== "undefined" && !!document.body && !!anchor && typeof anchor.getBoundingClientRect === "function" && !!root && typeof root.getBoundingClientRect === "function" && typeof root.createDiv === "function";
    if (!canPaint) return { items };
    if (this.state && this.state.filterOpen) this.closeFilterPanel();
    const menu = root.createDiv({ cls: "qm-menu" });
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
    const rr = root.getBoundingClientRect();
    const pos = qmMenuPlace(ar, rr, menu.offsetWidth || 200, menu.offsetHeight || 0);
    menu.style.left = pos.left + "px";
    menu.style.top = pos.top + "px";
    this.menuEl = menu;
    this.menuAnchor = anchor;
    this.menuOpen = true;
    const onDown = (e) => {
      const t = e.target;
      if (t && menu.contains && menu.contains(t)) return;
      if (t && anchor.contains && anchor.contains(t)) return;
      this.closeMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") this.closeMenu();
    };
    const onScroll = () => this.closeMenu();
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    if (this.listEl && this.listEl.addEventListener) {
      this.listEl.addEventListener("scroll", onScroll, { passive: true });
    }
    this._menuOff = () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      if (this.listEl && this.listEl.removeEventListener) {
        this.listEl.removeEventListener("scroll", onScroll);
      }
    };
    return { items };
  }
  closeMenu() {
    if (this._menuOff) {
      this._menuOff();
      this._menuOff = null;
    }
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    this.menuAnchor = null;
    this.menuOpen = false;
  }
  openMoreMenu(evt) {
    const anchor = this.moreBtnEl || evt && evt.currentTarget || null;
    const hit = this.filtered().length;
    const total = this.state.cards.length;
    const cap = this.plugin.settings.maxCards;
    const capNote = cap > 0 && hit > cap ? " \xB7 \u663E\u793A\u6700\u8FD1 " + cap : "";
    const countLine = (hit === total ? "\u5171 " + total + " \u6761\u5361\u7247" : "\u5171 " + total + " \u6761 \xB7 \u547D\u4E2D " + hit + " \u6761") + capNote;
    const n = (this.plugin.settings.trash || []).length;
    const items = [
      { title: countLine, icon: "arrow-right", disabled: true },
      { separator: true },
      {
        title: this.state.selectMode ? "\u9000\u51FA\u591A\u9009" : "\u591A\u9009",
        icon: "list-checks",
        onClick: () => this.toggleSelectMode()
      },
      {
        title: n ? "\u6700\u8FD1\u5220\u9664 " + n : "\u6700\u8FD1\u5220\u9664",
        icon: "trash-2",
        onClick: () => new TrashModal(this.app, this.plugin).open()
      },
      {
        title: "\u6253\u5F00\u672C\u6708\u6587\u4EF6",
        icon: "file-text",
        onClick: () => this.plugin.openCurrentMonthFile()
      },
      {
        title: "\u68C0\u67E5\u5B64\u513F\u5361\u7247",
        icon: "search-check",
        onClick: () => new OrphanModal(this.app, this.plugin).open()
      }
    ];
    return this.showMenu(items, anchor);
  }
  /* ---------------- 回看 ---------------- */
  openReview() {
    if (this.state.selectMode) {
      new Notice2("\u5148\u9000\u51FA\u591A\u9009\uFF0C\u518D\u770B\u56DE\u770B");
      return;
    }
    if (this.state.filterOpen) this.closeFilterPanel();
    this.state.reviewOpen = true;
    this.state.reviewDone = {};
    this.state.insertedIds = /* @__PURE__ */ new Set();
    this.state.reviewShown = /* @__PURE__ */ new Set();
    this.pickReview();
    this.renderReview();
    void this.scanInserted();
  }
  /**
   * 抽这一轮的卡片。
   * 旧卡优先（回看的意义是翻旧的）；旧卡不够一屏时用今天的补，
   * 否则刚记的卡永远进不来——库里只有四张旧卡时就会一直翻那四张。
   */
  pickReview() {
    const today = moment().format("YYYY-MM-DD");
    const cards = this.state.cards || [];
    const older = cards.filter((c) => c.date !== today);
    const fresh = cards.filter((c) => c.date === today);
    let pool = qmShuffle(older).concat(qmShuffle(fresh));
    const shown = this.state.reviewShown;
    if (shown && shown.size) {
      const rest = pool.filter((c) => !shown.has(this.cardKey(c)));
      if (rest.length >= QM_REVIEW_N) pool = rest;
    }
    this.state.review = pool.slice(0, QM_REVIEW_N);
    if (shown) for (const c of this.state.review) shown.add(this.cardKey(c));
  }
  /** 扫当前笔记里已有的块引用，用于判断「这张已经插过了」 */
  async scanInserted() {
    const token = this._scanToken = (this._scanToken || 0) + 1;
    const ids = /* @__PURE__ */ new Set();
    let file = null;
    try {
      file = this.plugin.currentNoteFile();
      const isNote = !!file && (file.extension === "md" || /\.md$/i.test(String(file.path || "")));
      if (isNote) {
        const text = String(await this.app.vault.cachedRead(file));
        const re = /#\^([A-Za-z0-9][A-Za-z0-9-]*)/g;
        let m = re.exec(text);
        while (m) {
          ids.add(m[1]);
          m = re.exec(text);
        }
      }
    } catch (e) {
    }
    if (token !== this._scanToken) return;
    if (!this.state.insertedIds) this.state.insertedIds = /* @__PURE__ */ new Set();
    for (const id of ids) this.state.insertedIds.add(id);
    if (this.state.reviewOpen) this.syncReviewInsertButtons();
  }
  /** 换了目标笔记：旧的「已插入」全部作废，按新笔记重扫 */
  rescanInserted() {
    this.state.insertedIds = /* @__PURE__ */ new Set();
    this.syncReviewInsertButtons();
    void this.scanInserted();
  }
  /** 按当前笔记内容刷新回看里所有「插入」按钮（不重画 DOM，滚动位置不动） */
  syncReviewInsertButtons() {
    const list = this._insertBtns || [];
    for (const it of list) this.paintInsertBtn(it.card, it.btn);
  }
  /** 一张卡的插入按钮该长什么样：已插入 / 插入全文（无块 ID）/ 插入到这篇 */
  paintInsertBtn(card, btn) {
    if (!card || !btn) return;
    const done = this.isInserted(card);
    const noId = !card.id;
    btn.setText(done ? "\u5DF2\u63D2\u5165" : noId ? "\u63D2\u5165\u5168\u6587" : "\u63D2\u5165\u5230\u8FD9\u7BC7");
    if (done) btn.addClass("is-done");
    else btn.removeClass("is-done");
  }
  /** 这张卡在这篇里了吗？有块 ID 就看笔记内容，没有就退回本轮标记 */
  isInserted(card) {
    if (!card) return false;
    if (card.id) return !!(this.state.insertedIds && this.state.insertedIds.has(card.id));
    return !!(this.state.reviewDone && this.state.reviewDone[this.cardKey(card)]);
  }
  closeReview() {
    this.state.reviewOpen = false;
    this._insertBtns = [];
    if (this.reviewEl) {
      this.reviewEl.removeClass("show");
      this.reviewEl.empty();
    }
    this.renderList({ keepScroll: true });
  }
  renderReview() {
    const el = this.reviewEl;
    if (!el) return;
    el.empty();
    this._insertBtns = [];
    if (!this.state.reviewOpen) {
      el.removeClass("show");
      return;
    }
    el.addClass("show");
    const head = el.createDiv({ cls: "qm-review-head" });
    const back = head.createEl("button", { cls: "qm-review-back" });
    back.setAttr("aria-label", "\u8FD4\u56DE\u5361\u7247");
    back.setAttr("title", "\u8FD4\u56DE\u5361\u7247");
    qmIcon(back, "back");
    back.onclick = () => this.closeReview();
    head.createSpan({ cls: "qm-review-title", text: "\u56DE\u770B" });
    const sh = head.createEl("button", { cls: "qm-review-shuffle", text: "\u6362\u4E00\u6279" });
    sh.onclick = () => {
      this.pickReview();
      this.renderReview();
    };
    el.createDiv({
      cls: "qm-review-sub",
      text: this.state.review.length ? "\u968F\u673A\u7FFB " + this.state.review.length + " \u5F20 \xB7 \u60F3\u653E\u8FDB\u6B63\u5728\u5199\u7684\u7B14\u8BB0\u5C31\u70B9\u300C\u63D2\u5165\u5230\u8FD9\u7BC7\u300D" : "\u5361\u7247\u8FD8\u4E0D\u591F\uFF0C\u5148\u53BB\u8BB0\u51E0\u6761\u5427"
    });
    const list = el.createDiv({ cls: "qm-review-list" });
    for (const card of this.state.review) {
      const key = this.cardKey(card);
      const sections = qmCardSections(card.body);
      const box = list.createDiv({ cls: "qm-rv-card" });
      const rhead = box.createDiv({ cls: "qm-rv-head" });
      const meta = rhead.createDiv({ cls: "qm-rv-meta" });
      meta.createSpan({ text: String(card.date || "").slice(5) + " " + card.time });
      meta.createSpan({ cls: "qm-rv-sep", text: "\xB7" });
      meta.createSpan({ text: qmDaysAgo(card.date) + " \u5929\u524D" });
      const nRef = this.plugin.refCount(card);
      if (nRef) {
        meta.createSpan({ cls: "qm-rv-sep", text: "\xB7" });
        meta.createSpan({ text: "\u88AB " + nRef + " \u7BC7\u5F15\u7528" });
      }
      this.mountAppendBadge(rhead, card, sections);
      const more = rhead.createEl("button", { cls: "qm-rv-more" });
      more.setAttr("type", "button");
      more.setAttr("aria-label", "\u66F4\u591A\u64CD\u4F5C");
      qmIcon(more, "more");
      more.onclick = (e) => {
        e.stopPropagation();
        this.openCardMenu(card, e);
      };
      box.addEventListener("dblclick", (e) => {
        const t = e.target;
        if (t && typeof t.closest === "function" && t.closest("a, .qm-tag, .qm-more, .qm-rv-more, button, .qm-append-badge, textarea")) {
          return;
        }
        if (e.preventDefault) e.preventDefault();
        this.requestEdit(card);
      });
      if (this.state.editingKey === key) {
        this.renderEditor(box, card, key);
        continue;
      }
      const body = box.createDiv({ cls: "qm-rv-body" });
      for (const seg of qmBodySegments(sections.original)) {
        if (seg.kind === "text") {
          body.appendChild(document.createTextNode(seg.text));
        } else if (seg.kind === "tag") {
          const tag = body.createSpan({ cls: "qm-tag", text: seg.text });
          tag.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            this.closeReview();
            this.state.search = "";
            if (this.searchEl) this.searchEl.value = "";
            if (this.syncSearchClear) this.syncSearchClear();
            this.setFilterTags([seg.value]);
          };
        } else {
          body.createSpan({ cls: "qm-rv-url", text: seg.text });
        }
      }
      this.renderAppendArea(box, card, sections);
      const foot = box.createDiv({ cls: "qm-rv-foot" });
      const noId = !card.id;
      const btn = foot.createEl("button", { cls: "qm-rv-insert" });
      if (noId) btn.setAttr("title", "\u8FD9\u5F20\u5361\u7247\u6CA1\u6709\u5757 ID\uFF0C\u53EA\u80FD\u63D2\u6B63\u6587\uFF0C\u6CA1\u6CD5\u5224\u65AD\u662F\u5426\u63D2\u8FC7");
      this.paintInsertBtn(card, btn);
      if (this._insertBtns) this._insertBtns.push({ card, btn });
      btn.onclick = async () => {
        if (this.isInserted(card)) {
          new Notice2("\u8FD9\u5F20\u5361\u7247\u5DF2\u7ECF\u5728\u8FD9\u7BC7\u7B14\u8BB0\u91CC\u4E86");
          return;
        }
        const okInserted = await this.plugin.insertIntoCurrentNote(card, false);
        if (!okInserted) return;
        if (card.id) {
          if (!this.state.insertedIds) this.state.insertedIds = /* @__PURE__ */ new Set();
          this.state.insertedIds.add(card.id);
        } else {
          this.state.reviewDone[key] = true;
        }
        this.paintInsertBtn(card, btn);
      };
    }
  }
  /* ---------------- 多选删除 ---------------- */
  /**
   * 给 Obsidian 自己的状态栏（反链数 / 字数）让位。
   * 状态栏是盖在工作区底部的浮层，视图底边在它下面，浮条不抬就会和那串字叠住。
   * 量不到（弹窗 / 卸载了状态栏 / 测试桩）就退回默认 10px。
   */
  syncSelbarGap() {
    const root = this.wrapEl;
    let gap = 10;
    let cover = 0;
    try {
      const bar = document.querySelector(".status-bar");
      if (root && bar && typeof root.getBoundingClientRect === "function") {
        const r = root.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        gap = qmSelbarGap(r.bottom, b.top, 10);
        cover = qmStatusCover(r.bottom, b.top);
      }
    } catch (e) {
      gap = 10;
      cover = 0;
    }
    try {
      if (root && root.style && typeof root.style.setProperty === "function") {
        root.style.setProperty("--qm-selbar-gap", gap + "px");
        root.style.setProperty("--qm-status-h", cover + "px");
      }
    } catch (e) {
    }
  }
  /** 底部浮条：跟着多选状态出现/消失，不占常态布局 */
  renderSelectBar() {
    const el = this.selectBarEl;
    if (!el) return;
    el.empty();
    if (!this.state.selectMode) {
      el.removeClass("show");
      if (this.listEl) this.listEl.removeClass("has-selbar");
      this._selInfoEl = null;
      this._selDelEl = null;
      return;
    }
    el.addClass("show");
    if (this.listEl) this.listEl.addClass("has-selbar");
    this.syncSelbarGap();
    const n = this.state.selected.size;
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
      if (!this.state.selected.size) return;
      this.deleteSelected();
    };
    this._selDelEl = del;
  }
  toggleSelectMode(force) {
    const next = typeof force === "boolean" ? force : !this.state.selectMode;
    if (next && this.state.editingKey) {
      new Notice2("\u5148\u4FDD\u5B58\u6216\u53D6\u6D88\u6B63\u5728\u7F16\u8F91\u7684\u5361\u7247");
      return;
    }
    this.state.selectMode = next;
    this.state.selected.clear();
    this.renderList({ keepScroll: true });
  }
  toggleSelected(card) {
    const key = this.cardKey(card);
    const on = !this.state.selected.has(key);
    if (on) this.state.selected.add(key);
    else this.state.selected.delete(key);
    this.paintSelected(key, on);
    this.updateSelectBarCount();
  }
  /**
   * 切换某张卡的选中外观，不重画列表。
   * 找不到这个元素（列表刚好被别的原因重画过）才退回整列重画，且保滚动位置。
   */
  paintSelected(key, on) {
    const box = this._cardEls ? this._cardEls.get(key) : null;
    if (!box) {
      this.renderList({ keepScroll: true });
      return;
    }
    if (on) box.addClass("is-picked");
    else box.removeClass("is-picked");
  }
  /** 只改浮条上的计数文字，不重画浮条：重画会让鼠标下的按钮闪一下 */
  updateSelectBarCount() {
    const n = this.state.selected.size;
    if (this._selInfoEl) this._selInfoEl.setText("\u5DF2\u9009 " + n + " \u6761");
    if (this._selDelEl) {
      this._selDelEl.setText(n ? "\u5220\u9664\u6240\u9009 " + n : "\u5220\u9664\u6240\u9009");
      this._selDelEl.disabled = !n;
    }
  }
  deleteSelected() {
    const picked = this.state.cards.filter((c) => this.state.selected.has(this.cardKey(c)));
    if (!picked.length) {
      new Notice2("\u8FD8\u6CA1\u6709\u9009\u4E2D\u5361\u7247");
      return;
    }
    const detail = this.refDeleteDetail(picked);
    new ConfirmModal(this.app, "\u5220\u9664\u9009\u4E2D\u7684 " + picked.length + " \u6761\u5361\u7247\uFF1F", async () => {
      const res = await this.plugin.deleteCards(picked);
      this.state.selectMode = false;
      this.state.selected.clear();
      this.renderList();
      if (res.deleted && res.failed) {
        new Notice2("\u5DF2\u5220\u9664 " + res.deleted + " \u6761\uFF0C" + res.failed + " \u6761\u6CA1\u627E\u5230\u5DF2\u8DF3\u8FC7", 9e3);
      } else if (res.deleted) {
        new Notice2("\u5DF2\u5220\u9664 " + res.deleted + " \u6761\uFF0C\u53EF\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u6062\u590D", 9e3);
      } else {
        new Notice2("\u6CA1\u6709\u5220\u9664\uFF1A\u5361\u7247\u4F4D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", 9e3);
      }
    }, detail).open();
  }
  /* ---------------- 日期折叠 ---------------- */
  toggleDay(date) {
    if (String(this.state.search || "").trim()) {
      new Notice2("\u641C\u7D22\u65F6\u65E5\u671F\u4F1A\u81EA\u52A8\u5C55\u5F00");
      return;
    }
    if (this.state.collapsed.has(date)) this.state.collapsed.delete(date);
    else this.state.collapsed.add(date);
    this.saveCollapsed();
    this.renderList();
  }
  saveCollapsed() {
    if (!this.state.collapsed) return;
    this.plugin.settings.collapsedDates = Array.from(this.state.collapsed).slice(-60);
    this.plugin.saveData(this.plugin.settings);
  }
  filtered() {
    const conds = qmParseQuery(this.state.search);
    const tags = this.state.tags || [];
    const untagged = !!this.state.untagged;
    const rf = this.effectiveRefFilter();
    return this.state.cards.filter((c) => {
      if (untagged) {
        if (!qmCardIsUntagged(c)) return false;
      } else if (tags.length) {
        let hit = false;
        for (const t of tags) {
          if (qmCardHasPath(c, t)) {
            hit = true;
            break;
          }
        }
        if (!hit) return false;
      }
      if (rf === "has" && this.plugin.refCount(c) === 0) return false;
      if (rf === "none" && this.plugin.refCount(c) > 0) return false;
      return qmCardMatches(c, conds);
    });
  }
  renderList(opts) {
    const el = this.listEl;
    if (!el) return;
    if (this.menuOpen) this.closeMenu();
    const keepScroll = opts && opts.keepScroll ? el.scrollTop || 0 : 0;
    el.empty();
    this._refBadges = /* @__PURE__ */ new Map();
    this._cardEls = /* @__PURE__ */ new Map();
    const matched = this.filtered();
    const cap = this.plugin.settings.maxCards;
    const list = cap > 0 ? matched.slice(0, cap) : matched;
    this.renderSelectBar();
    if (!list.length) {
      const empty = el.createDiv({ cls: "qm-empty" });
      if (this.state.cards.length === 0) {
        empty.createDiv({ text: "\u8FD8\u6CA1\u6709\u5361\u7247\u3002" });
        empty.createDiv({ text: "\u5728\u4E0A\u9762\u5199\u4E00\u53E5\uFF0CCtrl+Enter \u8BB0\u4E0B\u3002" });
      } else {
        empty.createDiv({ text: "\u6CA1\u6709\u5339\u914D\u7684\u5361\u7247\u3002" });
        empty.createDiv({ text: "\u6362\u4E2A\u8BCD\uFF0C\u6216\u8005\u6E05\u9664\u7B5B\u9009\u3002" });
      }
      el.scrollTop = keepScroll;
      return;
    }
    const searching = !!String(this.state.search || "").trim();
    const groups = [];
    for (const card of list) {
      const last = groups[groups.length - 1];
      if (last && last.date === card.date) last.cards.push(card);
      else groups.push({ date: card.date, cards: [card] });
    }
    for (const g of groups) {
      const collapsed = !searching && this.state.collapsed.has(g.date);
      const editingHere = g.cards.some((c) => this.cardKey(c) === this.state.editingKey);
      const day = el.createDiv({
        cls: "qm-day" + (collapsed ? " is-collapsed" : "") + (editingHere ? " is-locked" : "")
      });
      day.createSpan({ cls: "qm-day-arrow", text: collapsed ? "\u25B6" : "\u25BC" });
      day.createSpan({ cls: "qm-day-text", text: g.date });
      day.createSpan({ cls: "qm-day-count", text: String(g.cards.length) });
      day.onclick = () => {
        if (editingHere) {
          new Notice2("\u8FD9\u4E00\u5929\u6709\u5361\u7247\u6B63\u5728\u7F16\u8F91\uFF0C\u5148\u4FDD\u5B58\u6216\u53D6\u6D88");
          return;
        }
        this.toggleDay(g.date);
      };
      if (collapsed) continue;
      for (const card of g.cards) this.renderCard(el, card);
    }
    el.scrollTop = keepScroll;
  }
  /**
   * 时间后面的小圆点：只表示「这张卡被笔记引用过」，不显示次数、不响应点击。
   * 次数与来源都在「···」菜单里看。0 次时元素存在但不显示，方便就地更新。
   */
  mountRefDot(parent, card, key) {
    const el = parent.createSpan({ cls: "qm-ref" });
    if (this._refBadges) this._refBadges.set(key, { el, card });
    this.paintRefDot(el, card);
    return el;
  }
  paintRefDot(el, card) {
    if (!el) return;
    const info = this.plugin.refSummary(card);
    const n = info ? info.notes : 0;
    if (!n) {
      el.addClass("is-hidden");
      el.setAttr("title", "");
      return;
    }
    el.removeClass("is-hidden");
    const lines = ["\u88AB " + n + " \u7BC7\u7B14\u8BB0\u5F15\u7528" + (info.places > n ? " \xB7 \u5171 " + info.places + " \u5904" : "")];
    for (const nm of info.names.slice(0, 8)) lines.push("\xB7 " + nm);
    if (info.names.length > 8) lines.push("\xB7 \u2026\u8FD8\u6709 " + (info.names.length - 8) + " \u7BC7");
    if (info.ambiguous) lines.push("\uFF08\u6709\u540C\u540D\u6587\u4EF6\uFF0C\u94FE\u63A5\u53EF\u80FD\u6307\u9519\uFF0C\u6CE8\u610F\uFF09");
    el.setAttr("title", lines.join("\n"));
  }
  /**
   * 引用数字变了。默认只改文字，不重画整列（否则你正在写文章时侧栏会一直跳）。
   * 只有「只看已引用 / 只看未引用」开着时结果集会变，才重画一次并保留滚动位置。
   */
  updateRefs() {
    if (!this.state) return;
    if (this.effectiveRefFilter()) {
      this.renderList({ keepScroll: true });
      return;
    }
    if (!this._refBadges || !this._refBadges.size) return;
    for (const { el, card } of this._refBadges.values()) this.paintRefDot(el, card);
  }
  cardKey(card) {
    if (card.id) return (card.filePath || "") + "|" + card.id;
    return (card.filePath || "") + "|" + card.date + "|" + card.time + "|" + (typeof card.dupIndex === "number" ? card.dupIndex : 0) + "|" + card.body;
  }
  /** 删除前的提醒：这些卡片还被哪些笔记引用着（没被引用就返回空串） */
  refDeleteDetail(cards) {
    const list = Array.isArray(cards) ? cards : [cards];
    const hits = list.filter((c) => this.plugin.refCount(c) > 0);
    if (!hits.length) return "";
    const names = [];
    for (const c of hits) {
      const info = this.plugin.refSummary(c);
      if (!info) continue;
      for (const n of info.names) {
        if (names.indexOf(n) === -1) names.push(n);
      }
    }
    if (!names.length) return "";
    const shown = names.slice(0, 3).join("\u3001") + (names.length > 3 ? " \u7B49" : "");
    const head = list.length === 1 ? "\u8FD9\u5F20\u5361\u7247\u88AB " + this.plugin.refCount(hits[0]) + " \u7BC7\u7B14\u8BB0\u5F15\u7528\u7740" : "\u5176\u4E2D " + hits.length + " \u6761\u88AB\u7B14\u8BB0\u5F15\u7528\uFF0C\u6D89\u53CA " + names.length + " \u7BC7\u7B14\u8BB0";
    return head + "\uFF1A" + shown + "\u3002\u5220\u9664\u540E\u8FD9\u4E9B\u5730\u65B9\u7684\u94FE\u63A5\u4F1A\u5931\u6548\uFF08\u663E\u793A\u4E3A\u300C\u627E\u4E0D\u5230\u8BE5\u5757\u300D\uFF09\u3002";
  }
  /** 把一段文字塞进卡片正文，命中的搜索词用 <mark> 标出来（跟原型一致） */
  appendHighlighted(parent, text, kw) {
    const src = String(text == null ? "" : text);
    const q = String(kw == null ? "" : kw).trim();
    if (!q || !src) {
      parent.appendChild(document.createTextNode(src));
      return;
    }
    const hay = src.toLowerCase();
    const needle = q.toLowerCase();
    let i = 0;
    for (; ; ) {
      const at = hay.indexOf(needle, i);
      if (at < 0) {
        if (i < src.length) parent.appendChild(document.createTextNode(src.slice(i)));
        return;
      }
      if (at > i) parent.appendChild(document.createTextNode(src.slice(i, at)));
      parent.createEl("mark", { text: src.slice(at, at + q.length) });
      i = at + q.length;
    }
  }
  renderCard(parent, card) {
    const key = this.cardKey(card);
    const picked = this.state.selectMode && this.state.selected.has(key);
    const box = parent.createDiv({ cls: "qm-card" + (picked ? " is-picked" : "") });
    if (this._cardEls) this._cardEls.set(key, box);
    if (this.state.selectMode) {
      box.addClass("is-selectable");
      box.onclick = (e) => {
        e.stopPropagation();
        this.toggleSelected(card);
      };
    }
    const head = box.createDiv({ cls: "qm-card-head" });
    if (this.state.selectMode) {
      head.createSpan({ cls: "qm-tick", text: "\u2713" });
    }
    head.createSpan({ cls: "qm-time", text: card.time });
    this.mountRefDot(head, card, key);
    const sections = qmCardSections(card.body);
    this.mountAppendBadge(head, card, sections);
    if (this.state.editingKey === key) {
      this.renderEditor(box, card, key);
      return;
    }
    const body = box.createDiv({ cls: "qm-body" });
    const kw = String(this.state.search || "").trim();
    for (const seg of qmBodySegments(sections.original)) {
      if (seg.kind === "text") {
        this.appendHighlighted(body, seg.text, kw);
        continue;
      }
      if (seg.kind === "tag") {
        const tag = body.createSpan({ cls: "qm-tag", text: seg.text });
        tag.onclick = (e) => {
          e.stopPropagation();
          if (this.state.selectMode) {
            this.toggleSelected(card);
            return;
          }
          this.setFilterTags([seg.value]);
        };
        continue;
      }
      const link = body.createEl("a", { cls: "qm-url", text: seg.text });
      link.setAttr("href", seg.text);
      link.setAttr("rel", "noopener");
      link.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.state.selectMode) {
          this.toggleSelected(card);
          return;
        }
        try {
          window.open(seg.text, "_blank");
        } catch (err) {
          new Notice2("\u6253\u4E0D\u5F00\u8FD9\u4E2A\u94FE\u63A5");
        }
      };
    }
    this.renderAppendArea(box, card, sections);
    if (this.state.selectMode) return;
    this.mountCardMenuButton(head, card);
    this.bindCardEdit(box, card);
    this.bindCardDrag(box, card);
  }
  /* ---------------- 卡片上的交互 ---------------- */
  mountCardMenuButton(head, card) {
    const more = head.createEl("button", { cls: "qm-more" });
    more.setAttr("type", "button");
    more.setAttr("aria-label", "\u66F4\u591A\u64CD\u4F5C");
    more.setAttr("title", "\u66F4\u591A\u64CD\u4F5C");
    qmIcon(more, "more");
    more.addEventListener("mousedown", (e) => e.stopPropagation());
    more.onclick = (e) => {
      e.stopPropagation();
      this.openCardMenu(card, e);
    };
    return more;
  }
  openCardMenu(card, evt) {
    const anchor = evt && evt.currentTarget || null;
    const info = this.plugin.refSummary(card);
    const n = info ? info.notes : 0;
    const items = [
      {
        title: "\u590D\u5236\u5168\u6587",
        icon: "copy",
        onClick: async () => {
          await this.plugin.copy(qmPasteText(card.body));
          new Notice2("\u5DF2\u590D\u5236\u5361\u7247\u5168\u6587");
        }
      },
      { title: "\u590D\u5236\u94FE\u63A5", icon: "link", onClick: () => this.copyRef(card) },
      { title: "\u7F16\u8F91", icon: "pencil", onClick: () => this.requestEdit(card) },
      { title: "\u8FFD\u52A0", icon: "plus", onClick: () => this.beginAppend(card) },
      { separator: true }
    ];
    if (!this.plugin.refsReady()) {
      items.push({ title: "\u5F15\u7528\u7EDF\u8BA1\u51C6\u5907\u4E2D\u2026", icon: "corner-down-right", disabled: true });
    } else if (n) {
      items.push({
        title: "\u88AB " + n + " \u7BC7\u7B14\u8BB0\u5F15\u7528\u2026",
        icon: "corner-down-right",
        onClick: () => new RefListModal(this.app, info, (r) => this.openRef(r.path, r.line)).open()
      });
    } else {
      items.push({ title: "\u8FD8\u6CA1\u6709\u7B14\u8BB0\u5F15\u7528\u8FD9\u5F20\u5361\u7247", icon: "corner-down-right", disabled: true });
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
  /**
   * 跳到引用这张卡片的那篇笔记。
   * 行号来自 Obsidian 自己的链接缓存；取不到就只打开文件，不猜位置。
   * 用新标签页打开：你正在看的东西不该被顶掉。
   */
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
  /** 复制块链接：与 1.6 以来一致，跟随「嵌入」开关 */
  async copyRef(card) {
    const hadId = !!card.id && card.idOnLastLine;
    const id = await this.plugin.ensureId(card);
    if (!id) {
      new Notice2("\u6CA1\u627E\u5230\u8FD9\u5F20\u5361\u7247\uFF0C\u8BF7\u6539\u7528\u300C\u590D\u5236\u5168\u6587\u300D");
      return;
    }
    const bang = this.plugin.settings.blockRefEmbed ? "!" : "";
    const ref = bang + "[[" + this.plugin.linkTarget(card) + "#^" + id + "]]";
    await this.plugin.copy(ref);
    new Notice2((hadId ? "\u5DF2\u590D\u5236\uFF1A" : "\u5DF2\u4E3A\u8FD9\u6761\u5361\u7247\u8865\u4E0A\u5757 ID\uFF0C\u5DF2\u590D\u5236\uFF1A") + ref, 7e3);
  }
  confirmDelete(card) {
    new ConfirmModal(
      this.app,
      "\u5220\u9664\u8FD9\u6761\u5361\u7247\uFF1F",
      async () => {
        await this.plugin.deleteCard(card);
      },
      this.refDeleteDetail(card)
    ).open();
  }
  /**
   * 在月份文件里打开这张卡所在的那一行。
   * 写入前先按块 ID 重新定位，定位不到就不跳（宁可不跳，也别跳到错的地方）。
   */
  async locateCard(card) {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) {
      new Notice2("\u8FD9\u5F20\u5361\u7247\u6240\u5728\u7684\u6587\u4EF6\u627E\u4E0D\u5230\u4E86");
      return;
    }
    let hit = null;
    try {
      const text = String(await this.app.vault.read(file) || "").replace(/\r\n?/g, "\n");
      hit = qmLocateCard(text, card, { strict: this.plugin.settings.strictCardId !== false });
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
    }
  }
  /**
   * 进入编辑态的唯一入口（双击与菜单都走这里）。
   * 同时只允许一处编辑：另一条有未保存的改动时，让用户自己选怎么处理。
   */
  requestEdit(card) {
    const key = this.cardKey(card);
    const cur = this.state.editingKey;
    if (cur === key) return;
    if (!cur) {
      this.beginEdit(key);
      return;
    }
    const prev = this.state.cards.find((c) => this.cardKey(c) === cur);
    const draft = this.state.editingDraft;
    const dirty = !!prev && !!draft && draft.key === cur && String(draft.text) !== String(qmCardSections(prev.body).original);
    if (!dirty) {
      this.beginEdit(key);
      return;
    }
    new DraftSwitchModal(this.app, {
      preview: prev.time + " " + qmFirstLine(prev.body),
      onDiscard: () => this.beginEdit(key),
      onSave: async () => {
        if (!String(draft.text || "").trim()) {
          new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
          return false;
        }
        this.state.editingKey = null;
        this.state.editingDraft = null;
        const saved = await this.plugin.updateCard(prev, draft.text);
        if (!saved) {
          this.state.editingKey = cur;
          this.state.editingDraft = draft;
          this.renderList();
          return false;
        }
        this.beginEdit(key);
        return true;
      }
    }).open();
  }
  beginEdit(key) {
    this.state.editingKey = key;
    this.state.editingDraft = null;
    this.refreshLists();
  }
  /** 列表与回看共用一次刷新：回看打开时两个都要重画 */
  refreshLists(opts) {
    this.renderList(opts);
    if (this.state.reviewOpen) this.renderReview();
  }
  /** 编辑原始内容区的输入框：列表和回看共用一套 */
  renderEditor(box, card, key) {
    const ta = box.createEl("textarea", { cls: "qm-edit" });
    const draft = this.state.editingDraft;
    ta.value = draft && draft.key === key ? draft.text : qmCardSections(card.body).original;
    ta.rows = Math.min(12, Math.max(2, String(ta.value).split("\n").length + 1));
    ta.addEventListener("input", () => {
      this.state.editingDraft = { key, text: String(ta.value) };
    });
    window.setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 20);
    const cancel = () => {
      this.state.editingKey = null;
      this.state.editingDraft = null;
      this.refreshLists({ keepScroll: true });
    };
    const bar = box.createDiv({ cls: "qm-edit-bar" });
    const cancelBtn = bar.createEl("button", { text: "\u53D6\u6D88", cls: "qm-mini-btn" });
    cancelBtn.onclick = cancel;
    const ok = bar.createEl("button", { text: "\u4FDD\u5B58", cls: "qm-mini-btn is-primary" });
    ok.onclick = async () => {
      const v = String(ta.value || "").trim();
      if (!v) {
        new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
        return;
      }
      const saved = await this.plugin.updateCard(card, v);
      if (!saved) return;
      this.state.editingKey = null;
      this.state.editingDraft = null;
      this.refreshLists({ keepScroll: true });
    };
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        ok.onclick();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
  }
  /* ---------------- 追加区（列表 / 回看共用） ---------------- */
  /** 时间后面的「追加 N」徽标：只有存在追加时才出现，点一下展开 / 收起 */
  mountAppendBadge(head, card, sections) {
    if (!sections.appends.length) return null;
    const key = this.cardKey(card);
    const badge = head.createSpan({ cls: "qm-append-badge", text: "\u8FFD\u52A0 " + sections.appends.length });
    badge.onclick = (e) => {
      e.stopPropagation();
      if (this.state.appendOpen.has(key)) this.state.appendOpen.delete(key);
      else this.state.appendOpen.add(key);
      this.refreshLists({ keepScroll: true });
    };
    return badge;
  }
  renderAppendArea(box, card, sections) {
    const key = this.cardKey(card);
    if (sections.appends.length && this.state.appendOpen.has(key)) {
      const list = box.createDiv({ cls: "qm-append-list" });
      sections.appends.forEach((item, index) => {
        this.renderAppendItem(list, card, item, index, key);
      });
    }
    const draft = this.state.appendDraft;
    if (draft && draft.key === key) this.renderAppendComposer(box, card, key);
  }
  renderAppendItem(list, card, item, index, key) {
    const row = list.createDiv({ cls: "qm-append-item" });
    const bar = row.createDiv({ cls: "qm-append-head" });
    bar.createSpan({ cls: "qm-append-time", text: item.label });
    const editing = this.state.appendEdit && this.state.appendEdit.key === key && this.state.appendEdit.index === index;
    if (editing) {
      const ta = row.createEl("textarea", { cls: "qm-edit qm-append-edit" });
      ta.value = this.state.appendEdit.text;
      window.setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }, 20);
      ta.addEventListener("input", () => {
        if (this.state.appendEdit && this.state.appendEdit.key === key) {
          this.state.appendEdit.text = String(ta.value);
        }
      });
      const editBar = row.createDiv({ cls: "qm-edit-bar" });
      const cancel = editBar.createEl("button", { text: "\u53D6\u6D88", cls: "qm-mini-btn" });
      cancel.onclick = (e) => {
        e.stopPropagation();
        this.state.appendEdit = null;
        this.refreshLists({ keepScroll: true });
      };
      const save = editBar.createEl("button", { text: "\u4FDD\u5B58", cls: "qm-mini-btn is-primary" });
      save.onclick = async (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const text = this.state.appendEdit && this.state.appendEdit.key === key ? this.state.appendEdit.text : String(ta.value);
        const ok = await this.plugin.updateAppend(card, index, text);
        if (!ok) return;
        this.state.appendEdit = null;
        this.refreshLists({ keepScroll: true });
      };
      return;
    }
    const acts = bar.createDiv({ cls: "qm-append-acts" });
    const edit = acts.createEl("button", { text: "\u7F16\u8F91", cls: "qm-mini-btn" });
    edit.onclick = (e) => {
      e.stopPropagation();
      this.state.appendEdit = { key, index, text: String(item.text || "") };
      this.state.appendOpen.add(key);
      this.refreshLists({ keepScroll: true });
    };
    const del = acts.createEl("button", { text: "\u5220\u9664", cls: "qm-mini-btn qm-mini-btn-danger" });
    del.onclick = (e) => {
      e.stopPropagation();
      new ConfirmModal(this.app, "\u5220\u9664\u8FD9\u6761\u8FFD\u52A0\uFF1F", async () => {
        const ok = await this.plugin.deleteAppend(card, index);
        if (!ok) return;
        this.state.appendEdit = null;
        this.refreshLists({ keepScroll: true });
      }).open();
    };
    const textEl = row.createDiv({ cls: "qm-append-text" });
    this.renderRichText(textEl, item.text, card);
  }
  /** 追加文本里的标签 / 网址：与正文同一套点击语义 */
  renderRichText(el, text, card) {
    for (const seg of qmBodySegments(text)) {
      if (seg.kind === "text") {
        el.appendChild(document.createTextNode(seg.text));
        continue;
      }
      if (seg.kind === "tag") {
        const tag = el.createSpan({ cls: "qm-tag", text: seg.text });
        tag.onclick = (e) => {
          e.stopPropagation();
          if (this.state.selectMode) {
            this.toggleSelected(card);
            return;
          }
          this.setFilterTags([seg.value]);
        };
        continue;
      }
      const link = el.createEl("a", { cls: "qm-url", text: seg.text });
      link.setAttr("href", seg.text);
      link.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          window.open(seg.text, "_blank");
        } catch (err) {
          new Notice2("\u6253\u4E0D\u5F00\u8FD9\u4E2A\u94FE\u63A5");
        }
      };
    }
  }
  renderAppendComposer(box, card, key) {
    const wrap = box.createDiv({ cls: "qm-append-composer" });
    const ta = wrap.createEl("textarea", { cls: "qm-input qm-append-input" });
    ta.rows = 2;
    ta.setAttr("placeholder", "\u8FFD\u52A0\u4E00\u6BB5\u2026");
    ta.value = this.state.appendDraft && this.state.appendDraft.key === key ? this.state.appendDraft.text : "";
    ta.addEventListener("input", () => {
      if (this.state.appendDraft && this.state.appendDraft.key === key) {
        this.state.appendDraft.text = String(ta.value);
      }
    });
    window.setTimeout(() => ta.focus(), 20);
    const bar = wrap.createDiv({ cls: "qm-append-bar" });
    bar.createDiv({ cls: "qm-kbd-hint", text: "Ctrl+Enter \u8FFD\u52A0" });
    const cancel = () => {
      this.state.appendDraft = null;
      this.refreshLists({ keepScroll: true });
    };
    const cancelBtn = bar.createEl("button", { text: "\u53D6\u6D88", cls: "qm-mini-btn" });
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      cancel();
    };
    const save = bar.createEl("button", { text: "\u8FFD\u52A0", cls: "qm-mini-btn is-primary" });
    save.onclick = async (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      const text = this.state.appendDraft && this.state.appendDraft.key === key ? this.state.appendDraft.text : String(ta.value);
      const ok = await this.plugin.appendToCard(card, text);
      if (!ok) return;
      this.state.appendDraft = null;
      this.state.appendOpen.add(key);
      this.refreshLists({ keepScroll: true });
    };
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        save.onclick();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
  }
  /** 从「···」进追加：展开这张卡并就地放一个输入框 */
  beginAppend(card) {
    const key = this.cardKey(card);
    this.state.appendDraft = { key, text: "" };
    this.state.appendOpen.add(key);
    this.refreshLists({ keepScroll: true });
  }
  bindCardEdit(box, card) {
    box.addEventListener("dblclick", (e) => {
      if (this.state.selectMode) return;
      const t = e.target;
      if (t && typeof t.closest === "function" && t.closest("a, .qm-tag, .qm-more, .qm-ref, .qm-append-badge, button, textarea")) {
        return;
      }
      if (e.preventDefault) e.preventDefault();
      this.requestEdit(card);
    });
  }
  /**
   * 整张卡可拖：拖出去的是「指向这张卡的引用」，与复制链接同一份文本。
   * 只有一处例外——从卡片里的裸网址起手的拖拽交给浏览器，那不是拖卡片。
   */
  bindCardDrag(box, card) {
    box.setAttr("draggable", "true");
    box.addEventListener("mousedown", () => {
      const now = Date.now();
      this._dblRisk = now - (this._lastDown || 0) < 420;
      this._lastDown = now;
    });
    box.addEventListener("dragstart", (e) => {
      if (this._dblRisk || this.state.selectMode || this.state.editingKey) {
        if (e.preventDefault) e.preventDefault();
        return;
      }
      const t = e.target;
      if (t && typeof t.closest === "function" && t.closest("a")) return;
      if (e.stopPropagation) e.stopPropagation();
      const text = this.dragPayload(card);
      if (e.dataTransfer) {
        try {
          e.dataTransfer.setData("text/plain", text);
          e.dataTransfer.effectAllowed = "copy";
        } catch (err) {
        }
      }
      box.addClass("is-dragging");
    });
    box.addEventListener("dragend", () => box.removeClass("is-dragging"));
  }
  /**
   * 拖出去的内容。有块 ID 就是引用（跟随「嵌入」开关，与复制链接完全一致）；
   * 1.5 时代的老卡片没有块 ID，只能退化成正文全文，并提示一次。
   */
  dragPayload(card) {
    if (card.id) {
      const bang = this.plugin.settings.blockRefEmbed ? "!" : "";
      return bang + "[[" + this.plugin.linkTarget(card) + "#^" + card.id + "]]";
    }
    if (!this._noIdHint) {
      this._noIdHint = true;
      new Notice2("\u8FD9\u6761\u5361\u7247\u8FD8\u6CA1\u6709\u5757 ID\uFF0C\u8FD9\u6B21\u62D6\u51FA\u53BB\u7684\u662F\u6B63\u6587\u5168\u6587");
    }
    return qmPasteText(card.body);
  }
};
var QuickMemoSettingTab = class extends PluginSettingTab2 {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Noval \u8BBE\u7F6E" });
    new Setting2(containerEl).setName("\u5361\u7247\u6587\u4EF6\u5939").setDesc(
      "\u5361\u7247\u6309\u6708\u5B58\u6210 YYYY-MM.md\u3002\u6587\u4EF6\u5939\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\uFF1B\u5207\u6362\u65F6\u4F1A\u5148\u68C0\u67E5\u76EE\u6807\u6587\u4EF6\u5939\u91CC\u5DF2\u6709\u7684\u5E74\u6708\u6587\u4EF6\uFF0C\u53D1\u73B0\u4E0D\u50CF\u5361\u7247\u6587\u4EF6\uFF08\u6BD4\u5982\u65E5\u8BB0\u3001\u526A\u85CF\uFF09\u5C31\u62D2\u7EDD\u5207\u6362\uFF0C\u907F\u514D\u8BEF\u6539\u522B\u7684\u7B14\u8BB0\u3002"
    ).addText((t) => {
      t.setValue(this.plugin.settings.folderPath);
      const apply = async () => {
        const val = String(t.getValue() || "").trim().replace(/^\/+|\/+$/g, "");
        if (!val || val === this.plugin.settings.folderPath) {
          t.setValue(this.plugin.settings.folderPath);
          return;
        }
        const check = await this.plugin.validateFolderTarget(val);
        if (!check.ok) {
          new Notice2("\u672A\u5207\u6362\uFF1A" + check.reason, 8e3);
          t.setValue(this.plugin.settings.folderPath);
          return;
        }
        this.plugin.settings.folderPath = val;
        await this.plugin.saveSettings();
        new Notice2("\u5361\u7247\u6587\u4EF6\u5939\u5DF2\u5207\u6362\u5230 " + val);
      };
      t.inputEl.addEventListener("blur", () => {
        apply();
      });
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
          t.inputEl.blur();
        }
      });
    });
    new Setting2(containerEl).setName("\u5E38\u7528\u6807\u7B7E").setDesc("\u7528\u9017\u53F7\u5206\u9694\uFF0C\u4EC5\u7528\u4E8E\u628A\u5E38\u7528\u6807\u7B7E\u6392\u5728\u5019\u9009\u524D\u9762\uFF1B\u5361\u7247\u91CC\u4E0D\u5B58\u5728\u7684\u6807\u7B7E\u4E0D\u4F1A\u51FA\u73B0\u3002").addText(
      (t) => t.setValue(this.plugin.settings.quickTags.join(",")).onChange(async (v) => {
        this.plugin.settings.quickTags = String(v || "").split(/[,，\s]+/).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
        await this.plugin.saveSettings();
      })
    );
    new Setting2(containerEl).setName("\u6700\u591A\u6E32\u67D3\u6761\u6570").setDesc("\u4E3A\u4FDD\u8BC1\u6D41\u7545\uFF0C\u5217\u8868\u6700\u591A\u6E32\u67D3\u591A\u5C11\u6761\uFF080 \u8868\u793A\u4E0D\u9650\u5236\uFF09\u3002\u641C\u7D22\u548C\u6807\u7B7E\u7B5B\u9009\u59CB\u7EC8\u8986\u76D6\u5168\u90E8\u5361\u7247\uFF0C\u4E0D\u53D7\u6B64\u9879\u5F71\u54CD\u3002").addText(
      (t) => t.setValue(String(this.plugin.settings.maxCards)).onChange(async (v) => {
        const n = parseInt(v, 10);
        this.plugin.settings.maxCards = isNaN(n) ? 500 : Math.max(0, n);
        await this.plugin.saveSettings();
      })
    );
    new Setting2(containerEl).setName("\u81EA\u52A8\u6E05\u7406\u7A7A\u65E5\u671F\u6807\u9898").setDesc(
      "\u67D0\u4E00\u5929\u7684\u5361\u7247\u5168\u90E8\u5220\u6389\u540E\uFF0C\u628A\u8FD9\u4E2A\u53EA\u5269\u7A7A\u767D\u7684 ## \u65E5\u671F \u6807\u9898\u4E5F\u4E00\u5E76\u53BB\u6389\u3002\u5728\u7F16\u8F91\u5668\u91CC\u624B\u52A8\u5220\u5361\u7247\u540C\u6837\u4F1A\u6E05\u7406\uFF1B\u5149\u6807\u505C\u5728\u54EA\u4E2A\u65E5\u671F\u6BB5\u91CC\uFF0C\u54EA\u4E00\u6BB5\u5C31\u6682\u65F6\u4E0D\u52A8\u3002"
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.autoPruneEmptyDates !== false).onChange(async (v) => {
        this.plugin.settings.autoPruneEmptyDates = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting2(containerEl).setName("\u4E25\u683C\u8BC6\u522B\u5361\u7247\uFF08\u63A8\u8350\u5F00\u542F\uFF09").setDesc(
      "\u53EA\u628A\u5E26\u5757 ID\uFF08\u5F62\u5982 ^abc123\uFF09\u7684\u65F6\u95F4\u6761\u76EE\u5F53\u6210\u5361\u7247\u3002\u63D2\u4EF6\u8BB0\u5F55\u7684\u5361\u7247\u4E00\u5B9A\u5E26\u5757 ID\uFF1B\u4F60\u5728\u901F\u8BB0\u6587\u4EF6\u6B63\u6587\u91CC\u624B\u5199\u7684\u300C- 12:30 \u5F00\u4F1A\u300D\u53EA\u662F\u666E\u901A\u6587\u5B57\uFF0C\u4E0D\u4F1A\u51FA\u73B0\u5728\u9762\u677F\u91CC\uFF0C\u4E5F\u4E0D\u4F1A\u88AB\u8BEF\u5220\u3002\u5173\u6389\u540E\uFF0C\u4EFB\u4F55\u300C- \u65F6\u95F4 \u5185\u5BB9\u300D\u7684\u884C\u90FD\u4F1A\u88AB\u5F53\u6210\u5361\u7247\u3002"
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.strictCardId !== false).onChange(async (v) => {
        this.plugin.settings.strictCardId = v;
        await this.plugin.saveSettings();
        if (v) this.plugin.checkUnmanagedEntries();
      })
    );
    new Setting2(containerEl).setName("\u5757\u5F15\u7528\u4F7F\u7528\u5D4C\u5165\u5F62\u5F0F").setDesc(
      "\u5173\u95ED\u65F6\u300C\u590D\u5236\u94FE\u63A5\u300D\u7ED9\u51FA [[\u6587\u4EF6#^id]]\uFF0C\u70B9\u4E00\u4E0B\u8DF3\u5230\u90A3\u6761\u5361\u7247\uFF1B\u6253\u5F00\u540E\u7ED9\u51FA ![[\u6587\u4EF6#^id]]\uFF0C\u7C98\u8D34\u7684\u4F4D\u7F6E\u4F1A\u76F4\u63A5\u5C55\u5F00\u5361\u7247\u5185\u5BB9\u3002"
    ).addToggle(
      (tg) => tg.setValue(!!this.plugin.settings.blockRefEmbed).onChange(async (v) => {
        this.plugin.settings.blockRefEmbed = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
var QuickMemoPlugin = class extends Plugin2 {
  /* ---------------- 引用统计（只读 Obsidian 内存索引，不写任何文件） ---------------- */
  refsReady() {
    return !!this._refReady;
  }
  /**
   * 重建「哪张卡被哪些笔记引用」的索引。
   * 数据全部来自 Obsidian 自己的链接索引（metadataCache），不打开文件、不写入。
   * 口径：按「篇」统计（同一篇笔记引多次只算 1 篇），同时记下总处数。
   */
  buildRefIndex() {
    const items = [];
    if (!this.app || !this.app.metadataCache) return /* @__PURE__ */ new Map();
    let files = [];
    try {
      files = this.app.vault.getMarkdownFiles() || [];
    } catch (e) {
      return /* @__PURE__ */ new Map();
    }
    const nameCount = /* @__PURE__ */ new Map();
    for (const f of files) {
      const b = qmBaseName(f.path);
      nameCount.set(b, (nameCount.get(b) || 0) + 1);
    }
    for (const f of files) {
      if (this.isCardFilePath(f.path)) continue;
      let cache = null;
      try {
        cache = this.app.metadataCache.getFileCache(f);
      } catch (e) {
        cache = null;
      }
      if (!cache) continue;
      const lists = [cache.links, cache.embeds, cache.frontmatterLinks];
      for (const arr of lists) {
        if (!arr || !arr.length) continue;
        for (const l of arr) {
          const ref = qmParseBlockRef(l && (l.link || l.original) || "");
          if (!ref || !ref.target) continue;
          let dest = null;
          try {
            dest = this.app.metadataCache.getFirstLinkpathDest(ref.target, f.path);
          } catch (e) {
            dest = null;
          }
          if (!dest || !dest.path) continue;
          if (!this.isCardFilePath(dest.path)) continue;
          const base = qmBaseName(dest.path);
          items.push({
            sourcePath: f.path,
            destPath: dest.path,
            id: ref.id,
            ambiguous: (nameCount.get(base) || 0) > 1,
            line: qmLinkLine(l)
          });
        }
      }
    }
    return qmAggregateRefs(items);
  }
  /** 立刻重算（同步、只读内存，几毫秒） */
  refreshRefs() {
    let idx;
    try {
      idx = this.buildRefIndex();
    } catch (e) {
      idx = this._refIndex || /* @__PURE__ */ new Map();
    }
    this._refIndex = idx;
    this._refReady = true;
    return idx;
  }
  /** 别处改了文件后合并重算，避免连续敲字触发多次 */
  queueRefs(delay) {
    if (this._refTimer) clearTimeout(this._refTimer);
    this._refTimer = setTimeout(() => {
      this._refTimer = null;
      this.refreshRefs();
      this.notifyRefs();
    }, typeof delay === "number" ? delay : 800);
  }
  refEntry(card) {
    if (!card || !card.id) return null;
    if (!this._refIndex) return null;
    return this._refIndex.get(card.filePath + "#^" + String(card.id).toLowerCase()) || null;
  }
  /** 被几篇笔记引用 */
  refCount(card) {
    const e = this.refEntry(card);
    return e ? e.notes.size : 0;
  }
  /**
   * 被引用的总数 + 每一篇的来源（名字、引用行号）。
   * 名字要能点、能跳，所以这里把路径和行号一起交出去；
   * 不同文件夹里有同名笔记时补一段父目录，否则菜单上分不清。
   */
  refSummary(card) {
    const e = this.refEntry(card);
    if (!e) return null;
    const rows = [];
    const seen = /* @__PURE__ */ new Map();
    for (const p of e.notes) {
      const name = String(p).split("/").pop().replace(/\.md$/i, "");
      seen.set(name, (seen.get(name) || 0) + 1);
      const lines = e.by && e.by.get(p) || [];
      const line = lines.length ? lines.reduce((a, b) => b < a ? b : a, lines[0]) : -1;
      rows.push({ path: String(p), name, line, places: lines.length });
    }
    for (const r of rows) {
      if ((seen.get(r.name) || 0) > 1) {
        const parts = r.path.split("/");
        if (parts.length > 1) r.name = r.name + " \xB7 " + parts[parts.length - 2];
      }
    }
    rows.sort((a, b) => (a.line < 0 ? 1 : 0) - (b.line < 0 ? 1 : 0) || a.line - b.line || a.name.localeCompare(b.name));
    return {
      notes: e.notes.size,
      places: e.places,
      names: rows.map((r) => r.name),
      list: rows,
      ambiguous: e.ambiguous
    };
  }
  /** 通知已打开的面板：只刷新引用数字，不重读文件 */
  notifyRefs() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QM)) {
      const v = leaf.view;
      if (v && typeof v.updateRefs === "function") v.updateRefs();
    }
  }
  /** 换了目标笔记：回看开着就让视图重算「已插入」（按钮状态跟着笔记走） */
  refreshInsertedForReview() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QM)) {
      const v = leaf.view;
      if (v && v.state && v.state.reviewOpen && typeof v.rescanInserted === "function") {
        v.rescanInserted();
      }
    }
  }
  async onload() {
    await this.loadSettings();
    if (this.settings.draft && this.settings.draft.text && !this.draftAlive()) {
      this.settings.draft = { text: "", at: 0 };
      try {
        await this.saveData(this.settings);
      } catch (e) {
      }
    }
    this.registerView(VIEW_TYPE_QM, (leaf) => new CardsView(leaf, this));
    addIcon2(ICON_ID, ICON_MARK);
    this.addRibbonIcon(ICON_ID, "Noval", async () => {
      await this.activateView();
    });
    this.addCommand({
      id: "open-cards",
      name: "\u6253\u5F00\u5361\u7247\u89C6\u56FE",
      callback: async () => this.activateView()
    });
    this.addCommand({
      id: "capture-selection",
      name: "\u628A\u9009\u4E2D\u7684\u5185\u5BB9\u5B58\u4E3A\u5361\u7247",
      // 用 callback 而不是 editorCallback：手机上从工具栏调命令时
      // 编辑器会短暂失焦，editorCallback 那种「只在编辑器里可用」会点不动
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "C" }],
      callback: () => this.captureSelection(this.currentEditor())
    });
    this.addCommand({
      id: "quick-capture",
      name: "\u5FEB\u901F\u8BB0\u4E00\u6761",
      // 'Mod' 由 Obsidian 按平台解析：macOS 是 Cmd，Windows/Linux 是 Ctrl。
      // 用 J 而不是 K：Mod+K 是核心命令「插入 Markdown 链接」的默认键，
      // 在编辑器里会同时插入 []() 并弹出速记窗，属于硬冲突。
      hotkeys: [{ modifiers: ["Mod"], key: "J" }],
      callback: () => new CaptureModal(this.app, this).open()
    });
    this.addCommand({
      id: "insert-card",
      name: "\u63D2\u5165\u5361\u7247\uFF08\u5F15\u7528\u6216\u5168\u6587\uFF09",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "K" }],
      callback: () => this.openCardPicker()
    });
    this.addSettingTab(new QuickMemoSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        let sel = "";
        try {
          sel = editor.getSelection();
        } catch (e) {
          sel = "";
        }
        if (!String(sel || "").trim()) return;
        menu.addItem(
          (i) => i.setTitle("\u5B58\u4E3A\u5361\u7247").setIcon(ICON_ID).onClick(() => this.captureSelection(editor))
        );
      })
    );
    this._lastMdLeaf = null;
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => this.rememberEditorLeaf(leaf))
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        let leaf = null;
        try {
          const ws = this.app.workspace;
          leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf(ws.rootSplit) : null;
        } catch (e) {
          leaf = null;
        }
        this.rememberEditorLeaf(leaf);
        this.refreshInsertedForReview();
      })
    );
    this._lastSelection = "";
    this._lastSelectionAt = 0;
    this.registerDomEvent(document, "selectionchange", () => {
      try {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const t = String(sel).trim();
        if (!t) return;
        this._lastSelection = t;
        this._lastSelectionAt = Date.now();
      } catch (e) {
      }
    });
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        this.pruneSoon(f);
        this.invalidateCards();
      })
    );
    if (this.app.metadataCache) {
      this.registerEvent(
        this.app.metadataCache.on("resolved", () => {
          this.refreshRefs();
          this.notifyRefs();
        })
      );
      this.registerEvent(this.app.metadataCache.on("changed", () => this.queueRefs()));
    }
    const check = () => this.checkUnmanagedEntries();
    const boot = () => {
      check();
      this.warmCards();
    };
    if (this.app.workspace.onLayoutReady) this.app.workspace.onLayoutReady(boot);
    else boot();
  }
  onunload() {
    if (this._pruneTimers) {
      for (const t of this._pruneTimers.values()) clearTimeout(t);
      this._pruneTimers.clear();
    }
    if (this._refTimer) {
      clearTimeout(this._refTimer);
      this._refTimer = null;
    }
    if (this._cardWarmTimer) {
      clearTimeout(this._cardWarmTimer);
      this._cardWarmTimer = null;
    }
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS2, data || {});
    if (data && data.filePath && !data.folderPath) {
      const old = String(data.filePath);
      const idx = old.lastIndexOf("/");
      this.settings.folderPath = idx > 0 ? old.slice(0, idx) : DEFAULT_SETTINGS2.folderPath;
    }
    if (!Array.isArray(this.settings.quickTags)) {
      this.settings.quickTags = DEFAULT_SETTINGS2.quickTags.slice();
    }
    if (!Array.isArray(this.settings.trash)) {
      this.settings.trash = [];
    }
    if (!Array.isArray(this.settings.collapsedDates)) {
      this.settings.collapsedDates = [];
    }
    if (typeof this.settings.blockRefEmbed !== "boolean") {
      this.settings.blockRefEmbed = false;
    }
    if (typeof this.settings.strictCardId !== "boolean") {
      this.settings.strictCardId = true;
    }
    const d = this.settings.draft;
    if (!d || typeof d !== "object" || typeof d.text !== "string" || typeof d.at !== "number") {
      this.settings.draft = { text: "", at: 0 };
    }
    const folder = String(this.settings.folderPath || "").replace(/^\/+|\/+$/g, "");
    this.settings.folderPath = folder && folder !== "." ? folder : DEFAULT_SETTINGS2.folderPath;
  }
  /**
   * 保存设置。reload=true 时让面板重读一遍文件（改文件夹这类必须重读）；
   * 回收站的增删恢复只需要更新一下条数，用 reload=false 走轻量重绘，不读盘。
   */
  async saveSettings(reload = true) {
    await this.saveData(this.settings);
    this.notifyViews(reload ? null : { light: true });
  }
  /* ---------------- 没提交完的手稿 ----------------
   * 只存在插件配置里（data.json），不写进任何笔记文件，
   * 也不会自己变成卡片：它只是把字填回输入框，还得你自己按保存。
   */
  /** 还有效的草稿内容；没有、为空白或超过 7 天都返回空串 */
  draftAlive() {
    const d = this.settings.draft;
    if (!d || typeof d.text !== "string") return "";
    if (!d.text.trim()) return "";
    if (!d.at || Date.now() - d.at > DRAFT_TTL) return "";
    return d.text;
  }
  /** 打字时用这个：停顿 1.5 秒才写盘，不打断输入 */
  queueDraft(text) {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      this._draftTimer = null;
      this.saveDraft(text);
    }, 1500);
  }
  /** 立即落盘（关掉输入框时用；会把防抖里那次一并落地） */
  async saveDraft(text) {
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    const raw = String(text == null ? "" : text).slice(0, DRAFT_MAX);
    if (!raw.trim()) {
      await this.clearDraft();
      return;
    }
    this.settings.draft = { text: raw, at: Date.now() };
    try {
      await this.saveData(this.settings);
    } catch (e) {
    }
  }
  /** 保存成功后清掉 */
  async clearDraft() {
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    const d = this.settings.draft;
    if (!d || !d.text && !d.at) return;
    this.settings.draft = { text: "", at: 0 };
    try {
      await this.saveData(this.settings);
    } catch (e) {
    }
  }
  /* ---------------- 路径 ---------------- */
  folderPathSafe() {
    const raw = String(this.settings.folderPath || "").replace(/^\/+|\/+$/g, "");
    return raw === "." ? "" : raw;
  }
  monthPath(m) {
    const folder = this.folderPathSafe();
    const name = m.format("YYYY-MM") + ".md";
    return folder ? folder + "/" + name : name;
  }
  /**
   * 写入前的路径断言：只允许改「当前文件夹下、按月命名」的文件，
   * 卡片日期所在月份还必须与文件名一致。跨月归档、目录被改指时直接拦下。
   */
  checkManagedFile(file, cardDate) {
    const folder = this.folderPathSafe();
    if (!folder) return { ok: false, reason: "\u8FD8\u6CA1\u6709\u8BBE\u7F6E\u5361\u7247\u6587\u4EF6\u5939" };
    if (!(file instanceof TFile)) return { ok: false, reason: "\u5361\u7247\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728" };
    if (!MONTH_FILE_RE.test(file.name)) return { ok: false, reason: "\u76EE\u6807\u6587\u4EF6\u4E0D\u662F\u6309\u6708\u5361\u7247\u6587\u4EF6" };
    const parent = String(file.path).split("/").slice(0, -1).join("/");
    if (parent !== folder) return { ok: false, reason: "\u5361\u7247\u6587\u4EF6\u4E0D\u5728\u5F53\u524D\u6587\u4EF6\u5939\u91CC" };
    if (cardDate && /^\d{4}-\d{2}-\d{2}$/.test(cardDate) && cardDate.slice(0, 7) !== baseOf(file.path)) {
      return { ok: false, reason: "\u5361\u7247\u65E5\u671F\u4E0E\u6587\u4EF6\u6708\u4EFD\u4E0D\u4E00\u81F4" };
    }
    return { ok: true };
  }
  /** 切换文件夹前的体检：不允许把不像卡片的年月文件接管过来 */
  async validateFolderTarget(path) {
    const val = String(path || "").trim().replace(/^\/+|\/+$/g, "");
    if (!val) return { ok: false, reason: "\u6587\u4EF6\u5939\u4E0D\u80FD\u4E3A\u7A7A" };
    if (val.indexOf("..") !== -1) return { ok: false, reason: "\u8DEF\u5F84\u91CC\u4E0D\u80FD\u51FA\u73B0 .." };
    if (val === ".obsidian" || val.indexOf(".obsidian/") === 0) {
      return { ok: false, reason: "\u4E0D\u80FD\u653E\u5728 .obsidian \u91CC" };
    }
    const af = this.app.vault.getAbstractFileByPath(val);
    if (af && !(af instanceof TFolder)) return { ok: false, reason: "\u8FD9\u662F\u4E00\u4E2A\u6587\u4EF6\uFF0C\u4E0D\u662F\u6587\u4EF6\u5939" };
    if (!(af instanceof TFolder)) return { ok: true };
    const months = af.children.filter((f) => f instanceof TFile && MONTH_FILE_RE.test(f.name));
    for (const f of months) {
      let content = "";
      try {
        content = await this.app.vault.cachedRead(f);
      } catch (e) {
        continue;
      }
      if (!qmLooksLikeCardFile(content)) {
        return { ok: false, reason: f.name + " \u91CC\u6709\u5361\u7247\u4EE5\u5916\u7684\u5185\u5BB9\uFF0C\u50CF\u662F\u522B\u7684\u7B14\u8BB0" };
      }
    }
    return { ok: true };
  }
  async ensureFolder(dir) {
    const parts = String(dir || "").split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? cur + "/" + p : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e) {
        }
      }
    }
  }
  async ensureFileAt(path) {
    const exist = this.app.vault.getAbstractFileByPath(path);
    if (exist instanceof TFile) return exist;
    const idx = path.lastIndexOf("/");
    if (idx > 0) await this.ensureFolder(path.slice(0, idx));
    try {
      return await this.app.vault.create(path, "");
    } catch (e) {
      const again = this.app.vault.getAbstractFileByPath(path);
      if (again instanceof TFile) return again;
      throw e;
    }
  }
  /* ---------------- 读取 ---------------- */
  listCardFiles() {
    const folder = this.app.vault.getAbstractFileByPath(this.settings.folderPath);
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter((f) => f instanceof TFile && MONTH_FILE_RE.test(f.name)).sort((a, b) => a.name < b.name ? -1 : 1);
  }
  isCardFilePath(path) {
    const folder = this.folderPathSafe();
    if (!folder) return false;
    const p = String(path || "");
    if (p.indexOf(folder + "/") !== 0) return false;
    return MONTH_FILE_RE.test(p.split("/").pop() || "");
  }
  async readAllCards() {
    const files = this.listCardFiles();
    const opts = { strict: this.settings.strictCardId !== false };
    const chunks = await Promise.all(
      files.map(async (f) => {
        let content = "";
        try {
          content = await this.app.vault.cachedRead(f);
        } catch (e) {
          try {
            content = await this.app.vault.read(f);
          } catch (e2) {
            content = "";
          }
        }
        return content ? parseCards(content, f.path, opts) : [];
      })
    );
    const all = [];
    for (const c of chunks) all.push(...c);
    return sortCards(all);
  }
  /** 快速记录弹窗用：面板已加载就直接用内存里的，避免每次开弹窗都读盘 */
  async cardsForSuggest() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QM)) {
      const v = leaf.view;
      if (v && v._loadedOnce && v.state && Array.isArray(v.state.cards)) return v.state.cards;
    }
    return await this.readAllCards();
  }
  /* ---------------- 写入 ---------------- */
  async mutateFile(path, fn) {
    const folder = this.folderPathSafe();
    const name = String(path).split("/").pop();
    if (!folder || String(path).indexOf(folder + "/") !== 0 || !MONTH_FILE_RE.test(name)) {
      throw new Error("\u62D2\u7EDD\u5199\u5165\u975E\u5361\u7247\u6587\u4EF6\uFF1A" + path);
    }
    const file = await this.ensureFileAt(path);
    let written = null;
    await this.app.vault.process(file, (data) => {
      const res = fn(String(data || ""));
      const next = typeof res === "string" ? res : data;
      if (next !== data) written = next;
      return next;
    });
    if (written !== null) {
      this.rememberWrite(path, written);
      this.notifyViews({ path, content: written });
    } else {
      this.notifyViews({ light: true });
    }
  }
  /**
   * 针对既有卡片的写入：先按当前文件内容重新定位，定位不到就不写。
   * 这样即使卡片在别处被改过（编辑器、同步、另一个窗口），也不会误删误改。
   */
  async mutateCardFile(card, fn) {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    const guard = this.checkManagedFile(file, card.date);
    if (!guard.ok) return guard;
    let out = { ok: false, reason: "\u6587\u4EF6\u5DF2\u5728\u522B\u5904\u4FEE\u6539\uFF0C\u5DF2\u5237\u65B0" };
    let written = null;
    const opts = { strict: this.settings.strictCardId !== false };
    await this.app.vault.process(file, (data) => {
      const content = String(data || "").replace(/\r\n?/g, "\n");
      const hit = qmLocateCard(content, card, opts);
      if (!hit) {
        out = { ok: false, reason: "\u8FD9\u6761\u5361\u7247\u5DF2\u7ECF\u4E0D\u5728\u539F\u4F4D\u4E86" };
        return data;
      }
      const res = fn(content.split("\n"), hit);
      if (typeof res !== "string") {
        out = { ok: false, reason: "\u8FD9\u6761\u5361\u7247\u5DF2\u7ECF\u4E0D\u5728\u539F\u4F4D\u4E86" };
        return data;
      }
      out = { ok: true, hit };
      if (res !== data) written = res;
      return res;
    });
    if (written !== null) {
      this.rememberWrite(card.filePath, written);
      this.notifyViews({ path: card.filePath, content: written });
    } else {
      this.notifyViews({ light: true });
    }
    return out;
  }
  uniqueIdIn(content) {
    const ids = qmCollectIds(content);
    let id = genId();
    let guard = 0;
    while (ids.has(id) && guard++ < 50) id = genId();
    return id;
  }
  /**
   * 通知面板更新。带 {path, content} 的只重解析这一个文件；
   * {light:true} 只重画界面文字；什么都不带才是老老实实重读全部。
   */
  notifyViews(info) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QM)) {
      const v = leaf.view;
      if (!v) continue;
      if (info && info.path && typeof v.applyFileCards === "function") {
        v.applyFileCards(info.path, info.content);
      } else if (info && info.light && typeof v.rerender === "function") {
        v.rerender();
      } else if (v.refresh) {
        v.refresh();
      }
    }
  }
  /* ---------------- 认出「这是我自己刚写的」 ---------------- */
  rememberWrite(path, content) {
    if (!this._ownWrites) this._ownWrites = /* @__PURE__ */ new Map();
    this._ownWrites.set(path, { content, at: Date.now() });
    while (this._ownWrites.size > 8) {
      const first = this._ownWrites.keys().next().value;
      this._ownWrites.delete(first);
    }
  }
  /**
   * 刚写完触发的 modify 事件，如果磁盘内容和插件刚写的一字不差，
   * 说明就是自己那次写入，不用再重读一遍。内容变了就当作外部改动。
   */
  async isOwnWrite(file) {
    if (!this._ownWrites || !file) return false;
    const rec = this._ownWrites.get(file.path);
    if (!rec) return false;
    if (Date.now() - rec.at > 3e3) {
      this._ownWrites.delete(file.path);
      return false;
    }
    let data = "";
    try {
      data = await this.app.vault.cachedRead(file);
    } catch (e) {
      return false;
    }
    if (data === rec.content) return true;
    this._ownWrites.delete(file.path);
    return false;
  }
  /* ---------------- 无块 ID 条目的体检 ---------------- */
  /**
   * 严格识别开着时，没有块 ID 的时间条目不会显示成卡片。
   * 这里只做一次提示（不改任何文件），防止旧卡片「悄悄消失」却不知道为什么。
   */
  async checkUnmanagedEntries() {
    if (this.settings.strictCardId === false) return;
    let total = 0;
    for (const f of this.listCardFiles()) {
      let content = "";
      try {
        content = await this.app.vault.cachedRead(f);
      } catch (e) {
        continue;
      }
      for (const c of parseCards(content, f.path, { strict: false })) {
        if (!c.id) total++;
      }
    }
    if (!total) {
      if (this.settings.strictNoticeCount) {
        this.settings.strictNoticeCount = 0;
        try {
          await this.saveData(this.settings);
        } catch (e) {
        }
      }
      return;
    }
    if (total === this.settings.strictNoticeCount) return;
    this.settings.strictNoticeCount = total;
    try {
      await this.saveData(this.settings);
    } catch (e) {
    }
    new Notice2(
      "Noval\uFF1A\u6709 " + total + " \u6761\u65F6\u95F4\u6761\u76EE\u6CA1\u6709\u5757 ID\uFF08^xxxx\uFF09\uFF0C\u4E0D\u4F1A\u663E\u793A\u6210\u5361\u7247\u3002\u5982\u679C\u662F\u4EE5\u524D\u7684\u5361\u7247\uFF0C\u5728\u884C\u5C3E\u8865\u4E00\u4E2A ^id \u5C31\u80FD\u7EB3\u5165\uFF1B\u4E5F\u53EF\u4EE5\u5728\u8BBE\u7F6E\u91CC\u5173\u6389\u300C\u4E25\u683C\u8BC6\u522B\u5361\u7247\u300D\u3002",
      15e3
    );
  }
  /* ---------------- 孤儿卡片：只读扫描 + 有确认的处置 ---------------- */
  /** 扫描当前托管文件夹里所有「有块 ID 但不显示」的段 */
  async findOrphans(fresh) {
    const out = [];
    const opts = { strict: this.settings.strictCardId !== false };
    for (const f of this.listCardFiles()) {
      let content = "";
      try {
        content = fresh ? await this.app.vault.read(f) : await this.app.vault.cachedRead(f);
      } catch (e) {
        continue;
      }
      for (const o of qmFindOrphans(content, f.path, opts)) out.push(o);
    }
    return out;
  }
  /** 写盘前在「刚读到的内容」里重新定位，防止读盘期间文件被改过 */
  _relocateOrphan(content, item, opts) {
    const list = qmFindOrphans(content, item.filePath, opts);
    return qmMatchOrphan(list, item);
  }
  /**
   * 恢复：把孤儿段原地改写成标准卡片格式。
   * 块 ID 能留就留（笔记里的 [[#^id]] 引用靠它），只有和别处冲突才换新。
   */
  async restoreOrphan(item, time) {
    const opts = { strict: this.settings.strictCardId !== false };
    let done = false;
    let written = null;
    let reason = "";
    let usedTime = "";
    const target = await this.ensureFileAt(item.filePath);
    await this.app.vault.process(target, (data) => {
      const guard = this.checkManagedFile(this.app.vault.getAbstractFileByPath(item.filePath), item.date);
      if (!guard.ok) {
        reason = guard.reason;
        return data;
      }
      const text = String(data || "");
      const hit = this._relocateOrphan(text, item, opts);
      if (!hit) {
        reason = "\u8FD9\u6BB5\u5185\u5BB9\u5DF2\u7ECF\u88AB\u6539\u8FC7\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5";
        return data;
      }
      usedTime = qmSuggestOrphanTime(text, item.filePath, hit, { time });
      const others = /* @__PURE__ */ new Set();
      const all = text.replace(/\r\n?/g, "\n").split("\n");
      all.forEach((l, i) => {
        if (i < hit.lineStart || i > hit.lineEnd) {
          for (const id of qmCollectIds(l)) others.add(id);
        }
      });
      let newId = hit.id || "";
      if (!newId || others.has(newId)) {
        let nid = genId();
        let guardN = 0;
        while (others.has(nid) && guardN++ < 50) nid = genId();
        newId = nid;
      }
      const lines = qmRebuildOrphanLines(hit, usedTime, newId);
      if (!lines) {
        reason = "\u8FD9\u6BB5\u5185\u5BB9\u662F\u7A7A\u7684\uFF0C\u65E0\u6CD5\u6062\u590D";
        return data;
      }
      const arr = all.slice();
      arr.splice(hit.lineStart, hit.lineEnd - hit.lineStart + 1, ...lines);
      done = true;
      written = arr.join("\n");
      return written;
    });
    if (!done) {
      new Notice2("\u6CA1\u6709\u6062\u590D\uFF1A" + (reason || "\u76EE\u6807\u6587\u4EF6\u4E0D\u53EF\u5199"), 8e3);
      return false;
    }
    this.rememberWrite(item.filePath, written);
    this.notifyViews({ path: item.filePath, content: written });
    new Notice2("\u5DF2\u6062\u590D\u4E3A\u5361\u7247\uFF08\u65F6\u95F4 " + usedTime + "\uFF09", 8e3);
    return true;
  }
  /** 删除：整段移除并进「最近删除」，可以恢复；空日期段顺手收掉 */
  async deleteOrphan(item) {
    const opts = { strict: this.settings.strictCardId !== false };
    let done = false;
    let written = null;
    let reason = "";
    const removed = [];
    const target = await this.ensureFileAt(item.filePath);
    await this.app.vault.process(target, (data) => {
      const guard = this.checkManagedFile(this.app.vault.getAbstractFileByPath(item.filePath), item.date);
      if (!guard.ok) {
        reason = guard.reason;
        return data;
      }
      const text = String(data || "");
      const hit = this._relocateOrphan(text, item, opts);
      if (!hit) {
        reason = "\u8FD9\u6BB5\u5185\u5BB9\u5DF2\u7ECF\u88AB\u6539\u8FC7\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5";
        return data;
      }
      const all = text.replace(/\r\n?/g, "\n").split("\n");
      removed.push({
        date: hit.date,
        time: "",
        body: hit.preview,
        lines: hit.lines.slice(),
        filePath: item.filePath
      });
      all.splice(hit.lineStart, hit.lineEnd - hit.lineStart + 1);
      done = true;
      written = qmPruneEmptyDateSections(all.join("\n"), hit.date);
      return written;
    });
    if (!done) {
      new Notice2("\u6CA1\u6709\u5220\u9664\uFF1A" + (reason || "\u76EE\u6807\u6587\u4EF6\u4E0D\u53EF\u5199"), 8e3);
      return false;
    }
    if (removed.length) await this.pushTrashMany(removed);
    this.rememberWrite(item.filePath, written);
    this.notifyViews({ path: item.filePath, content: written });
    new Notice2("\u5DF2\u5220\u9664 \xB7 \u53EF\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u6062\u590D", 7e3);
    return true;
  }
  /** 批量删除孤儿卡片：按文件分组，一次 process；写盘前逐条按 ID 重新定位 */
  async deleteOrphans(items) {
    const list = Array.isArray(items) ? items.slice() : [];
    const opts = { strict: this.settings.strictCardId !== false };
    const saved = [];
    const failed = [];
    const byFile = /* @__PURE__ */ new Map();
    for (const it of list) {
      const p = String(it && it.filePath || "");
      if (!p) {
        failed.push(it);
        continue;
      }
      if (!byFile.has(p)) byFile.set(p, []);
      byFile.get(p).push(it);
    }
    const writes = [];
    for (const [path, group] of byFile) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const guard = this.checkManagedFile(file, group[0].date);
      if (!guard.ok) {
        failed.push(...group);
        continue;
      }
      try {
        await this.app.vault.process(file, (data) => {
          const text = String(data || "");
          const live = qmFindOrphans(text, path, opts);
          const ranges = [];
          const used = /* @__PURE__ */ new Set();
          for (const it of group) {
            const hit = qmMatchOrphan(live, it);
            if (!hit || used.has(hit.lineStart)) {
              failed.push(it);
              continue;
            }
            used.add(hit.lineStart);
            ranges.push(hit);
          }
          if (!ranges.length) return data;
          const lines = text.replace(/\r\n?/g, "\n").split("\n");
          ranges.sort((a, b) => b.lineStart - a.lineStart);
          const removed = [];
          for (const hit of ranges) {
            removed.push({
              date: hit.date,
              time: "",
              body: hit.preview,
              lines: hit.lines.slice(),
              filePath: path
            });
            lines.splice(hit.lineStart, hit.lineEnd - hit.lineStart + 1);
          }
          let out = lines.join("\n");
          for (const d of new Set(removed.map((x) => x.date))) {
            out = qmPruneEmptyDateSections(out, d);
          }
          saved.push(...removed);
          if (out !== data) {
            this.rememberWrite(path, out);
            writes.push({ path, content: out });
          }
          return out;
        });
      } catch (e) {
        failed.push(...group);
      }
    }
    if (saved.length) await this.pushTrashMany(saved);
    if (writes.length === 1) this.notifyViews({ path: writes[0].path, content: writes[0].content });
    else if (writes.length > 1) this.notifyViews();
    return { deleted: saved.length, failed: failed.length };
  }
  /* ---------------- 空日期标题自动清理 ---------------- */
  /** 光标正停在哪个日期段里：这一段本轮不清理，避免打断正在写的内容 */
  cursorDatesIn(file) {
    const dates = /* @__PURE__ */ new Set();
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!view || !view.file || view.file.path !== file.path) continue;
      const editor = view.editor;
      if (!editor) continue;
      let lines = [];
      let line = 0;
      try {
        lines = String(editor.getValue() || "").split("\n");
        line = editor.getCursor("head").line;
      } catch (e) {
        continue;
      }
      for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        const m = lines[i].match(/^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/);
        if (m) {
          dates.add(m[1]);
          break;
        }
      }
    }
    return dates;
  }
  /**
   * 文件被改动后安排一次清理。不管是插件删的、还是你在编辑器里手动删的，
   * 只要某一天的卡片全没了，这个日期标题就会被收走。
   */
  pruneSoon(file) {
    if (!this.settings.autoPruneEmptyDates) return;
    if (!(file instanceof TFile)) return;
    if (!this.checkManagedFile(file).ok) return;
    if (!this._pruneTimers) this._pruneTimers = /* @__PURE__ */ new Map();
    const old = this._pruneTimers.get(file.path);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this._pruneTimers.delete(file.path);
      this.pruneEmptyDates(file);
    }, 1e3);
    this._pruneTimers.set(file.path, timer);
  }
  async pruneEmptyDates(file) {
    if (!this.settings.autoPruneEmptyDates) return;
    const target = this.app.vault.getAbstractFileByPath(file.path);
    if (!(target instanceof TFile)) return;
    if (!this.checkManagedFile(target).ok) return;
    if (await this.isOwnWrite(target)) return;
    let content = "";
    try {
      content = await this.app.vault.read(target);
    } catch (e) {
      return;
    }
    if (!content || content.indexOf("##") === -1) return;
    const skip = this.cursorDatesIn(target);
    if (!qmStripEmptyDateSections(content, skip).removed.length) return;
    let changed = null;
    try {
      await this.app.vault.process(target, (data) => {
        const res = qmStripEmptyDateSections(String(data || ""), skip);
        if (!res.removed.length) return data;
        changed = res.text;
        return res.text;
      });
    } catch (e) {
      return;
    }
    if (changed !== null) {
      this.rememberWrite(target.path, changed);
      this.notifyViews({ path: target.path, content: changed });
    }
  }
  /* ---------------- 增 ---------------- */
  async appendCard(text, opts) {
    const now = moment();
    const date = now.format("YYYY-MM-DD");
    const time = now.format("HH:mm");
    const path = this.monthPath(now);
    const bodyLines = qmBodyLines(text);
    if (!bodyLines.length) {
      new Notice2("\u5199\u70B9\u4EC0\u4E48\u518D\u8BB0\u4E0B\u5427");
      return false;
    }
    let madeId = "";
    try {
      await this.mutateFile(path, (content) => {
        const id = this.uniqueIdIn(content);
        madeId = id;
        return qmInsertCardLines(content, date, qmFormatEntry(time, bodyLines, id));
      });
    } catch (e) {
      new Notice2("\u6CA1\u8BB0\u4E0B\u6765\uFF1A" + (e && e.message ? e.message : "\u672A\u77E5\u539F\u56E0"), 8e3);
      return false;
    }
    this._lastAppended = { path, date, time, id: madeId, body: bodyLines.join("\n") };
    if (!(opts && opts.silent)) new Notice2("\u5DF2\u8BB0\u4E0B");
    return true;
  }
  /**
   * 把当前选中的文字存成一张卡片。
   * 桌面端优先读编辑器选区；读不到（阅读模式、或手机端点了按钮导致编辑器失焦）
   * 就用最近一次合法选区，超过 60 秒的旧选区不要，免得存进别处的旧内容。
   */
  async captureSelection(editor) {
    let text = "";
    try {
      if (editor && typeof editor.getSelection === "function") text = editor.getSelection();
    } catch (e) {
      text = "";
    }
    if (!String(text || "").trim()) {
      const fresh = Date.now() - (this._lastSelectionAt || 0) < 6e4;
      if (fresh) text = this._lastSelection || "";
    }
    text = String(text || "").replace(/\r\n?/g, "\n").trim();
    if (!text) {
      new Notice2("\u5148\u5728\u6B63\u6587\u91CC\u9009\u4E2D\u4E00\u6BB5\u6587\u5B57");
      return false;
    }
    const ok = await this.appendCard(text, { silent: true });
    if (!ok) return false;
    const long = text.length > 300;
    const msg = long ? "\u5DF2\u5B58\u4E3A\u5361\u7247\uFF08" + text.length + " \u5B57\uFF0C\u504F\u957F\uFF09\xB7 \u70B9\u6B64\u64A4\u9500" : "\u5DF2\u5B58\u4E3A\u5361\u7247 \xB7 \u70B9\u6B64\u64A4\u9500";
    const n = new Notice2(msg, 8e3);
    try {
      if (n && n.noticeEl) {
        n.noticeEl.addClass("qm-undo-toast");
        n.noticeEl.addEventListener("click", () => {
          n.hide();
          this.undoLastCapture();
        });
      }
    } catch (e) {
    }
    return true;
  }
  /** 撤销刚存的卡片：走正常删除流程（进回收站），但不弹第二个「已删除·撤销」 */
  async undoLastCapture() {
    const made = this._lastAppended;
    if (!made) return;
    this._lastAppended = null;
    await this.deleteCard(
      { filePath: made.path, date: made.date, time: made.time, body: made.body, id: made.id },
      { quiet: true }
    );
  }
  /**
   * 阅读模式下的 MarkdownView 也挂着一个 editor 对象，但它没挂到 DOM 上，
   * 对它 `replaceRange` 是**静默失败**：不报错、不落盘，按钮却照样变成「已插入」。
   * 所以取编辑器之前必须把这层排掉——排掉之后「插入到这篇」会改走追加到文件末尾。
   */
  isPreviewView(view) {
    try {
      if (!view) return false;
      if (typeof view.getMode === "function" && view.getMode() === "preview") return true;
      const cm = view.currentMode;
      if (cm && cm.type === "preview") return true;
    } catch (e) {
    }
    return false;
  }
  /**
   * 当前活动编辑器（手机端工具栏调命令时也能拿到）。
   *
   * 坑：点侧栏里的按钮会把活动叶子切成侧栏，`activeEditor` 立刻变 null ——
   * 中间栏明明开着笔记，「插入到这篇」却报「先打开一篇笔记」，就是死在这一步。
   * 所以拿不到时顺着「刚才用过的编辑器 → 主编辑区最近叶子 → 遍历 markdown 叶子」
   * 往下找，全都失败才算真的没有。
   */
  currentEditor() {
    const ws = this.app.workspace;
    try {
      const ae = ws.activeEditor;
      if (ae && ae.editor && !this.isPreviewView(ae)) return ae.editor;
    } catch (e) {
    }
    try {
      const leaf = this._lastMdLeaf;
      const ed = leaf && leaf.view && leaf.view.editor;
      if (ed && !this.isPreviewView(leaf.view) && this.leafAlive(leaf)) return ed;
    } catch (e) {
    }
    try {
      const leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf(ws.rootSplit) : null;
      const ed = leaf && leaf.view && leaf.view.editor;
      if (ed && !this.isPreviewView(leaf.view)) return ed;
    } catch (e) {
    }
    try {
      const leaves = ws.getLeavesOfType ? ws.getLeavesOfType("markdown") : [];
      let side = null;
      for (const leaf of leaves) {
        const ed = leaf && leaf.view && leaf.view.editor;
        if (!ed) continue;
        if (this.isPreviewView(leaf.view)) continue;
        const root = leaf.getRoot ? leaf.getRoot() : null;
        if (!root || !ws.rootSplit || root === ws.rootSplit) return ed;
        if (!side) side = ed;
      }
      if (side) return side;
    } catch (e) {
    }
    try {
      const view = ws.getActiveViewOfType ? ws.getActiveViewOfType(MarkdownView) : null;
      if (view && view.editor && !this.isPreviewView(view)) return view.editor;
    } catch (e) {
    }
    return null;
  }
  /**
   * 记住最后一个主编辑区里的 markdown 叶子。
   * 侧栏（本插件自己）被点中后 activeEditor 就是 null，插入卡片全靠这份缓存兜底；
   * 拖到右侧栏的笔记不算「这篇」，免得插错地方。
   */
  rememberEditorLeaf(leaf) {
    try {
      const ed = leaf && leaf.view && leaf.view.editor;
      if (!ed) return;
      const ws = this.app.workspace;
      const root = leaf.getRoot ? leaf.getRoot() : null;
      if (root && ws.rootSplit && root !== ws.rootSplit) return;
      this._lastMdLeaf = leaf;
    } catch (e) {
    }
  }
  /** 叶子是否还在工作区里（关掉标签后 leaf.view 还挂着，编辑器却已经废了） */
  leafAlive(leaf) {
    try {
      const ws = this.app.workspace;
      if (!leaf || !leaf.view) return false;
      if (typeof ws.getLeavesOfType !== "function") return true;
      return ws.getLeavesOfType("markdown").indexOf(leaf) >= 0;
    } catch (e) {
      return true;
    }
  }
  /** 当前这篇笔记（阅读视图里没有编辑器对象，只能从叶子上取 file） */
  currentNoteFile() {
    const ws = this.app.workspace;
    try {
      const f = ws.getActiveFile ? ws.getActiveFile() : null;
      if (f) return f;
    } catch (e) {
    }
    const fromLeaf = (leaf) => {
      try {
        return leaf && leaf.view && leaf.view.file || null;
      } catch (e) {
        return null;
      }
    };
    const cached = fromLeaf(this._lastMdLeaf);
    if (cached) return cached;
    try {
      const leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf(ws.rootSplit) : null;
      const f = fromLeaf(leaf);
      if (f) return f;
    } catch (e) {
    }
    try {
      const leaves = ws.getLeavesOfType ? ws.getLeavesOfType("markdown") : [];
      for (const leaf of leaves) {
        const f = fromLeaf(leaf);
        if (f) return f;
      }
    } catch (e) {
    }
    return null;
  }
  /**
   * 「插入到这篇」的唯一入口（回看用）。
   * 有编辑器就插在光标处；没有（阅读视图/焦点在侧栏且编辑器已关）就追加到这篇末尾，
   * 卡片引用是独立的一行内容，追加不会破坏原文。
   * 返回 true 表示确实插进去了。
   */
  async insertIntoCurrentNote(card, plain) {
    const ed = this.currentEditor();
    const file = this.currentNoteFile();
    if (!plain && card.id) {
      let text = "";
      try {
        text = ed && typeof ed.getValue === "function" ? ed.getValue() : "";
        if (!text && file) text = String(await this.app.vault.cachedRead(file));
      } catch (e) {
        text = "";
      }
      if (qmHasBlockRef(text, card.id)) {
        new Notice2("\u8FD9\u5F20\u5361\u7247\u5DF2\u7ECF\u5728\u8FD9\u7BC7\u7B14\u8BB0\u91CC\u4E86");
        return true;
      }
    }
    if (ed) {
      let from = null;
      let to = null;
      try {
        from = ed.getCursor("from");
        to = ed.getCursor("to");
      } catch (e) {
        from = null;
        to = null;
      }
      this.insertCardRef(card, ed, from, to, plain);
      return true;
    }
    const isNote = !!file && (file.extension === "md" || /\.md$/i.test(String(file.path || "")));
    if (!isNote) {
      new Notice2("\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0\uFF0C\u518D\u63D2\u5165\u5361\u7247");
      return false;
    }
    const insert = this.cardRefText(card, plain);
    try {
      await this.app.vault.process(file, (data) => {
        const text = String(data || "");
        if (!text) return insert + "\n";
        const head = text.endsWith("\n") ? text : text + "\n";
        return head + "\n" + insert + "\n";
      });
      new Notice2("\u5DF2\u8FFD\u52A0\u5230\u300C" + String(file.basename || file.name || "\u8FD9\u7BC7") + "\u300D\u672B\u5C3E");
      return true;
    } catch (e) {
      new Notice2("\u63D2\u5165\u5931\u8D25\uFF1A\u5199\u4E0D\u8FDB\u8FD9\u7BC7\u7B14\u8BB0");
      return false;
    }
  }
  /* ---------------- 卡片候选（;; 与插入面板共用） ---------------- */
  /**
   * 改动后延迟重建，不直接把缓存清空：
   * 清空的话连续敲字会一直重置定时器，缓存可能长期为空，
   * 打开面板就是一片空白。留着旧数据最多晚 1.2 秒。
   */
  invalidateCards() {
    if (this._cardWarmTimer) clearTimeout(this._cardWarmTimer);
    this._cardWarmTimer = setTimeout(() => {
      this._cardWarmTimer = null;
      this.warmCards();
    }, 1200);
  }
  async warmCards() {
    try {
      this._cardCache = await this.readAllCards();
    } catch (e) {
      this._cardCache = this._cardCache || [];
    }
  }
  /** 面板打开时用的数据：没预热过就现读一次，绝不给一个空列表 */
  async suggestCardsAsync(query) {
    if (!this._cardCache || !this._cardCache.length) await this.warmCards();
    return this.suggestCards(query);
  }
  /**
   * 打开选卡片面板。记下此刻的光标位置：面板是模态的，
   * 打开后编辑器会失焦，等选定再读光标可能已经是别处的了。
   */
  openCardPicker() {
    const ed = this.currentEditor();
    let from = null;
    let to = null;
    if (ed) {
      try {
        from = ed.getCursor("from");
        to = ed.getCursor("to");
      } catch (e) {
        from = null;
        to = null;
      }
    }
    new CardPickerModal(this.app, this, { editor: ed, from, to }).open();
  }
  /** 当前笔记的标签，用来给候选加权（同一主题的卡片更容易被想起来） */
  currentNoteTags() {
    try {
      const file = this.currentNoteFile();
      if (!file) return [];
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return [];
      const out = [];
      for (const t of cache.tags || []) {
        const v = String(t && t.tag || "").replace(/^#/, "").toLowerCase();
        if (v) out.push(v);
      }
      return out;
    } catch (e) {
      return [];
    }
  }
  /** 卡片写了多少天。日期段是现成的，不用额外存 */
  cardAgeDays(card) {
    try {
      const d = moment(String(card && card.date || ""), "YYYY-MM-DD", true);
      if (!d || typeof d.isValid !== "function" || !d.isValid()) return null;
      return moment().startOf("day").diff(d.clone().startOf("day"), "days");
    } catch (e) {
      return null;
    }
  }
  /**
   * 候选与排序。同步返回，数据来自预热好的缓存（触发时才不去读盘）。
   * 口径：字面命中为主，不装语义——写卡片和写文章用的是同一批词。
   */
  suggestCards(query) {
    const cards = this._cardCache || [];
    if (!cards.length) return [];
    const raw = String(query || "").trim();
    const conds = qmParseQuery(raw);
    const words = conds.filter((c) => c.kind === "text").map((c) => c.value);
    const noteTags = this.currentNoteTags();
    const rows = [];
    for (const c of cards) {
      const strict = qmCardMatches(c, conds);
      let sim = 0;
      if (!strict) {
        if (!raw) continue;
        sim = qmBigramScore(raw, c.bodyLower || "");
        const low = raw.toLowerCase();
        const tagHit = (c.tags || []).some((t) => String(t).toLowerCase().indexOf(low) !== -1);
        if (sim < 0.28 && !tagHit) continue;
      }
      rows.push({
        card: c,
        words,
        score: strict ? this.scoreCard(c, words, raw, noteTags) : sim * 5,
        fuzzy: !strict
      });
    }
    rows.sort((a, b) => b.score - a.score || String(b.card.date).localeCompare(String(a.card.date)));
    return rows.slice(0, 12);
  }
  scoreCard(card, words, raw, noteTags) {
    let score = 0;
    const body = String(card.bodyLower || "");
    for (const w of words) {
      if (w && body.indexOf(w) !== -1) score += 3;
    }
    if (raw.length >= 4) score += qmBigramScore(raw, body) * 5;
    score += Math.min(2, this.refCount(card));
    const tags = card.tags || [];
    for (const t of tags) {
      if (noteTags.indexOf(String(t).toLowerCase()) !== -1) score += 2;
    }
    const age = this.cardAgeDays(card);
    if (age !== null && age <= 30) score += 1;
    return score;
  }
  /** 候选行：时间 + 引用点 + 标签 + 首行（命中词高亮），不显示「相似度」 */
  renderSuggestRow(item, el) {
    el.empty();
    el.addClass("qm-picker-row");
    const head = el.createDiv({ cls: "qm-suggest-head" });
    head.createSpan({ cls: "qm-suggest-when", text: String(item.card.date).slice(5) + " " + item.card.time });
    if (item.card.id && this.refCount(item.card)) head.createSpan({ cls: "qm-suggest-ref" });
    const tags = item.card.tags || [];
    if (tags.length) {
      head.createSpan({ cls: "qm-suggest-tags", text: tags.slice(0, 3).map((t) => "#" + t).join(" ") });
    }
    const body = el.createDiv({ cls: "qm-suggest-body" });
    qmAppendHits(body, qmFirstLine(item.card.body, 80), item.words || []);
  }
  /**
   * 卡片要插进正文的那段文本（光标插入和追加到末尾共用一份，别两处各写一遍）。
   * plain=true 时给纯文本（只想抄原话），否则给块引用。
   * 没有块 ID 的旧卡片退化成纯文本，别造一个跳不过去的链接。
   */
  cardRefText(card, plain) {
    if (plain) return qmPasteText(card.body);
    if (card.id) {
      const bang = this.settings.blockRefEmbed ? "!" : "";
      return bang + "[[" + this.linkTarget(card) + "#^" + card.id + "]]";
    }
    new Notice2("\u8FD9\u5F20\u5361\u7247\u6CA1\u6709\u5757 ID\uFF0C\u63D2\u5165\u7684\u662F\u5168\u6587");
    return qmPasteText(card.body);
  }
  /**
   * 插进正文。plain=true 时插纯文本（只想抄原话），否则插块引用。
   */
  insertCardRef(card, editor, start, end, plain) {
    const insert = this.cardRefText(card, plain);
    try {
      const from = start || editor.getCursor("from");
      const to = end || editor.getCursor("to");
      editor.replaceRange(insert, from, to);
    } catch (e) {
      editor.replaceSelection(insert);
    }
    return insert;
  }
  /* ---------------- 补块 ID ---------------- */
  /**
   * 块引用的目标名：默认用文件名（移动文件夹不会断）。
   * 只有 vault 里存在同名文件时才补全路径，避免链接指到另一个同名文件。
   */
  linkTarget(card) {
    const name = String(card && card.fileBase || "") + ".md";
    let files = [];
    try {
      files = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles() : [];
    } catch (e) {
      files = [];
    }
    const same = files.filter((f) => f && f.name === name);
    if (same.length > 1) return String(card.filePath || "").replace(/\.md$/, "");
    return String(card && card.fileBase || "");
  }
  async ensureId(card) {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) return "";
    if (card.id && card.idOnLastLine) return card.id;
    let result = "";
    const res = await this.mutateCardFile(card, (lines, hit) => {
      const onEnd = lines[hit.lineEnd].match(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/);
      if (onEnd) {
        result = onEnd[1];
        return lines.join("\n");
      }
      let oldId = "";
      for (let j = hit.lineIndex; j < hit.lineEnd; j++) {
        const m = lines[j].match(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/);
        if (!m) continue;
        if (!oldId) oldId = m[1];
        lines[j] = lines[j].replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/, "");
      }
      const id = oldId || card.id || this.uniqueIdIn(lines.join("\n"));
      lines[hit.lineEnd] = lines[hit.lineEnd].replace(/[ \t]+$/, "") + " ^" + id;
      result = id;
      return lines.join("\n");
    });
    if (res.ok && result) {
      card.id = result;
      card.idOnLastLine = true;
    }
    return result;
  }
  /* ---------------- 改 ---------------- */
  /**
   * 编辑「原始内容区」。追加节由追加区自己维护，这里原样保留：
   * 以前整块重写 body，有追加的卡片一保存就会被抹掉追加内容。
   */
  async updateCard(card, newBody) {
    const bodyLines = qmBodyLines(newBody);
    if (!bodyLines.length) {
      new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
      return false;
    }
    const res = await this.mutateCardFile(card, (lines, hit) => {
      const sections = qmCardSections(qmBlockBody(lines, hit));
      const id = hit.id || card.id || this.uniqueIdIn(lines.join("\n"));
      const body = qmComposeBody(bodyLines.join("\n"), sections.appends);
      return qmReplaceBlock(lines, hit, body, id);
    });
    if (res.ok) new Notice2("\u5DF2\u66F4\u65B0");
    else new Notice2("\u6CA1\u6709\u4FEE\u6539\uFF1A" + res.reason);
    return !!res.ok;
  }
  /**
   * 与 updateCard 完全相同的写回逻辑，但不弹任何提示：
   * 供 AI 批量打标 / 标签合并等一次要写很多张卡的场景使用，
   * 避免「已更新」提示刷屏。
   */
  async quietUpdateCard(card, newBody) {
    const bodyLines = qmBodyLines(newBody);
    if (!bodyLines.length) return false;
    const res = await this.mutateCardFile(card, (lines, hit) => {
      const sections = qmCardSections(qmBlockBody(lines, hit));
      const id = hit.id || card.id || this.uniqueIdIn(lines.join("\n"));
      const body = qmComposeBody(bodyLines.join("\n"), sections.appends);
      return qmReplaceBlock(lines, hit, body, id);
    });
    return !!res.ok;
  }
  /* ---------------- 追加 ---------------- */
  /** 在卡片末尾追加一段；原始内容一个字都不动 */
  async appendToCard(card, text) {
    const bodyLines = qmBodyLines(text);
    if (!bodyLines.length) {
      new Notice2("\u5199\u70B9\u4EC0\u4E48\u518D\u8FFD\u52A0\u5427");
      return false;
    }
    const label = moment().format("YYYY-MM-DD HH:mm");
    const res = await this.mutateCardFile(card, (lines, hit) => {
      const sections = qmCardSections(qmBlockBody(lines, hit));
      sections.appends.push({ label, text: bodyLines.join("\n") });
      const id = hit.id || card.id || this.uniqueIdIn(lines.join("\n"));
      const body = qmComposeBody(sections.original, sections.appends);
      return qmReplaceBlock(lines, hit, body, id);
    });
    if (res.ok) new Notice2("\u5DF2\u8FFD\u52A0");
    else new Notice2("\u6CA1\u6709\u8FFD\u52A0\uFF1A" + res.reason);
    return !!res.ok;
  }
  /** 改第 index 条追加，其它节不动 */
  async updateAppend(card, index, text) {
    const bodyLines = qmBodyLines(text);
    if (!bodyLines.length) {
      new Notice2("\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
      return false;
    }
    let missing = false;
    const res = await this.mutateCardFile(card, (lines, hit) => {
      const sections = qmCardSections(qmBlockBody(lines, hit));
      if (!sections.appends[index]) {
        missing = true;
        return null;
      }
      sections.appends[index].text = bodyLines.join("\n");
      const id = hit.id || card.id || this.uniqueIdIn(lines.join("\n"));
      const body = qmComposeBody(sections.original, sections.appends);
      return qmReplaceBlock(lines, hit, body, id);
    });
    if (res.ok) new Notice2("\u5DF2\u66F4\u65B0\u8FFD\u52A0");
    else new Notice2(missing ? "\u8FD9\u6761\u8FFD\u52A0\u5DF2\u7ECF\u4E0D\u5B58\u5728\u4E86\uFF0C\u8BF7\u5237\u65B0" : "\u6CA1\u6709\u4FEE\u6539\uFF1A" + res.reason);
    return !!res.ok;
  }
  /** 删第 index 条追加，原始内容与其它追加不动 */
  async deleteAppend(card, index) {
    let missing = false;
    const res = await this.mutateCardFile(card, (lines, hit) => {
      const sections = qmCardSections(qmBlockBody(lines, hit));
      if (!sections.appends[index]) {
        missing = true;
        return null;
      }
      sections.appends.splice(index, 1);
      const id = hit.id || card.id || this.uniqueIdIn(lines.join("\n"));
      const body = qmComposeBody(sections.original, sections.appends);
      return qmReplaceBlock(lines, hit, body, id);
    });
    if (res.ok) new Notice2("\u5DF2\u5220\u9664\u8FD9\u6761\u8FFD\u52A0");
    else new Notice2(missing ? "\u8FD9\u6761\u8FFD\u52A0\u5DF2\u7ECF\u4E0D\u5B58\u5728\u4E86\uFF0C\u8BF7\u5237\u65B0" : "\u6CA1\u6709\u5220\u9664\uFF1A" + res.reason);
    return !!res.ok;
  }
  /* ---------------- 删 ---------------- */
  async deleteCard(card, opts) {
    let removed = null;
    const res = await this.mutateCardFile(card, (lines, hit) => {
      removed = lines.slice(hit.lineIndex, hit.lineEnd + 1);
      lines.splice(hit.lineIndex, hit.lineEnd - hit.lineIndex + 1);
      return qmPruneEmptyDateSections(lines.join("\n"), hit.date);
    });
    if (!res.ok) {
      new Notice2("\u6CA1\u6709\u5220\u9664\uFF1A" + res.reason);
      return;
    }
    const entry = await this.pushTrash({
      date: res.hit.date,
      time: res.hit.time,
      body: res.hit.body,
      lines: removed,
      filePath: card.filePath
    });
    if (opts && opts.quiet) return;
    const n = new Notice2("\u5DF2\u5220\u9664 \xB7 \u70B9\u6B64\u64A4\u9500", 9e3);
    try {
      if (n && n.noticeEl) {
        n.noticeEl.addClass("qm-undo-toast");
        n.noticeEl.addEventListener("click", () => {
          n.hide();
          this.restoreTrash(entry.uid);
        });
      }
    } catch (e) {
    }
  }
  /**
   * 批量删除：按文件分组，同一文件里的多条合并成一次读写。
   * 每条仍然走 qmLocateCard 的正文校验，定位不到的跳过（不写坏文件），
   * 删下来的原始行进回收站，可以逐条恢复。
   */
  async deleteCards(cards) {
    const list = Array.isArray(cards) ? cards.slice() : [];
    const saved = [];
    const failed = [];
    const byFile = /* @__PURE__ */ new Map();
    for (const c of list) {
      const p = String(c && c.filePath || "");
      if (!p) {
        failed.push(c);
        continue;
      }
      if (!byFile.has(p)) byFile.set(p, []);
      byFile.get(p).push(c);
    }
    const writes = [];
    for (const [path, group] of byFile) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const guard = this.checkManagedFile(file, group[0].date);
      if (!guard.ok) {
        failed.push(...group);
        continue;
      }
      const removed = [];
      const opts = { strict: this.settings.strictCardId !== false };
      try {
        await this.app.vault.process(file, (data) => {
          const text = String(data || "");
          const ranges = [];
          const used = /* @__PURE__ */ new Set();
          for (const c of group) {
            const hit = qmLocateCard(text, c, opts);
            if (!hit || used.has(hit.lineIndex)) {
              failed.push(c);
              continue;
            }
            used.add(hit.lineIndex);
            ranges.push(hit);
          }
          if (!ranges.length) return data;
          const lines = text.replace(/\r\n?/g, "\n").split("\n");
          ranges.sort((a, b) => b.lineIndex - a.lineIndex);
          for (const hit of ranges) {
            removed.push({
              date: hit.date,
              time: hit.time,
              body: hit.body,
              lines: lines.slice(hit.lineIndex, hit.lineEnd + 1),
              filePath: path
            });
            lines.splice(hit.lineIndex, hit.lineEnd - hit.lineIndex + 1);
          }
          let out = lines.join("\n");
          for (const d of new Set(removed.map((x) => x.date))) {
            out = qmPruneEmptyDateSections(out, d);
          }
          if (out !== data) {
            this.rememberWrite(path, out);
            writes.push({ path, content: out });
          }
          return out;
        });
      } catch (e) {
        failed.push(...group);
        continue;
      }
      saved.push(...removed);
    }
    if (saved.length) await this.pushTrashMany(saved);
    if (writes.length === 1) this.notifyViews({ path: writes[0].path, content: writes[0].content });
    else if (writes.length > 1) this.notifyViews();
    else this.notifyViews({ light: true });
    return { deleted: saved.length, failed: failed.length };
  }
  /* ---------------- 回收站 ---------------- */
  async pushTrash(item) {
    const uid = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = {
      uid,
      date: String(item.date || ""),
      time: String(item.time || ""),
      body: String(item.body || "").slice(0, 4e3),
      lines: Array.isArray(item.lines) ? item.lines.slice() : [],
      filePath: String(item.filePath || ""),
      deletedAt: Date.now()
    };
    this.settings.trash.unshift(entry);
    if (this.settings.trash.length > 50) this.settings.trash.length = 50;
    await this.saveSettings(false);
    return entry;
  }
  /** 批量入回收站：一次写完，避免 N 次读写配置与刷新视图 */
  async pushTrashMany(items) {
    if (!items || !items.length) return;
    const now = Date.now();
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      this.settings.trash.unshift({
        uid: "t" + (now + i).toString(36) + Math.random().toString(36).slice(2, 6),
        date: String(it.date || ""),
        time: String(it.time || ""),
        body: String(it.body || "").slice(0, 4e3),
        lines: Array.isArray(it.lines) ? it.lines.slice() : [],
        filePath: String(it.filePath || ""),
        deletedAt: now
      });
    }
    if (this.settings.trash.length > 50) this.settings.trash.length = 50;
    await this.saveData(this.settings);
  }
  async dropTrash(uid) {
    const i = this.settings.trash.findIndex((t) => t.uid === uid);
    if (i === -1) return;
    this.settings.trash.splice(i, 1);
    await this.saveSettings(false);
  }
  async clearTrash() {
    this.settings.trash = [];
    await this.saveSettings(false);
  }
  async restoreTrash(uid) {
    const i = this.settings.trash.findIndex((t) => t.uid === uid);
    if (i === -1) {
      new Notice2("\u8FD9\u6761\u8BB0\u5F55\u5DF2\u7ECF\u4E0D\u5728\u300C\u6700\u8FD1\u5220\u9664\u300D\u91CC\u4E86");
      return;
    }
    const entry = this.settings.trash[i];
    if (!entry.filePath) {
      new Notice2("\u65E0\u6CD5\u6062\u590D\uFF1A\u8FD9\u6761\u8BB0\u5F55\u91CC\u6CA1\u6709\u6587\u4EF6\u8DEF\u5F84");
      return;
    }
    const file = await this.ensureFileAt(entry.filePath);
    const guard = this.checkManagedFile(file, entry.date);
    if (!guard.ok) {
      new Notice2("\u65E0\u6CD5\u6062\u590D\uFF1A" + guard.reason);
      return;
    }
    let done = false;
    let written = null;
    await this.app.vault.process(file, (data) => {
      const content = String(data || "").replace(/\r\n?/g, "\n");
      const ids = qmCollectIds(content);
      let lines = (entry.lines || []).slice();
      if (!lines.length) {
        lines = qmFormatEntry(entry.time || "00:00", qmBodyLines(entry.body), "");
      }
      const last = lines.length - 1;
      const m = String(lines[last] || "").match(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/);
      const needId = !m || ids.has(m[1]);
      if (needId) {
        let nid = genId();
        let guardN = 0;
        while (ids.has(nid) && guardN++ < 50) nid = genId();
        const bare = String(lines[last] || "").replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/, "");
        lines[last] = bare.replace(/[ \t]+$/, "") + " ^" + nid;
      }
      done = true;
      const out = qmInsertRestoredCard(content, entry.date, entry.time, lines);
      if (out !== data) written = out;
      return out;
    });
    if (!done) {
      new Notice2("\u6062\u590D\u5931\u8D25\uFF1A\u76EE\u6807\u6587\u4EF6\u4E0D\u53EF\u5199");
      return;
    }
    this.settings.trash.splice(i, 1);
    await this.saveSettings(false);
    if (written !== null) {
      this.rememberWrite(entry.filePath, written);
      this.notifyViews({ path: entry.filePath, content: written });
    }
    new Notice2("\u5DF2\u6062\u590D");
  }
  /* ---------------- 其他 ---------------- */
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }
  async openCurrentMonthFile() {
    const path = this.monthPath(moment());
    const file = await this.ensureFileAt(path);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_QM);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice2("\u65E0\u6CD5\u521B\u5EFA\u4FA7\u8FB9\u680F\u89C6\u56FE");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_QM, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
};
module.exports = QuickMemoPlugin;
module.exports.ICON_ID = ICON_ID;
module.exports.ICON_MARK = ICON_MARK;
module.exports.CaptureModal = CaptureModal;
module.exports.qmMenuPlace = qmMenuPlace;
module.exports.qmSelbarGap = qmSelbarGap;
module.exports.qmStatusCover = qmStatusCover;
module.exports.qmHasBlockRef = qmHasBlockRef;
module.exports.qmShuffle = qmShuffle;
module.exports.qmFindOrphans = qmFindOrphans;
module.exports.qmMatchOrphan = qmMatchOrphan;
module.exports.qmOrphanFingerprint = qmOrphanFingerprint;
module.exports.qmSuggestOrphanTime = qmSuggestOrphanTime;
module.exports.qmRebuildOrphanLines = qmRebuildOrphanLines;
module.exports.TrashModal = TrashModal;
module.exports.OrphanModal = OrphanModal;
module.exports.ConfirmModal = ConfirmModal;
module.exports.RefListModal = RefListModal;
module.exports.qmPasteText = qmPasteText;
module.exports.qmLocateCard = qmLocateCard;
module.exports.qmCardSections = qmCardSections;
module.exports.qmComposeBody = qmComposeBody;
