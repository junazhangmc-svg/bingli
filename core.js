"use strict";
/* ==========================================================================
 * core.js — 纯函数与小工具。除 toast/setFab/download 外都不碰 DOM。
 * 依赖 data.js（IND / GRP / UNIT_ALIAS / UNIT_CONV / GENERIC_TITLES）。
 * ========================================================================== */

/* ---- 转义。所有用户提供的内容进入模板字符串之前都必须过这里 ---- */
function escapeHtml(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ==========================================================================
 * 日期
 * 算术一律在 UTC 做（new Date(iso+"T00:00:00Z")），
 * 但「今天」必须用本地 getter 取 —— toISOString() 在东八区早上 8 点前会给出昨天。
 * ========================================================================== */
function today(){
  var d = new Date();
  function p(n){ return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function addDays(iso, n){
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso, n){
  var d = new Date(iso + "T00:00:00Z");
  var day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  /* 1 月 31 日加 1 个月应落在 2 月末，而不是溢出到 3 月 */
  var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b){
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}
function isDate(s){ return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

/* 把各种写法的日期收敛成 YYYY-MM-DD，认不出就返回 "" */
function normDate(s){
  if (!s) return "";
  s = String(s).trim();
  var m = s.match(/^(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/);
  if (!m) return "";
  var y = m[1], mo = m[2], d = m[3];
  if (mo.length < 2) mo = "0" + mo;
  if (d.length < 2) d = "0" + d;
  var iso = y + "-" + mo + "-" + d;
  return isDate(iso) && Number(mo) >= 1 && Number(mo) <= 12
                     && Number(d) >= 1 && Number(d) <= 31 ? iso : "";
}

/* ==========================================================================
 * 复查建议 → 日期
 * 飞牛原版有个真 bug：用本地时间构造、用 UTC 输出，东八区会差一天。
 * 这里改成走 addDays / addMonths，不碰时区。
 * 返回 {due, basis}；basis 是判断依据，界面上要显示出来让人能改。
 * ========================================================================== */
function recheckDate(baseDate, text){
  var base = normDate(baseDate) || today();
  var s = String(text || "");
  var m;
  if ((m = s.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/))) {
    var iso = normDate(m[1] + "-" + m[2] + "-" + m[3]);
    if (iso) return { due: iso, basis: "报告里写了明确日期：" + m[0] };
  }
  if ((m = s.match(/(\d{1,2})\s*(?:个)?\s*月(?:后|内|复查|随访)?/)))
    return { due: addMonths(base, Number(m[1])), basis: "按「" + m[0] + "」从 " + base + " 推算" };
  if ((m = s.match(/(\d{1,2})\s*(?:个)?\s*周(?:后|内)?/)))
    return { due: addDays(base, Number(m[1]) * 7), basis: "按「" + m[0] + "」从 " + base + " 推算" };
  if ((m = s.match(/(\d{1,3})\s*天(?:后|内)?/)))
    return { due: addDays(base, Number(m[1])), basis: "按「" + m[0] + "」从 " + base + " 推算" };
  if (/半年/.test(s))  return { due: addMonths(base, 6),  basis: "按「半年」从 " + base + " 推算" };
  if (/一年|1年/.test(s)) return { due: addMonths(base, 12), basis: "按「一年」从 " + base + " 推算" };
  return { due: addMonths(base, 3), basis: "报告没写明间隔，默认按 3 个月推算 —— 这只是猜的，请自行核对" };
}

/* ==========================================================================
 * 指标查找与归一化
 * ========================================================================== */

/* 化验单上常见的操作性后缀。医院爱写「促甲状腺激素(TSH)测定」，
 * 剥掉括号后剩「促甲状腺激素测定」，多这两个字就对不上字典了。
 *
 * 只剥纯粹表示「做了个检查」的词。刻意不剥的：
 *   浓度 —— 平均血红蛋白浓度(MCHC) 剥完会变成 平均血红蛋白(MCH)，两个不同指标
 *   含量 —— 同上
 *   定性 / 定量 —— 有些项目定性和定量是两回事，不能合并 */
var MEASURE_SUFFIX = /(测定值|测定|检测|检查|试验)$/;

/* 压缩成匹配键：NFKC → 小写 → 去括号内容 → 去空白 → 去标点 → 去操作性后缀 */
function compactKey(v){
  var s = String(v == null ? "" : v)
    .normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/[（(][^（()）]*[）)]/g, "")   // 逐层剥，能处理 脂蛋白(a)(Lp(a)) 这种嵌套
    .replace(/[（(][^（()）]*[）)]/g, "")
    .replace(/[*＊#]/g, "")                 // 化验单上标异常/自费的星号
    .replace(/\s+/g, "")
    .replace(/[：:，,。.;；、_\-]/g, "")
    .replace(/[＋]/g, "+")
    .trim();
  /* 后缀可能叠加（「…测定检测」这种也见过），剥到不再变化为止 */
  for (var i = 0; i < 3 && MEASURE_SUFFIX.test(s); i++) s = s.replace(MEASURE_SUFFIX, "");
  return s;
}

/* AI 给的键要保留括号 —— 「血流变(高切/低切)」「血糖(空腹/餐后)」括号里是
 * 指标本体不是修饰，剥掉会把两条不同的趋势线悄悄并成一条。 */
function compactKeyKeepParen(v){
  return String(v == null ? "" : v)
    .normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
    .replace(/[：:，,。.;；、_\-]/g, "")
    .replace(/[＋]/g, "+")
    .trim();
}

/* 别名索引，首次调用时建好缓存 */
var _aliasIdx = null;
function aliasIndex(){
  if (_aliasIdx) return _aliasIdx;
  _aliasIdx = {};
  for (var i = 0; i < IND.length; i++) {
    var ind = IND[i];
    var names = [ind.n].concat(ind.alias || []);
    for (var j = 0; j < names.length; j++) {
      var key = compactKey(names[j]);
      if (!key) continue;
      /* 先登记的赢：IND 里靠前的条目更常用 */
      if (!(key in _aliasIdx)) _aliasIdx[key] = ind.k;
    }
  }
  return _aliasIdx;
}

var _byK = null;
function indByKey(k){
  if (!_byK) { _byK = {}; for (var i = 0; i < IND.length; i++) _byK[IND[i].k] = IND[i]; }
  return _byK[k] || null;
}

/* 单位归一化 */
function normUnit(u){
  if (u == null) return "";
  var s = String(u).normalize("NFKC").trim().replace(/／/g, "/").replace(/µ/g, "μ");
  if (!s) return "";
  /* 别名表里同时收了 "10*9/l" 和 "×10^9/l" 两种写法，所以要在替换乘号
     之前先查一次 —— 先替换会把 "10*9/L" 变成表里没有的 "10×9/L"。 */
  var hit = UNIT_ALIAS[s.toLowerCase()];
  if (hit) return hit;
  var sub = s.replace(/[xX*]/g, "×");
  hit = UNIT_ALIAS[sub.toLowerCase()];
  return hit || sub;
}

/* 单位换算。返回 {val, unit, converted} —— 换不了就原样返回。 */
function convUnit(k, val, unit){
  var u = normUnit(unit);
  var n = parseFloat(val);
  var table = UNIT_CONV[k];
  if (!table || !isFinite(n) || !u) return { val: val, unit: u, converted: false };
  var rule = table[u];
  if (!rule) return { val: val, unit: u, converted: false };
  var out = n * rule.f;
  /* 保留 4 位有效数字，避免 2.5900000000000003 这种 */
  return { val: String(parseFloat(out.toPrecision(4))), unit: rule.to, converted: true };
}

/* ==========================================================================
 * 匹配一条观测值到字典。
 * 打分起点 55，按信号加减；返回 {k, conf, why}。
 * k 为 null 表示没匹配上 —— 调用方要落成 "x:xxx" 而不是丢掉。
 * ========================================================================== */
function matchIndicator(obs){
  var name = (obs && (obs.normalizedName || obs.itemName || obs.name)) || "";
  var unit = normUnit(obs && obs.unit);
  var sec  = (obs && (obs.sectionName || obs.sec)) || "";
  var key  = compactKey(name);
  if (!key) return { k: null, conf: 0, why: "没有项目名" };

  /* 同名不同物先消歧。分不清就返回 null 交人工确认 ——
     在这里猜错的代价（把甲状腺球蛋白记成甘油三酯）远大于让人多点一下。 */
  if (AMBIG[key]) {
    var cands = AMBIG[key].map(function(c){
      var s = 0;
      if (unit && (c.units || []).some(function(x){ return normUnit(x) === unit; })) s += 40;
      if (sec  && (c.hints || []).some(function(h){ return sec.indexOf(h) >= 0; })) s += 30;
      return { k: c.k, s: s };
    }).sort(function(a, b){ return b.s - a.s; });
    if (cands[0].s === 0 || (cands[1] && cands[0].s === cands[1].s))
      return { k: null, conf: 0,
               why: "「" + name + "」在不同科室指不同的东西（" +
                    AMBIG[key].map(function(c){
                      var i2 = indByKey(c.k); return i2 ? i2.n : c.k; }).join(" / ") +
                    "），单位和小节都没给出线索，请人工指定" };
    return { k: cands[0].k, conf: Math.min(0.95, 0.55 + cands[0].s / 100),
             why: "按单位与小节从同名项中选定" };
  }

  var k = aliasIndex()[key];
  if (!k) return { k: null, conf: 0, why: "字典里没有这个名字" };

  var ind = indByKey(k);
  var score = 55, why = [];

  if (unit) {
    var okUnit = (ind.units || []).some(function(x){ return normUnit(x) === unit; });
    if (okUnit) { score += 25; why.push("单位相符"); }
    else { score -= 55; why.push("单位不符（" + unit + " 不在 " + (ind.units || []).join("/") + " 里）"); }
  }
  if (sec) {
    var hit = (ind.hints || []).some(function(h){ return sec.indexOf(h) >= 0; });
    if (hit) { score += 15; why.push("报告小节相符"); }
  }
  /* 尿里的葡萄糖不是空腹血糖，尿酸也不是尿里量出来的那个 */
  if (/尿/.test(sec) || /尿/.test(name)) {
    if (k === "glucose_fasting") { score -= 80; why.push("这是尿里的项目，不是空腹血糖"); }
    if (k === "renal_uric_acid" && !/血/.test(name)) { score -= 35; why.push("疑似尿中项目"); }
  }
  score = Math.max(0, Math.min(100, score));
  return { k: score >= 40 ? k : null, conf: score / 100,
           why: why.length ? why.join("、") : "按名称匹配" };
}

/* ==========================================================================
 * 判读。ind 缺少 min/max/sel 时返回 null —— 只显示数值，不下结论。
 * ±15% 带：超标但在 15% 以内算「偏离」，超出算「超标」；
 * hard 存在时用它代替 1.15 倍（酶类要 3 倍上限才算数）。
 * ========================================================================== */
function judge(ind, v){
  if (!ind || v == null || v === "") return null;
  if (ind.sel) {
    if (!ind.ok) return null;
    return ind.ok.indexOf(v) >= 0
      ? { lv:"good", txt:v }
      : { lv:"bad",  txt:v };
  }
  var x = parseFloat(v);
  if (!isFinite(x)) return null;
  var hi = ind.max, lo = ind.min, hard = ind.hard;
  if (hi == null && lo == null) return null;
  var lv = "good";
  if (hi != null && x > hi) {
    if (hard != null) lv = x > hard ? "bad" : "warn";
    else lv = x > hi * 1.15 ? "bad" : "warn";
  }
  if (lo != null && x < lo) lv = x < lo * 0.85 ? "bad" : "warn";
  return { lv: lv, txt: String(parseFloat(v)) };
}

/* 把个人目标覆盖在字典条目上。targets 形如 {lipid_ldl_c:{max:1.8,t:"< 1.8",w:"…"}} */
function withTarget(ind, targets){
  if (!ind) return ind;
  var o = targets && targets[ind.k];
  if (!o) return ind;
  var out = {}, key;
  for (key in ind) if (Object.prototype.hasOwnProperty.call(ind, key)) out[key] = ind[key];
  for (key in o)   if (Object.prototype.hasOwnProperty.call(o, key))   out[key] = o[key];
  out._custom = true;
  return out;
}

/* ==========================================================================
 * 异常标记
 * 只认报告上印出来的箭头和「偏高/偏低」字样，绝不从参考区间反推 ——
 * 反推会把「参考区间本身抄错」的错误放大成「结论错误」。
 * ========================================================================== */
function flagFromText(text){
  var s = String(text || "");
  if (/[↑▲⬆]|偏高|升高|增高|\bH\b/.test(s)) return "high";
  if (/[↓▼⬇]|偏低|降低|减低|\bL\b/.test(s)) return "low";
  if (/阳性|异常|\*/.test(s)) return "abnormal";
  return null;
}

/* 一致性检查：模型说 normal，但它自己抄下来的数值落在它自己抄下来的区间外。
 * 这种自相矛盾必须让人看一眼。 */
function flagConflict(obs){
  if (!obs) return null;
  var v = parseFloat(obs.val != null ? obs.val : obs.numericValue);
  if (!isFinite(v)) return null;
  var lo = obs.refLow  != null ? parseFloat(obs.refLow)  : NaN;
  var hi = obs.refHigh != null ? parseFloat(obs.refHigh) : NaN;
  var outside = (isFinite(lo) && v < lo) || (isFinite(hi) && v > hi);
  if (outside && obs.flag === "normal") return "标为正常，但数值在它自己给出的参考区间之外";
  if (!outside && (obs.flag === "high" || obs.flag === "low") && (isFinite(lo) || isFinite(hi)))
    return "标为异常，但数值在参考区间之内";
  return null;
}

/* ==========================================================================
 * 标题
 * ========================================================================== */
function isGenericTitle(t){
  var s = compactKey(t);
  if (!s || s.length < 3) return true;
  for (var i = 0; i < GENERIC_TITLES.length; i++)
    if (compactKey(GENERIC_TITLES[i]) === s) return true;
  return false;
}

function typeLabel(v){
  for (var i = 0; i < REPORT_TYPES.length; i++)
    if (REPORT_TYPES[i].v === v) return REPORT_TYPES[i].n;
  return "其他";
}
function normType(v){
  if (!v) return "other";
  return TYPE_ALIAS[String(v).toLowerCase()] || TYPE_ALIAS[String(v)] || "other";
}

/* 泛标题时按类型 + 部位 + 科室合成一个有信息量的标题 */
function makeTitle(rec){
  if (rec.title && !isGenericTitle(rec.title)) return rec.title;
  var part = (rec.bodyParts && rec.bodyParts[0] &&
              (rec.bodyParts[0].name || rec.bodyParts[0])) || "";
  var t = normType(rec.type);
  if (!part) {
    for (var i = 0; i < REPORT_TYPES.length; i++)
      if (REPORT_TYPES[i].v === t && REPORT_TYPES[i].bodyFallback)
        part = REPORT_TYPES[i].bodyFallback;
  }
  if (t === "outpatient" || t === "inpatient")
    return (rec.dept || part || "") + typeLabel(t) + "记录";
  return (part || rec.dept || "") + typeLabel(t) + "报告";
}

/* ==========================================================================
 * 用药区间查询
 * stop 为 null / "" 表示还在吃。边界一律闭区间：当天开始、当天停止都算在吃。
 * ========================================================================== */
function medsActiveOn(meds, date){
  var d = normDate(date);
  if (!d) return [];
  return (meds || []).filter(function(m){
    if (!m || !normDate(m.start)) return false;
    if (m.start > d) return false;
    if (m.stop && normDate(m.stop) && m.stop < d) return false;
    return true;
  });
}
function medsOverlapping(meds, from, to){
  var a = normDate(from), b = normDate(to);
  if (!a || !b) return [];
  return (meds || []).filter(function(m){
    if (!m || !normDate(m.start)) return false;
    if (m.start > b) return false;
    if (m.stop && normDate(m.stop) && m.stop < a) return false;
    return true;
  });
}
function medLabel(m){
  var bits = [m.name];
  if (m.dose) bits.push(m.dose);
  if (m.freq) bits.push(m.freq);
  return bits.join(" ");
}

/* ==========================================================================
 * 记录检索
 * records 恒按 date 倒序（save 时排好）。同日多条时按 updatedAt 取新。
 * ========================================================================== */
function lastWith(records, k, beforeDate){
  var best = null;
  for (var i = 0; i < (records || []).length; i++) {
    var r = records[i];
    if (beforeDate && r.date >= beforeDate) continue;
    if (!r.v || r.v[k] == null || r.v[k] === "") continue;
    if (!best || r.date > best.date ||
        (r.date === best.date && (r.updatedAt || "") > (best.updatedAt || ""))) {
      best = r;
    }
  }
  return best ? { date: best.date, val: best.v[k], id: best.id } : null;
}

function groupLastDate(records, g){
  var keys = IND.filter(function(i){ return i.g === g; }).map(function(i){ return i.k; });
  for (var i = 0; i < (records || []).length; i++) {
    var r = records[i];
    if (!r.v) continue;
    for (var j = 0; j < keys.length; j++)
      if (r.v[keys[j]] != null && r.v[keys[j]] !== "") return r.date;
  }
  return null;
}

/* g 组的到期情况。days:0 的组（不定期）返回 state:"none"。 */
function dueInfo(records, g){
  var grp = GRP[g];
  if (!grp || !grp.days) return { last: groupLastDate(records, g), due: null, left: null, state: "none" };
  var last = groupLastDate(records, g);
  if (!last) return { last: null, due: today(), left: 0, state: "over" };
  var due = addDays(last, grp.days);
  var left = daysBetween(today(), due);
  return { last: last, due: due, left: left,
           state: left < 0 ? "over" : (left <= 21 ? "soon" : "ok") };
}

/* 某疾病相关的全部记录，最新在前 */
function recordsForDiseases(records, disIds){
  if (!disIds || !disIds.length) return (records || []).slice();
  return (records || []).filter(function(r){
    var d = r.dis || [];
    for (var i = 0; i < disIds.length; i++) if (d.indexOf(disIds[i]) >= 0) return true;
    return false;
  });
}

/* 多个疾病的 keyInd 并集，去重，保持首次出现的顺序 */
function keyIndUnion(diseases, disIds){
  var out = [], seen = {};
  for (var i = 0; i < (disIds || []).length; i++) {
    var dis = null;
    for (var j = 0; j < (diseases || []).length; j++)
      if (diseases[j].id === disIds[i]) dis = diseases[j];
    if (!dis) continue;
    for (var m = 0; m < (dis.keyInd || []).length; m++) {
      var k = dis.keyInd[m];
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    }
  }
  return out;
}

/* ==========================================================================
 * 疾病标签 —— 第一层：确定性规则。即时、免费、永远跑。
 * 返回 {disId: 命中原因}
 * ========================================================================== */
function suggestDiseases(rec, diseases){
  var out = {};
  var text = [rec.title, rec.dx, rec.impression, rec.findings, rec.summary,
              rec.recommendation, rec.note].filter(Boolean).join(" ");
  var vkeys = rec.v ? Object.keys(rec.v).filter(function(k){
                        return rec.v[k] != null && rec.v[k] !== ""; }) : [];
  for (var i = 0; i < (diseases || []).length; i++) {
    var d = diseases[i];
    var hits = [];
    for (var j = 0; j < (d.keyInd || []).length; j++)
      if (vkeys.indexOf(d.keyInd[j]) >= 0) {
        var ind = indByKey(d.keyInd[j]);
        hits.push("查了" + (ind ? ind.n : d.keyInd[j]));
        break;
      }
    for (var m = 0; m < (d.keywords || []).length; m++)
      if (text.indexOf(d.keywords[m]) >= 0) { hits.push("提到「" + d.keywords[m] + "」"); break; }
    if (hits.length) out[d.id] = hits.join("；");
  }
  return out;
}

/* ==========================================================================
 * mdLite —— Markdown 的极小子集。先转义再注入标签，所以对注入是安全的。
 * ========================================================================== */
function mdLite(src){
  var lines = String(src || "").split(/\r?\n/);
  var out = [], inList = false;
  function closeList(){ if (inList) { out.push("</ul>"); inList = false; } }
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var s = escapeHtml(raw.trim());
    if (!s) { closeList(); continue; }
    var h = s.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push("<h4>" + inline(h[2]) + "</h4>"); continue; }
    var li = s.match(/^(?:[-*]|\d+[.、])\s+(.*)$/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + inline(li[1]) + "</li>");
      continue;
    }
    closeList();
    out.push("<p>" + inline(s) + "</p>");
  }
  closeList();
  return out.join("");
  function inline(t){
    return t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
            .replace(/`([^`]+?)`/g, "<code>$1</code>");
  }
}

/* ==========================================================================
 * 浏览器专用小工具（Node 里不会被调用）
 * ========================================================================== */
function download(name, data, mime){
  var blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/plain;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
}

var _toastTimer = null;
function toast(msg){
  var el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function(){ el.classList.remove("show"); }, 2600);
}

var _fabFn = null;
function setFab(label, fn){
  var bar = document.getElementById("fab");
  var btn = document.getElementById("fab-btn");
  if (!bar || !btn) return;
  if (!label) { bar.hidden = true; _fabFn = null; return; }
  bar.hidden = false;
  btn.textContent = label;
  _fabFn = fn;
  btn.onclick = function(){ if (_fabFn) _fabFn(); };
}

function fmtBytes(n){
  if (!isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    escapeHtml, today, addDays, addMonths, daysBetween, isDate, normDate,
    recheckDate, compactKey, compactKeyKeepParen, aliasIndex, indByKey,
    normUnit, convUnit, matchIndicator, judge, withTarget,
    flagFromText, flagConflict, isGenericTitle, typeLabel, normType, makeTitle,
    medsActiveOn, medsOverlapping, medLabel,
    lastWith, groupLastDate, dueInfo, recordsForDiseases, keyIndUnion,
    suggestDiseases, mdLite, fmtBytes
  };
}
