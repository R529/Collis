/*
  noval-ai-tag.js — 卡片笔记 · 个人标签学习引擎（V6）

  总纲：插件只提供「机制」，不提供任何「内容」。
  - 零预设词表：每个用户的标签体系从他自己的卡片里长出来；
  - 归类（放进已有标签）由 AI 自动做，准且不膨胀；
  - 建类（创造新标签）必须攒够同主题卡片才提议，出生即带多条内容；
  - 同一张卡永远得到同一组候选（按内容缓存），不存在来回摇摆；
  - 用户的每次确认/纠错记入决策记忆，让后续建议向他的习惯收敛。

  三档模式：
  - suggest（默认）：AI 一次摊开候选，用户一下点选；
  - auto：AI 直接拍板写入（只允许放进已有标签，绝不自动造新词）；
  - manual：AI 只给参考，不预选，用户自己挑。

  与 Obsidian 的隔离：只用 cachedRead / 卡片正文，不注册热键、
  不触碰原生搜索，样式全部限定在 .noval-aitag / .noval-taghealth 前缀内。
*/

var { Notice: Notice2, Modal: Modal2 } = require("obsidian");
var BoardBundle = require("../vendor/noval-board-core.js");

var BOARD_ID = "noval-board";
var MAX_BODY_CHARS = 4000;
var VOCAB_LIMIT = 40;
var REQUEST_TOKENS = 3000;
var CACHE_LIMIT = 300;
var CASES_LIMIT = 100;
var FEW_SHOT_N = 8;
var BATCH_MIN_NEW = 3; // 攒够这么多张同主题卡片，才提议新建标签

var AI_TAG_DEFAULTS = {
  enabled: true,
  profileId: "",
  mode: "suggest", // suggest | auto | manual
  granularity: "follow", // follow | broad | medium | fine
  maxCand: 6, // 一次摊开的候选数量 4-8
  extraVocab: [],
  cases: [], // 决策记忆：{ s: 片段, t: 选的, r: 放弃的, at }
  cache: {} // 内容哈希 -> { r: 解析后的候选, at }
};

var CAND_CHOICES = [4, 6, 8];

var GRANULARITY_RULE = {
  broad: "宽窄偏好：偏宽。多给「时间」「成长」「关系」这类常用词，它们覆盖的面大、以后一定能再装下别的卡。",
  medium: "宽窄偏好：适中。可以给「时间管理」「产品设计」这类词，但每个词以后仍然要能装下别的卡。",
  fine: "宽窄偏好：偏具体。可以给「年龄焦虑」「告别」「开始」这类词，只要它确实是你以后会搜的。"
};

/* ---------------- 基础工具 ---------------- */

function normalizeTag(raw) {
  var t = String(raw == null ? "" : raw).trim();
  if (!t) return "";
  t = t.replace(/^#+/, "");
  // 保留层级分隔符「/」：插件支持 #产品/定价 这种标签，清掉会把老标签改坏
  t = t.replace(/[\s,，。;；:：!！?？"'“”‘’()\[\]{}<>《》|\\~`@&*+=^]+/g, "");
  t = t.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  if (!t || t.length > 20) return "";
  return t;
}

function sameFamily(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function sampleOf(text) {
  var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (s.length > 26) return s.slice(0, 26) + "…";
  return s;
}

function hashBody(body) {
  var s = String(body == null ? "" : body).slice(0, MAX_BODY_CHARS);
  var h = 5381;
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function containsTag(text, tag) {
  if (!text || !tag) return false;
  var re = tagRegex(tag);
  re.lastIndex = 0;
  return re.test(text);
}

function tagRegex(tag) {
  var esc = String(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 与卡片解析的 TAG_RE 同边界：后面不能再跟「标签字符」，
  // 这样 #时间 不会误伤 #时间管理
  return new RegExp("#" + esc + "(?![^\\s#\\[\\]()])", "g");
}

function removeTagFromBody(body, tag) {
  var text = String(body == null ? "" : body);
  var out = [];
  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var had = false;
    var next = line.replace(tagRegex(tag), function () {
      had = true;
      return "";
    });
    if (had) {
      // 只收拾这一行标签周围的空格。不能全篇折叠空格，
      // 否则卡片续行的两格缩进会被抹平，正文结构就毁了。
      next = next.replace(/(\S)[ \t]{2,}/g, "$1 ").replace(/[ \t]+$/, "");
      // 整行只剩标签时统一靠左，避免留下「  #商业」这种前导空格
      if (next.trim().charAt(0) === "#") next = next.trim();
      if (!next.trim()) continue; // 整行只有这个标签，直接去掉这行
    }
    out.push(next);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
}

function replaceTagInBody(body, oldTag, newTag) {
  var text = String(body == null ? "" : body);
  if (!newTag) return removeTagFromBody(text, oldTag);
  if (containsTag(text, newTag)) return removeTagFromBody(text, oldTag);
  return text.replace(tagRegex(oldTag), "#" + newTag);
}

function bodyWithTags(body, tags) {
  // 只收正文末尾的空白。不能逐行 trimEnd：markdown 里「两个空格结尾」是硬换行，
  // 全篇清理会把卡片原有的换行语义改掉。
  var text = String(body == null ? "" : body).replace(/\s+$/, "");
  var add = [];
  for (var raw of tags) {
    var t = normalizeTag(raw);
    if (!t) continue;
    if (containsTag(text, t)) continue;
    if (add.indexOf(t) === -1) add.push(t);
  }
  if (!add.length) return text;
  var addText = add.map(function (t) { return "#" + t; }).join(" ");
  if (!text) return addText;
  var lines = text.split("\n");
  var last = lines[lines.length - 1];
  // 和卡片现有写法一致：标签跟在最后一行末尾；如果这行带块 ID，
  // 标签必须插在 ^id 前面——块 ID 只有在行尾才认。
  var block = last.match(/^(.*?)(\s*\^[A-Za-z0-9-]+)\s*$/);
  if (block) {
    var before = block[1].replace(/[ \t]+$/, "");
    lines[lines.length - 1] = (before ? before + " " : "") + addText + " " + block[2].trim();
    return lines.join("\n");
  }
  lines[lines.length - 1] = last.replace(/[ \t]+$/, "") + " " + addText;
  return lines.join("\n");
}

/* ---------------- 设置存取 ---------------- */

/**
 * 拿到 settings 上「活」的 aiTag 对象（缺什么补什么）。
 * 所有对词表记忆 / 缓存 / 判例的写入都直接落在它上面，
 * 之后由宿主 saveSettings() 持久化。
 */
function getStore(panel) {
  var host = panel && panel.noval;
  if (!host || !host.settings) return null;
  if (!host.settings.aiTag || typeof host.settings.aiTag !== "object") host.settings.aiTag = {};
  var s = host.settings.aiTag;
  if (!Array.isArray(s.extraVocab)) s.extraVocab = [];
  if (!Array.isArray(s.cases)) s.cases = [];
  if (!s.cache || typeof s.cache !== "object" || Array.isArray(s.cache)) s.cache = {};
  return s;
}

function readOptions(panel) {
  var store = getStore(panel);
  var merged = Object.assign({}, AI_TAG_DEFAULTS, store || {});
  if (["suggest", "auto", "manual"].indexOf(merged.mode) === -1) merged.mode = "suggest";
  if (["follow", "broad", "medium", "fine"].indexOf(merged.granularity) === -1) merged.granularity = "follow";
  if (CAND_CHOICES.indexOf(Number(merged.maxCand)) === -1) merged.maxCand = AI_TAG_DEFAULTS.maxCand;
  merged.maxCand = Number(merged.maxCand);
  merged.cases = store ? store.cases : merged.cases;
  merged.cache = store ? store.cache : merged.cache;
  merged.extraVocab = store ? store.extraVocab : merged.extraVocab;
  return merged;
}

function saveStore(panel) {
  var host = panel && panel.noval;
  if (!host) return;
  // 直接写盘，不走 saveSettings(false)：后者会触发面板 light 重绘，
  // 把正在展开的建议栏一起重画掉。
  try {
    if (typeof host.saveData === "function") {
      var p = host.saveData(host.settings);
      if (p && typeof p.catch === "function") p.catch(function () {});
      return;
    }
  } catch (error) {
  }
  if (typeof host.saveSettings === "function") host.saveSettings(false);
}

/* ---------------- 个人词表（从用户自己的卡片里学） ---------------- */

/**
 * 词表 = 用户已经用过的标签 + 设置里预先指定的标签。
 * 插件不携带任何默认词表；每个用户长出来的词表都不一样。
 */
function collectVocab(cards, extra) {
  var map = new Map();
  var ensure = function (label) {
    var key = label.toLowerCase();
    var slot = map.get(key);
    if (!slot) {
      slot = { label: label, count: 0, sample: "" };
      map.set(key, slot);
    }
    return slot;
  };
  for (var raw of extra || []) {
    var t = normalizeTag(raw);
    if (t) ensure(t);
  }
  for (var card of cards || []) {
    for (var tag of card.tags || []) {
      var label = normalizeTag(tag);
      if (!label) continue;
      var slot = ensure(label);
      slot.count++;
      if (!slot.sample) slot.sample = sampleOf(card.body || "");
    }
  }
  return Array.from(map.values())
    .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, "zh"); })
    .slice(0, VOCAB_LIMIT);
}

/**
 * 粒度自适应：用户没手动锁定时，从他现有词表的平均长度推断习惯。
 * 词少时退回「宽」，避免冷启动阶段造出一堆细碎词。
 */
function effectiveGranularity(options, vocab) {
  if (options.granularity !== "follow") return options.granularity;
  var real = (vocab || []).filter(function (v) { return v.count > 0; });
  if (real.length < 3) return "broad";
  var top = real.slice(0, 20);
  var avg = top.reduce(function (s, v) { return s + v.label.length; }, 0) / top.length;
  if (avg <= 2.4) return "broad";
  if (avg <= 3.4) return "medium";
  return "fine";
}

/* ---------------- 决策记忆 ---------------- */

function addCase(panel, snippet, chosen, rejected) {
  var store = getStore(panel);
  if (!store || !chosen) return;
  store.cases.unshift({
    s: sampleOf(snippet),
    t: String(chosen),
    r: String(rejected == null ? "" : rejected),
    at: Date.now()
  });
  if (store.cases.length > CASES_LIMIT) store.cases.length = CASES_LIMIT;
}

function fewShotLines(options) {
  var lines = [];
  for (var c of (options.cases || []).slice(0, FEW_SHOT_N)) {
    if (!c || !c.t) continue;
    var line = "卡片：\"" + (c.s || "") + "\" → 用户放进：" + c.t;
    if (c.r) line += "（没选：" + c.r + "）";
    lines.push(line);
  }
  return lines;
}

/* ---------------- 结果缓存（同一张卡永远同一组候选） ---------------- */

function cacheGet(options, key) {
  var hit = options.cache && options.cache[key];
  return hit && Array.isArray(hit.r) ? hit.r : null;
}

function cacheSet(options, key, parsed) {
  if (!options.cache) return;
  options.cache[key] = { r: parsed, at: Date.now() };
  var keys = Object.keys(options.cache);
  if (keys.length <= CACHE_LIMIT) return;
  keys
    .map(function (k) { return { k: k, at: (options.cache[k] || {}).at || 0 }; })
    .sort(function (a, b) { return a.at - b.at; })
    .slice(0, keys.length - CACHE_LIMIT)
    .forEach(function (item) { delete options.cache[item.k]; });
}

/* ---------------- 提示词 ---------------- */

function buildSystemPrompt(options, granularity) {
  return [
    "你是中文卡片笔记的标签助手。用户记的是零散素材（金句、观点、故事、方法），以后写东西时要靠标签把它们翻出来。",
    "你的任务：为这张卡片列出 6-8 个「他以后可能会搜的词」，让他自己挑。不要替他决定唯一答案，也不要只给两三个。",
    "",
    "【词应该长什么样】",
    "标准只有一个：三个月后他想找回这段内容，会在搜索框里敲这个词。",
    "好词：时间、年龄、成长、关系、习惯、金钱、职场、写作、方法、案例、金句、告别、开始、拖延、摩西奶奶。",
    "坏词（这是对内容的概括，不是搜索词）：生命有限、时间稀缺、时间感知、余生、认知跃迁、重视积累。",
    "自检：一个真人在搜索框里会敲坏词吗？不会。他敲的是好词。",
    "",
    "【怎么给】",
    "- 一次给 6-8 个，角度要散开，不要用近义词凑数：",
    "  主题词（这条讲什么领域）、场景词（什么处境下会想起它）、对象词（人名/书名/事物）、体裁词（金句/案例/方法/观点）。",
    "- 一个词只要「大概率相关」就可以给，不必精确。素材库需要宽一点的入口，用户自己会筛。",
    "- 已有标签合适就原样复用；不贴切就绝对不要硬凑，用你判断更好的词。",
    "- 允许给多个新词，最多 3 个。新词不用解释为什么该建。",
    "- 按「最可能被搜到」排序，第一个是你认为最贴的。",
    "",
    GRANULARITY_RULE[granularity] || GRANULARITY_RULE.broad,
    "",
    "【conf】0 到 1，表示这个词被搜到的可能性，诚实给，不要全填一样。",
    "",
    "【输出】只输出一行 JSON，不要解释，不要 Markdown 代码块：",
    "{\"candidates\":[{\"tag\":\"词\",\"why\":\"以后什么场景会搜它，15字内\",\"conf\":0.7}]}"
  ].join("\n");
}

function buildUserPrompt(body, vocab, options, exclude) {
  var lines = ["已有标签（标签 | 用过几次 | 其中一张卡的片段）："];
  if (!vocab.length) {
    lines.push("（暂无。这张卡是第一批，你看情况给词就行。）");
  } else {
    for (var v of vocab) {
      lines.push(v.label + " | " + v.count + " | " + (v.sample || ""));
    }
  }
  var shots = fewShotLines(options);
  if (shots.length) {
    lines.push("");
    lines.push("【参考】用户过去给类似卡片的决定（建议要向他自己的习惯靠拢）：");
    for (var s of shots) lines.push(s);
  }
  lines.push("");
  lines.push("卡片正文：");
  lines.push(String(body == null ? "" : body).slice(0, MAX_BODY_CHARS));
  lines.push("");
  if (exclude && exclude.length) {
    lines.push("【他刚刚否决了这些】" + exclude.join("、"));
    lines.push("换一批角度：不要和上面任何一个重复或近义。");
    lines.push("");
  }
  lines.push("列出 " + Math.max(6, options.maxCand) + " 个候选标签，角度散开。已有标签合适就用原样，不合适就给新词。");
  return lines.join("\n");
}

/* ---------------- 解析与整形 ---------------- */

function parseCandidates(text) {
  var raw = String(text == null ? "" : text).trim();
  var start = raw.indexOf("{");
  var end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI 返回的不是 JSON");
  var obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw new Error("AI 返回的 JSON 解析失败");
  }
  var arr = Array.isArray(obj.candidates) ? obj.candidates : [];
  var out = [];
  for (var item of arr) {
    if (!item || typeof item !== "object") continue;
    var label = normalizeTag(item.tag);
    if (!label) continue;
    var conf = Number(item.conf);
    if (!isFinite(conf)) conf = 0.5;
    conf = Math.max(0, Math.min(1, conf));
    out.push({
      label: label,
      why: String(item.why == null ? item.scene || "" : item.why).slice(0, 30),
      conf: conf
    });
  }
  return out;
}

/**
 * 整形：同族词只留一个（优先保留词表里的写法）、去掉卡上已有的、按置信度排序。
 * 新词一律保留——是否新建由用户自己点，不由插件预先否决。
 * 返回 { list, tight }：tight=true 表示前两名难分伯仲。
 */
function shapeCandidates(parsed, vocab, card, options) {
  var existing = new Set();
  for (var tag of card.tags || []) {
    var t = normalizeTag(tag);
    if (t) existing.add(t.toLowerCase());
  }
  var seen = [];
  var list = [];
  var sorted = (parsed || []).slice().sort(function (a, b) { return b.conf - a.conf; });
  for (var cand of sorted) {
    var label = cand.label;
    var key = label.toLowerCase();
    if (existing.has(key)) continue;
    // 同族只留一个：词表里已有同族写法时，保留词表那个（避免「写作」「写作方法」并存）
    var dup = seen.find(function (k) { return sameFamily(k, key); });
    if (dup) continue;
    var fold = vocab.find(function (v) { return sameFamily(v.label.toLowerCase(), key); });
    var isNew = !fold;
    if (fold) {
      label = fold.label;
      key = label.toLowerCase();
      if (existing.has(key)) continue;
    }
    seen.push(key);
    list.push({ label: label, why: cand.why, conf: cand.conf, isNew: isNew });
    if (list.length >= options.maxCand) break;
  }
  var tight = false;
  if (list.length >= 2) {
    tight = Math.abs(list[0].conf - list[1].conf) < 0.1;
  }
  return { list: list, tight: tight };
}

/** 自动档：只进已有标签，绝不自动造新词，也不低分硬凑 */
function pickAuto(list) {
  var existing = (list || []).filter(function (c) { return !c.isNew && c.conf >= 0.5; });
  if (!existing.length) return null;
  existing = existing.slice().sort(function (a, b) {
    return b.conf - a.conf || a.label.localeCompare(b.label, "zh");
  });
  return existing[0];
}

/**
 * 把一张卡的新词候选并进提案表：同族词（时间 / 时间管理）算同一个提案，
 * 否则模型每次换个叫法，就永远攒不够建类所需的数量。
 */
function addProposal(proposals, fresh, card) {
  var key = null;
  proposals.forEach(function (_info, k) {
    if (!key && sameFamily(k.toLowerCase(), fresh.label.toLowerCase())) key = k;
  });
  if (!key) {
    key = fresh.label;
    proposals.set(key, { why: fresh.why, cards: [] });
  }
  proposals.get(key).cards.push(card);
  return key;
}

/** 攒够 BATCH_MIN_NEW 张才提议建类；不够的只统计张数，先留着 */
function splitProposals(proposals) {
  var viable = [];
  var dropped = 0;
  proposals.forEach(function (info, label) {
    if (info.cards.length >= BATCH_MIN_NEW) viable.push([label, info]);
    else dropped += info.cards.length;
  });
  return { viable: viable, dropped: dropped };
}

/* ---------------- 模型请求 ---------------- */

function resolveAi(panel) {
  var opts = readOptions(panel);
  if (!opts.enabled) return { error: "AI 打标签开关没开：设置 → 卡片笔记 · AI。" };
  // AI 配置挂在画布子插件上（noval-board.ai），卡片笔记只是共用这一份。
  // 注意：不能读 panel.noval.settings.ai，卡片笔记的设置里没有这个键。
  var board = findBoard(panel);
  var ai = board && board.settings && board.settings.ai;
  if (!ai) return { error: "没找到 AI 配置，请重载插件后再试。" };
  if (!ai.enabled) return { error: "AI 总开关没开：设置 → 画布 → AI → 启用 AI。" };
  var profile = null;
  if (opts.profileId && Array.isArray(ai.profiles)) {
    profile = ai.profiles.find(function (p) { return p && p.id === opts.profileId; }) || null;
  }
  // activeProfile 只接受一个参数，第二个参数会被忽略，所以按 id 取要自己找。
  if (!profile) profile = BoardBundle.activeProfile(ai);
  if (!profile || !profile.apiKey || !profile.model || !String(profile.baseUrl || "").trim()) {
    return { error: "还没配好模型：设置 → 画布 → AI → 添加模型配置，填接口地址、模型名和密钥。" };
  }
  return { profile: profile, opts: opts };
}

function findBoard(panel) {
  var host = panel && panel.hostView && panel.hostView.plugin;
  var fromHost = host && host.childPlugins && host.childPlugins[BOARD_ID];
  if (fromHost) return fromHost;
  var app = panel && panel.app;
  var main = app && app.plugins && app.plugins.plugins && app.plugins.plugins["noval"];
  return (main && main.childPlugins && main.childPlugins[BOARD_ID]) || null;
}

function friendlyError(err) {
  var msg = String((err && err.message) || err || "");
  if (/abort/i.test(msg)) return "请求超时了，稍后再试。";
  if (/401|invalid.*key|api key|unauthorized/i.test(msg)) return "密钥无效或已过期：设置 → 画布 → AI 里检查一下。";
  if (/402|insufficient|balance|quota|payment/i.test(msg)) return "额度用完了或账户欠费。";
  if (/404|model/i.test(msg)) return "模型名可能写错了：设置 → 画布 → AI 里核对一下。";
  if (/429/i.test(msg)) return "请求太频繁，被限流了，稍等再试。";
  return msg.slice(0, 120) || "请求失败";
}

async function requestCandidates(profile, card, vocab, options, exclude) {
  var provider = BoardBundle.createProvider(profile);
  // provider.complete(history, options)：第一个参数必须是消息数组，
  // 传单个对象会拿到空历史，模型什么都不会说。
  var res = await provider.complete(
    [{ role: "user", content: buildUserPrompt(card.body, vocab, options, exclude) }],
    {
      system: buildSystemPrompt(options, effectiveGranularity(options, vocab)),
      maxTokens: REQUEST_TOKENS,
      cache: false,
      // false 等价于不传：glm-5.3-flash 这类模型传 disabled 会直接 400
      thinking: false
    }
  );
  return parseCandidates(res.text || "");
}

/**
 * 取候选。
 * opts.force = true 时跳过缓存重新请求（「换一批」用），并把 exclude 里的词告诉模型。
 */
async function getCandidates(panel, card, vocab, options, profile, extra) {
  var key = hashBody(card.body);
  var force = !!(extra && extra.force);
  var exclude = (extra && extra.exclude) || [];
  if (!force) {
    var cached = cacheGet(options, key);
    if (cached) return { parsed: cached, fromCache: true };
  }
  var use = profile || (resolveAi(panel) || {}).profile;
  if (!use) throw new Error("没有可用的模型配置");
  var parsed = await requestCandidates(use, card, vocab, options, exclude);
  cacheSet(options, key, parsed);
  return { parsed: parsed, fromCache: false };
}

/* ---------------- 写回 ---------------- */

function cardSnippet(card) {
  return sampleOf(card.body || "");
}

async function writeTags(panel, card, labels) {
  var next = bodyWithTags(card.body, labels);
  if (next === String(card.body || "").replace(/\s+$/, "")) return false;
  var plugin = panel.noval;
  var write = typeof plugin.quietUpdateCard === "function"
    ? plugin.quietUpdateCard.bind(plugin)
    : plugin.updateCard.bind(plugin);
  var ok = await write(card, next);
  if (ok) card.body = next;
  return ok;
}

/* ---------------- 单卡：建议栏 / 自动拍板 ---------------- */


/**
 * 卡片 ⋯ →「AI 打标签」的统一入口：
 * - auto：直接拍板写入，不弹任何选择界面；
 * - suggest / manual：展开候选栏，一下点选。
 */
async function openTagBar(panel, cardEl, card) {
  if (!panel || !card) return;
  var ai = resolveAi(panel);
  if (ai.error) {
    new Notice2(ai.error);
    return;
  }
  var opts = ai.opts;
  if (opts.mode === "auto") {
    await autoTagCard(panel, card);
    return;
  }
  openSuggestBar(panel, cardEl, card, opts, ai.profile);
}

async function autoTagCard(panel, card) {
  var ai = resolveAi(panel);
  if (ai.error) {
    new Notice2(ai.error);
    return;
  }
  var opts = ai.opts;
  var vocab = collectVocab(panel.cards, opts.extraVocab);
  try {
    var got = await getCandidates(panel, card, vocab, opts, ai.profile);
    var shaped = shapeCandidates(got.parsed, vocab, card, opts);
    var pick = pickAuto(shaped.list);
    if (!pick) {
      new Notice2("AI 打标签：没有合适的已有标签；批量整理时会提议新建。");
      saveStore(panel);
      return;
    }
    var ok = await writeTags(panel, card, [pick.label]);
    saveStore(panel);
    if (ok) {
      new Notice2("AI 已打标：#" + pick.label);
      await panel.reloadCards();
    } else {
      new Notice2("AI 打标签：写入失败，请重试。");
    }
  } catch (err) {
    new Notice2("AI 打标签失败：" + friendlyError(err));
  }
}
function openSuggestBar(panel, cardEl, card, opts, profile) {
  var prev = cardEl.querySelector(":scope > .noval-aitag");
  if (prev) {
    prev.remove();
    return;
  }
  var bar = cardEl.createDiv({ cls: "noval-aitag" });
  // 网格视图里点卡片空白会打开详情卡片：建议栏内部的点击不能冒泡上去
  bar.addEventListener("click", function (ev) { ev.stopPropagation(); });

  var head = bar.createDiv({ cls: "noval-aitag-head" });
  head.createSpan({ cls: "noval-aitag-title", text: "AI 给了一组标签" });
  var closeBtn = head.createEl("button", { cls: "noval-aitag-close", text: "×" });
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("title", "关闭");

  var reasonEl = bar.createDiv({ cls: "noval-aitag-reason", text: "正在读这张卡片…" });
  var rowsEl = bar.createDiv({ cls: "noval-aitag-rows" });

  var addRow = bar.createDiv({ cls: "noval-aitag-add" });
  var addInput = addRow.createEl("input", { cls: "noval-aitag-input", type: "text" });
  addInput.placeholder = "自定义标签";
  var addBtn = addRow.createEl("button", { cls: "noval-aitag-addbtn", text: "添加" });
  addBtn.setAttribute("type", "button");

  var foot = bar.createDiv({ cls: "noval-aitag-foot" });
  var shuffleBtn = foot.createEl("button", { cls: "noval-aitag-shuffle", text: "换一批" });
  shuffleBtn.setAttribute("type", "button");
  shuffleBtn.setAttribute("title", "让 AI 换一组角度重新给");
  var applyBtn = foot.createEl("button", { cls: "noval-aitag-apply", text: "应用" });
  applyBtn.setAttribute("type", "button");
  foot.createDiv({ cls: "noval-aitag-grow" });
  var cancelBtn = foot.createEl("button", { cls: "noval-aitag-cancel", text: "取消" });
  cancelBtn.setAttribute("type", "button");

  var state = {
    list: [],
    selected: new Set(), // 记标签文字而不是下标：编辑或换一批之后不会错位
    vocab: [],
    busy: false,
    closed: false,
    editing: null // 正在改名的标签文字
  };

  function close() {
    if (state.closed) return;
    state.closed = true;
    bar.remove();
  }
  closeBtn.onclick = close;
  cancelBtn.onclick = close;

  bar.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !state.editing) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  });

  /* ---- 渲染候选行 ---- */
  function renderRows() {
    rowsEl.empty();
    if (!state.list.length) return;
    state.list.forEach(function (cand, idx) {
      var on = state.selected.has(cand.label);
      var row = rowsEl.createDiv({
        cls: "noval-aitag-row" + (on ? " is-on" : "") + (cand.isNew ? " is-fresh" : "")
      });

      if (state.editing === cand.label) {
        var input = row.createEl("input", { cls: "noval-aitag-edit", type: "text" });
        input.value = cand.label;
        input.placeholder = "回车确认";
        // 输入框自己的点击不能冒泡到行上，否则会触发选中切换、把输入框重画掉
        input.addEventListener("click", function (ev) { ev.stopPropagation(); });
        input.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
        var commit = function () {
          if (state.editing !== cand.label) return;
          var next = normalizeTag(input.value);
          state.editing = null;
          if (!next) {
            renderRows();
            return;
          }
          if (next !== cand.label) {
            var wasOn = state.selected.has(cand.label);
            state.selected.delete(cand.label);
            var dup = state.list.find(function (x) {
              return x !== cand && x.label.toLowerCase() === next.toLowerCase();
            });
            if (dup) {
              state.list = state.list.filter(function (x) { return x !== cand; });
              if (wasOn) state.selected.add(dup.label);
            } else {
              cand.label = next;
              cand.why = "你改的词";
              cand.edited = true;
              if (wasOn) state.selected.add(next);
            }
          }
          renderRows();
          renderFoot();
        };
        input.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            commit();
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            state.editing = null;
            renderRows();
          }
        });
        input.addEventListener("blur", commit);
        setTimeout(function () {
          try { input.focus(); input.select(); } catch (e) {}
        }, 0);
        return;
      }

      var chip = row.createEl("button", { cls: "noval-aitag-chip" + (cand.isNew ? " is-new" : "") });
      chip.setAttribute("type", "button");
      chip.setText(cand.label);
      if (cand.isNew && !cand.edited) {
        // 虚线框已经表示「词表里还没有」，这里只在悬停时补一句解释
        chip.setAttribute("title", "词表里还没有这个词");
      }
      row.createDiv({ cls: "noval-aitag-grow" });
      var editBtn = row.createEl("button", { cls: "noval-aitag-editbtn", text: "改" });
      editBtn.setAttribute("type", "button");
      editBtn.setAttribute("title", "改这个词");
      editBtn.onclick = function (ev) {
        ev.stopPropagation();
        state.editing = cand.label;
        renderRows();
      };
      row.onclick = function () {
        if (state.selected.has(cand.label)) state.selected.delete(cand.label);
        else state.selected.add(cand.label);
        renderRows();
        renderFoot();
      };
    });
  }

  function renderFoot() {
    var n = state.selected.size;
    applyBtn.setText(n ? "应用 " + n + " 个" : "应用");
    applyBtn.disabled = !n || state.busy;
    shuffleBtn.disabled = state.busy;
    addBtn.disabled = state.busy;
  }

  /* ---- 自己加一个 ---- */
  function addOwn() {
    var t = normalizeTag(addInput.value);
    if (!t) return;
    addInput.value = "";
    var dup = state.list.find(function (x) { return x.label.toLowerCase() === t.toLowerCase(); });
    if (dup) {
      state.selected.add(dup.label);
    } else {
      var known = state.vocab.some(function (v) { return v.label.toLowerCase() === t.toLowerCase(); });
      state.list.push({ label: t, why: "你自己加的", conf: 0, isNew: !known, edited: true });
      state.selected.add(t);
    }
    renderRows();
    renderFoot();
  }
  addBtn.onclick = addOwn;
  addInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      addOwn();
    }
  });

  /* ---- 换一批：跳过缓存，把已给出的词全部作为否决项 ---- */
  async function shuffle() {
    if (state.busy) return;
    state.busy = true;
    state.editing = null;
    shuffleBtn.setText("换…");
    renderFoot();
    reasonEl.setText("换一组角度，重新读这张卡片…");
    var exclude = state.list.map(function (c) { return c.label; });
    try {
      state.vocab = collectVocab(panel.cards, opts.extraVocab);
      var got = await getCandidates(panel, card, state.vocab, opts, profile, {
        force: true,
        exclude: exclude
      });
      if (state.closed) return;
      var shaped = shapeCandidates(got.parsed, state.vocab, card, opts);
      // 模型偶尔会重复给同一批词，这里把换过的词滤掉
      var fresh = shaped.list.filter(function (c) {
        return !exclude.some(function (x) {
          return sameFamily(x.toLowerCase(), c.label.toLowerCase());
        });
      });
      state.list = fresh.length ? fresh : shaped.list;
      state.selected.clear();
      if (!state.list.length) {
        reasonEl.setText("没列出合适的词：自己加一个，或者先不打。");
      } else {
        reasonEl.setText("");
      }
      renderRows();
      renderFoot();
      saveStore(panel);
    } catch (err) {
      if (state.closed) return;
      reasonEl.setText("换一批失败：" + friendlyError(err));
    } finally {
      state.busy = false;
      if (!state.closed) {
        shuffleBtn.setText("换一批");
        renderFoot();
      }
    }
  }
  shuffleBtn.onclick = shuffle;

  applyBtn.onclick = async function () {
    if (state.busy) return;
    var chosen = state.list.filter(function (c) { return state.selected.has(c.label); });
    if (!chosen.length) return;
    state.busy = true;
    applyBtn.setText("写入中…");
    renderFoot();
    var labels = chosen.map(function (c) { return c.label; });
    var rejected = state.list
      .filter(function (c) { return !state.selected.has(c.label); })
      .map(function (c) { return c.label; });
    try {
      var ok = await writeTags(panel, card, labels);
      if (ok) {
        addCase(panel, cardSnippet(card), labels.join("、"), rejected.join("、"));
        saveStore(panel);
        new Notice2("已打标签：" + labels.map(function (t) { return "#" + t; }).join(" "));
        close();
        // 重读文件：card.tags 是解析出来的，只改 body 不会让标签树和筛选立刻更新
        await panel.reloadCards();
      } else {
        new Notice2("没有写入：卡片可能已被修改，请重试。");
        state.busy = false;
        applyBtn.setText("应用");
        renderFoot();
      }
    } catch (err) {
      new Notice2("写入失败：" + friendlyError(err));
      state.busy = false;
      applyBtn.setText("应用");
      renderFoot();
    }
  };

  async function run() {
    state.busy = true;
    reasonEl.setText("正在读这张卡片…");
    renderFoot();
    try {
      state.vocab = collectVocab(panel.cards, opts.extraVocab);
      var got = await getCandidates(panel, card, state.vocab, opts, profile);
      if (state.closed) return;
      var shaped = shapeCandidates(got.parsed, state.vocab, card, opts);
      state.list = shaped.list;
      if (!state.list.length) {
        reasonEl.setText("没列出合适的词：自己加一个，或者先不打。");
        renderFoot();
        return;
      }
      // 一个都不预选：勾哪个由你决定，插件不替你点头。
      reasonEl.setText("");
      renderRows();
      renderFoot();
    } catch (err) {
      if (state.closed) return;
      reasonEl.setText("出错了：" + friendlyError(err));
      var retry = foot.createEl("button", { cls: "noval-aitag-retry", text: "重试" });
      retry.setAttribute("type", "button");
      retry.onclick = function () {
        retry.remove();
        run();
      };
    } finally {
      state.busy = false;
      // run() 开始时就把 busy 置真，renderFoot 会据此禁用按钮；
      // 请求结束必须再刷一次，否则按钮会一直灰着。
      if (!state.closed) renderFoot();
    }
  }

  renderFoot();
  run();
}

/* ---------------- 纠错：点卡片上的标签右键改标签 ---------------- */

function openTagFix(panel, card, tag, anchorEl) {
  if (!panel || !card || !tag) return;
  document.querySelectorAll(".noval-aitag-fix").forEach(function (el) { el.remove(); });
  var opts = readOptions(panel);
  var vocab = collectVocab(panel.cards, opts.extraVocab);
  var cardTags = new Set((card.tags || []).map(function (t) { return normalizeTag(t).toLowerCase(); }));

  var pop = document.body.createDiv({ cls: "noval-aitag-fix" });
  var rect = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
  pop.style.left = "12px";
  pop.style.top = "12px";
  pop.createDiv({ cls: "noval-aitag-fix-title", text: "把 #" + tag + " 改成：" });
  var chips = pop.createDiv({ cls: "noval-aitag-fix-chips" });
  var candidates = vocab.filter(function (v) { return v.count > 0 && !cardTags.has(v.label.toLowerCase()); }).slice(0, 12);
  if (!candidates.length) {
    chips.createSpan({ cls: "noval-aitag-fix-empty", text: "词表里暂时没有其它标签" });
  }
  candidates.forEach(function (v) {
    var b = chips.createEl("button", { cls: "noval-aitag-fix-chip", text: v.label });
    b.setAttribute("type", "button");
    b.onclick = function () { applyFix(v.label); };
  });
  var actions = pop.createDiv({ cls: "noval-aitag-fix-actions" });
  var removeBtn = actions.createEl("button", { cls: "noval-aitag-fix-remove", text: "移除这个标签" });
  removeBtn.setAttribute("type", "button");
  removeBtn.onclick = function () { applyFix(null); };
  var custom = actions.createDiv({ cls: "noval-aitag-fix-custom" });
  var input = custom.createEl("input", { cls: "noval-aitag-fix-input", type: "text", placeholder: "自己写一个…" });
  var customBtn = custom.createEl("button", { cls: "noval-aitag-fix-ok", text: "改" });
  customBtn.setAttribute("type", "button");
  customBtn.onclick = function () {
    var t = normalizeTag(input.value);
    if (!t) return;
    applyFix(t);
  };
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      customBtn.click();
    }
  });

  var busy = false;
  async function applyFix(newTag) {
    if (busy) return;
    busy = true;
    var next = replaceTagInBody(card.body, tag, newTag);
    if (next === String(card.body || "")) {
      close();
      return;
    }
    try {
      var ok = await panel.noval.quietUpdateCard(card, next);
      if (ok) {
        card.body = next;
        if (newTag) addCase(panel, cardSnippet(card), newTag, tag);
        saveStore(panel);
        new Notice2(newTag ? "已把 #" + tag + " 改成 #" + newTag : "已移除 #" + tag);
        await panel.reloadCards();
      } else {
        new Notice2("修改失败：卡片可能已被改动，请重试。");
      }
    } catch (err) {
      new Notice2("修改失败：" + friendlyError(err));
    }
    close();
  }

  function close() {
    pop.remove();
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onDocDown(ev) {
    if (!pop.contains(ev.target)) close();
  }
  function onKey(ev) {
    if (ev.key === "Escape") close();
  }
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onKey, true);

  if (rect) {
    var pw = 250;
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
    var top = rect.bottom + 6;
    if (top + 220 > window.innerHeight) top = Math.max(8, rect.top - 226);
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }
  input.focus();
}

/* ---------------- 批量：AI 全部打标 + 攒够建类 ---------------- */

async function openBatchTag(panel) {
  if (!panel) return;
  if (panel._aiBatchRunning) {
    new Notice2("批量打标正在进行中。");
    return;
  }
  var ai = resolveAi(panel);
  if (ai.error) {
    new Notice2(ai.error);
    return;
  }
  var opts = ai.opts;
  var targets = (panel.cards || []).filter(function (c) { return !(c.tags || []).length; });
  if (!targets.length) {
    new Notice2("没有无标签的卡片。");
    return;
  }
  panel._aiBatchRunning = true;
  var hostEl = panel.listWrap && panel.listWrap.parentElement;
  if (!hostEl) {
    panel._aiBatchRunning = false;
    new Notice2("面板还没准备好，稍后再试。");
    return;
  }
  // 必须挂在列表外面的稳定容器上：挂进筛选浮层（chipsEl）会被隐藏，
  // 挂进 listWrap 又会在每次重绘时被清空。
  var bar = hostEl.createDiv({ cls: "noval-aitag-batch" });
  hostEl.insertBefore(bar, panel.listWrap);
  var labelEl = bar.createDiv({ cls: "noval-aitag-batch-label", text: "AI 打标中 0/" + targets.length });
  var detailEl = bar.createDiv({ cls: "noval-aitag-batch-detail", text: "" });
  var cancelBtn = bar.createEl("button", { cls: "noval-aitag-batch-cancel", text: "取消" });
  cancelBtn.setAttribute("type", "button");

  var state = { cancelled: false, done: 0, skipped: 0, errors: 0 };
  var proposals = new Map(); // 新词 -> { why, cards: [] }
  cancelBtn.onclick = function () { state.cancelled = true; };

  var vocab = collectVocab(panel.cards, opts.extraVocab);
  try {
    for (var i = 0; i < targets.length; i++) {
      if (state.cancelled) break;
      var card = targets[i];
      labelEl.setText("AI 打标中 " + (i + 1) + "/" + targets.length);
      detailEl.setText(sampleOf(card.body));
      try {
        var got = await getCandidates(panel, card, vocab, opts, ai.profile);
        var shaped = shapeCandidates(got.parsed, vocab, card, opts);
        var pick = pickAuto(shaped.list);
        if (pick) {
          var ok = await writeTags(panel, card, [pick.label]);
          if (ok) state.done++;
          else state.errors++;
        } else {
          var fresh = shaped.list.find(function (c) { return c.isNew; });
          if (fresh) {
            addProposal(proposals, fresh, card);
          } else {
            state.skipped++;
          }
        }
      } catch (err) {
        state.errors++;
        detailEl.setText("出错：" + friendlyError(err));
      }
    }
    saveStore(panel);
    await panel.reloadCards();

    // 攒够建类：只有同主题卡片 >= BATCH_MIN_NEW 才提议新标签
    var split = splitProposals(proposals);
    var viable = split.viable;
    var dropped = split.dropped;

    if (state.cancelled) {
      finishBar("已取消：打标 " + state.done + " 张。");
      return;
    }
    if (!viable.length) {
      finishBar("完成：打标 " + state.done + " 张" +
        (dropped ? "；" + dropped + " 张的主题还不够 " + BATCH_MIN_NEW + " 张，先留着" : "") +
        (state.skipped ? "；" + state.skipped + " 张没找到合适标签" : "") +
        (state.errors ? "；" + state.errors + " 张出错" : "") + "。");
      return;
    }
    renderProposals(viable, dropped);
  } catch (err) {
    finishBar("批量打标出错：" + friendlyError(err));
  } finally {
    panel._aiBatchRunning = false;
  }

  function finishBar(text) {
    labelEl.setText(text);
    detailEl.setText("");
    cancelBtn.setText("关闭");
    cancelBtn.onclick = function () { bar.remove(); };
  }

  function renderProposals(viable, dropped) {
    labelEl.setText("完成：打标 " + state.done + " 张。下面这些标签还太孤单，攒够 3 张才建议新建：");
    detailEl.setText("");
    cancelBtn.remove();
    viable.forEach(function (entry) {
      var label = entry[0], info = entry[1];
      var row = bar.createDiv({ cls: "noval-aitag-batch-prop" });
      row.createSpan({
        cls: "noval-aitag-batch-prop-text",
        text: "「" + label + "」" + info.cards.length + " 张 · " + (info.why || "")
      });
      var makeBtn = row.createEl("button", { cls: "noval-aitag-batch-make", text: "建类并打上" });
      makeBtn.setAttribute("type", "button");
      var skipBtn = row.createEl("button", { cls: "noval-aitag-batch-skip", text: "先不建" });
      skipBtn.setAttribute("type", "button");
      makeBtn.onclick = async function () {
        makeBtn.disabled = true;
        skipBtn.disabled = true;
        makeBtn.setText("写入中…");
        var n = 0;
        for (var c of info.cards) {
          var ok = await writeTags(panel, c, [label]);
          if (ok) n++;
        }
        saveStore(panel);
        await panel.reloadCards();
        row.setText("已新建 #" + label + "，打上 " + n + " 张。");
      };
      skipBtn.onclick = function () { row.remove(); };
    });
    if (dropped) {
      bar.createDiv({ cls: "noval-aitag-batch-note", text: "另有 " + dropped + " 张的主题还不够 " + BATCH_MIN_NEW + " 张，先留着不建类。" });
    }
    var closeBtn = bar.createEl("button", { cls: "noval-aitag-batch-cancel", text: "关闭" });
    closeBtn.setAttribute("type", "button");
    closeBtn.onclick = function () { bar.remove(); };
  }
}

/* ---------------- 标签健康巡检 ---------------- */

/** 标签健康统计：数量、孤儿、疑似近义、平均复用率。纯函数，便于单独验证。 */
function tagStats(cards) {
  var counts = new Map();
  for (var card of cards || []) {
    for (var tag of card.tags || []) {
      var label = normalizeTag(tag);
      if (!label) continue;
      var key = label.toLowerCase();
      var slot = counts.get(key);
      if (!slot) {
        slot = { label: label, count: 0 };
        counts.set(key, slot);
      }
      slot.count++;
    }
  }
  var all = Array.from(counts.values()).sort(function (a, b) {
    return b.count - a.count || a.label.localeCompare(b.label, "zh");
  });
  // 孤儿 = 只用过 1 次。用过 2 次的标签已经算「有复用」，不该催着清掉。
  var orphans = all.filter(function (t) { return t.count <= 1; });
  var pairs = [];
  for (var i = 0; i < all.length; i++) {
    for (var j = i + 1; j < all.length; j++) {
      if (sameFamily(all[i].label.toLowerCase(), all[j].label.toLowerCase())) {
        pairs.push([all[i], all[j]]);
      }
    }
  }
  var instances = all.reduce(function (s, t) { return s + t.count; }, 0);
  var avg = all.length ? Number((instances / all.length).toFixed(1)) : 0;
  return { all: all, orphans: orphans, pairs: pairs, instances: instances, avg: avg };
}

function openTagHealth(panel) {
  if (!panel) return;
  var cards = panel.cards || [];
  var stats = tagStats(cards);
  var all = stats.all;
  var orphans = stats.orphans;
  var pairs = stats.pairs;
  var instances = stats.instances;
  var avg = stats.avg.toFixed(1);

  var modal = new Modal2(panel.app);
  modal.titleEl.setText("标签健康");
  var box = modal.contentEl.createDiv({ cls: "noval-taghealth" });
  box.createDiv({
    cls: "noval-taghealth-stats",
    text: "共 " + all.length + " 个标签 · " + instances + " 处引用 · 平均每个标签 " + avg + " 张卡"
  });

  if (!all.length) {
    box.createDiv({ cls: "noval-taghealth-empty", text: "还没有任何标签。在卡片 ⋯ 里用「AI 打标签」，或在「无标签」里批量整理。" });
  }

  async function applyAcross(matchTag, transform) {
    var writes = 0;
    for (var c of cards.slice()) {
      var has = (c.tags || []).some(function (t) { return normalizeTag(t).toLowerCase() === matchTag; });
      if (!has) continue;
      var next = transform(String(c.body == null ? "" : c.body));
      if (next === String(c.body == null ? "" : c.body)) continue;
      var ok = await panel.noval.quietUpdateCard(c, next);
      if (ok) {
        c.body = next;
        writes++;
      }
    }
    await panel.reloadCards();
    return writes;
  }

  if (pairs.length) {
    box.createDiv({ cls: "noval-taghealth-cap", text: "疑似近义（建议合并，保留用得多的那个）" });
    pairs.forEach(function (pair) {
      var a = pair[0], b = pair[1];
      var keep = a.count >= b.count ? a : b;
      var drop = a.count >= b.count ? b : a;
      var row = box.createDiv({ cls: "noval-taghealth-row" });
      row.createSpan({ cls: "noval-taghealth-name", text: "#" + drop.label + " (" + drop.count + ") → #" + keep.label + " (" + keep.count + ")" });
      var btn = row.createEl("button", { cls: "noval-taghealth-btn", text: "合并" });
      btn.setAttribute("type", "button");
      btn.onclick = async function () {
        btn.disabled = true;
        btn.setText("合并中…");
        var n = await applyAcross(drop.label.toLowerCase(), function (body) {
          return replaceTagInBody(body, drop.label, keep.label);
        });
        new Notice2("已把 #" + drop.label + " 合并进 #" + keep.label + "（" + n + " 张卡）。");
        modal.close();
        openTagHealth(panel);
      };
    });
  }

  if (orphans.length) {
    box.createDiv({ cls: "noval-taghealth-cap", text: "孤儿标签（只用过 1 次，建议合并或删除）" });
    orphans.forEach(function (t) {
      var row = box.createDiv({ cls: "noval-taghealth-row" });
      row.createSpan({ cls: "noval-taghealth-name", text: "#" + t.label + " (" + t.count + " 张)" });
      var delBtn = row.createEl("button", { cls: "noval-taghealth-btn is-danger", text: "删除" });
      delBtn.setAttribute("type", "button");
      delBtn.onclick = async function () {
        delBtn.disabled = true;
        delBtn.setText("删除中…");
        var n = await applyAcross(t.label.toLowerCase(), function (body) {
          return removeTagFromBody(body, t.label);
        });
        new Notice2("已从 " + n + " 张卡移除 #" + t.label + "。");
        modal.close();
        openTagHealth(panel);
      };
      var mergeBtn = row.createEl("button", { cls: "noval-taghealth-btn", text: "合并到…" });
      mergeBtn.setAttribute("type", "button");
      mergeBtn.onclick = function () {
        if (row.querySelector(".noval-taghealth-pick")) return;
        var pick = row.createDiv({ cls: "noval-taghealth-pick" });
        var targets = all.filter(function (v) { return v.label.toLowerCase() !== t.label.toLowerCase(); }).slice(0, 10);
        if (!targets.length) {
          pick.setText("没有其它标签可合并。");
          return;
        }
        targets.forEach(function (v) {
          var b = pick.createEl("button", { cls: "noval-taghealth-btn", text: "#" + v.label });
          b.setAttribute("type", "button");
          b.onclick = async function () {
            mergeBtn.disabled = true;
            mergeBtn.setText("合并中…");
            var n = await applyAcross(t.label.toLowerCase(), function (body) {
              return replaceTagInBody(body, t.label, v.label);
            });
            new Notice2("已把 #" + t.label + " 合并进 #" + v.label + "（" + n + " 张卡）。");
            modal.close();
            openTagHealth(panel);
          };
        });
      };
    });
  }

  if (all.length && !pairs.length && !orphans.length) {
    box.createDiv({ cls: "noval-taghealth-empty", text: "很健康：没有孤儿标签，也没有疑似近义。" });
  }
  modal.open();
}

module.exports = {
  AI_TAG_DEFAULTS: AI_TAG_DEFAULTS,
  readOptions: readOptions,
  collectVocab: collectVocab,
  effectiveGranularity: effectiveGranularity,
  addCase: addCase,
  fewShotLines: fewShotLines,
  cacheGet: cacheGet,
  cacheSet: cacheSet,
  normalizeTag: normalizeTag,
  sameFamily: sameFamily,
  hashBody: hashBody,
  bodyWithTags: bodyWithTags,
  replaceTagInBody: replaceTagInBody,
  removeTagFromBody: removeTagFromBody,
  containsTag: containsTag,
  parseCandidates: parseCandidates,
  shapeCandidates: shapeCandidates,
  CAND_CHOICES: CAND_CHOICES,
  pickAuto: pickAuto,
  addProposal: addProposal,
  splitProposals: splitProposals,
  tagStats: tagStats,
  buildSystemPrompt: buildSystemPrompt,
  buildUserPrompt: buildUserPrompt,
  openTagBar: openTagBar,
  openTagFix: openTagFix,
  openBatchTag: openBatchTag,
  openTagHealth: openTagHealth
};
