"use strict";
/* ==========================================================================
 * ai.js — AI 分析
 *
 * 走 DeepSeek 的文本接口直连，不经代理：它支持跨域，域名在大陆，
 * 上一个应用已经验证过这条路是通的。代价是密钥存在手机的 localStorage 里 ——
 * 那是按源按设备的存储，没人能远程读，真实暴露面是手机本身丢了。
 *
 * 这个应用相对上一个多出来的能力，是把「指标」和「当时在吃什么药」
 * 放在一起给模型看。指标的变化只有放在用药背景里才有意义 ——
 * 「LDL 从 1.30 涨到 4.20」单看是一句废话，
 * 「停他汀 4 个月后 LDL 从 1.30 涨到 4.20」才是信息。
 *
 * 护栏原样保留：不开药、不给剂量、不建议加减停药、不下诊断。
 * ========================================================================== */

var DS_API   = "https://api.deepseek.com/chat/completions";
var DS_MODEL = "deepseek-reasoner";
var AI_MAX_CHARS = 16000;      // 上下文预算。可以调高，但必须有上限，成本要有界。
var AI_TIMEOUT   = 120000;

var aiBusy = false;

/* ---- 密钥与背景 ---- */
function setDsKey(){
  var cur = lsGet(LS.dsKey);
  var v = prompt(
    "填入 DeepSeek 的 API 密钥（以 sk- 开头）。\n\n" +
    "去 platform.deepseek.com 注册后在「API keys」里创建。\n" +
    "密钥只存在这台手机上，只会发给 DeepSeek 自己的接口。\n\n" +
    "留空并确定 = 删除已保存的密钥。",
    cur ? "（已保存，留空可删除）" : "");
  if (v === null) return;
  v = v.trim();
  if (v.indexOf("（已保存") === 0) return;
  if (v === "") { lsSet(LS.dsKey, ""); toast("已删除密钥"); render(); return; }
  if (!/^sk-[A-Za-z0-9_\-]{10,}$/.test(v)) {
    alert("这看起来不像 DeepSeek 的密钥。\n正确的形式是 sk- 开头加一串字母数字。");
    return;
  }
  lsSet(LS.dsKey, v);
  toast("已保存");
  render();
}

function setBg(){
  var v = prompt(
    "简单描述一下你的情况，AI 分析时会带上。\n" +
    "例如：男，34 岁，2023 年查出脂肪肝，家族有早发冠心病史。\n\n" +
    "这段文字只存在这台手机上。不要写身份证号、电话、住址。",
    lsGet(LS.bg));
  if (v === null) return;
  lsSet(LS.bg, v.trim());
  toast("已保存");
  render();
}

function aiReady(){ return !!lsGet(LS.dsKey); }

/* ==========================================================================
 * 上下文构造
 * ========================================================================== */

/* 一条记录的文本形式。带上目标值和程序算好的判读结论 ——
 * 让模型再算一遍既浪费 token 又可能算错。 */
function recText(r, isLatest){
  var lines = ["【" + r.date + "】" + (r.title || "") +
               (isLatest ? "　← 最新一次" : "")];
  var meta = [typeLabel(r.type), r.hospital, r.dept].filter(Boolean).join(" · ");
  if (meta) lines.push("  " + meta);
  if (r.dx) lines.push("  临床诊断：" + r.dx);
  if (r.impression) lines.push("  结论：" + r.impression);

  for (var c = 0; c < CATS.length; c++) {
    var items = IND.filter(function(x){
      return x.cat === CATS[c] && r.v && r.v[x.k] != null && r.v[x.k] !== ""; });
    for (var i = 0; i < items.length; i++) {
      var it = ind(items[i].k), val = r.v[it.k], ju = judge(it, val);
      lines.push("  " + it.n + "：" + val + (it.u || "") +
        (it.t ? "（目标 " + it.t + (it._custom ? "，本人设定" : "") + "）" : "") +
        (ju ? (ju.lv === "bad" ? " ← 超标" : ju.lv === "warn" ? " ← 偏离" : "") : ""));
    }
  }
  /* 这一行是本应用相对上一个多出来的东西 */
  var act = medsActiveOn(ST.meds, r.date);
  lines.push("  这次检查时在用：" +
             (act.length ? act.map(medLabel).join("；") : "无记录"));
  if (r.recommendation) lines.push("  报告里的复查建议：" + r.recommendation);
  if (r.note) lines.push("  本人备注：" + r.note);
  return lines.join("\n");
}

/* 全部记录的文本。超预算时从最旧的开始砍，但至少留 3 条 ——
 * 只剩一两条就看不出趋势，那 AI 分析也没意义了。 */
function allRecordsText(rs){
  var blocks = rs.map(function(r, i){ return recText(r, i === 0); });
  var out = blocks.join("\n\n");
  while (out.length > AI_MAX_CHARS && blocks.length > 3) {
    blocks.pop();                                  // rs 是倒序，末尾最旧
    out = blocks.join("\n\n") + "\n\n（更早的记录因篇幅所限未列出）";
  }
  return out;
}

/* 用药时间线。让模型能把指标变化和用药区间对上。 */
function medsText(){
  if (!ST.meds.length) return "（没有记录任何用药）";
  return ST.meds.map(function(m){
    return "- " + m.name + (m.dose ? " " + m.dose : "") + (m.freq ? " " + m.freq : "") +
           "：" + m.start + " 起" + (m.stop ? "，" + m.stop + " 停" : "，至今仍在用");
  }).join("\n");
}

function dueText(){
  var out = [];
  for (var i = 0; i < GS.length; i++) {
    var g = GS[i];
    if (!GRP[g].days) continue;
    var d = dueInfo(ST.records, g);
    out.push("- " + GRP[g].name + "：" +
      (d.last == null ? "从未查过"
        : "上次 " + d.last + "，应于 " + d.due +
          (d.left < 0 ? "（已过期 " + (-d.left) + " 天）" : "（还有 " + d.left + " 天）")));
  }
  return out.join("\n");
}

function neverText(){
  var never = IND.filter(function(x){
    return x.g !== "n" && !lastWith(ST.records, x.k, null);
  }).map(function(x){ return x.n; });
  return never.length ? never.join("、") : "（无）";
}

var SYS_PROMPT = [
"你是一位帮人整理体检和化验记录的助手。你的读者是患者本人，不是医生。",
"",
"## 你会收到什么",
"患者自述的背景、历次检查记录（含程序已经算好的达标判断）、",
"完整的用药时间线，以及程序按固定周期算出的复查到期情况。",
"",
"## 你要做的五件事",
"1. **趋势**：哪些指标在变好、哪些在变差、哪些一直没动。只说数据支持的。",
"2. **下次该查什么**：结合到期情况和上面的趋势，给一个具体的清单。",
"3. **门诊时要问清楚的**：列出需要医生解释或决定的问题，写成可以直接念给医生听的句子。",
"4. **需要尽快处理的**：如果有明显异常或危险信号，单独列出来并说明理由。没有就写「暂无」。",
"5. **用药与指标的时间关联**：把指标的变化和用药的起止时间对照着描述。",
"   只描述同期发生了什么，不要下因果结论 —— 你看到的是两条并行的时间线，不是对照实验。",
"",
"## 你绝对不要做的事",
"- 不要开药，不要给出任何药物剂量。",
"- 不要建议加药、减药、换药或停药。这些只能由医生决定。",
"- 不要下诊断，不要说「你得了什么病」。",
"- 不要重复程序已经算好的达标判断（哪项超标下面已经标出来了），",
"  要说的是它们合起来意味着什么。",
"- 不要编造记录里没有的数据。缺什么就说缺什么。",
"",
"## 输出格式",
"用 Markdown，四到五个小标题，总长控制在 900 字以内。",
"最后固定加一行：「以上是根据你自己录入的数据做的整理，不能替代医生的判断。」"
].join("\n");

function buildUserMsg(rs, disIds){
  var parts = [];
  var bg = lsGet(LS.bg);
  if (bg) parts.push("## 患者背景\n" + bg);
  if (disIds && disIds.length)
    parts.push("## 本次只看这些疾病相关的记录\n" + disIds.map(disName).join("、"));
  parts.push("## 历次检查记录\n" + allRecordsText(rs));
  parts.push("## 用药时间线\n" + medsText());
  parts.push("## 程序按固定周期算出的复查到期情况\n" + dueText());
  parts.push("## 从未记录过的项目\n" + neverText());
  parts.push("（今天是 " + today() + "）");
  return parts.join("\n\n");
}

/* ==========================================================================
 * 调用
 * ========================================================================== */
function runAI(disIds, temp){
  if (aiBusy) return;
  var key = lsGet(LS.dsKey);
  var out = document.getElementById("ai-out");
  if (!out) return;
  if (!key) { out.innerHTML = '<p class="lede">还没填密钥。</p>'; return; }

  var rs = recordsForDiseases(ST.records, disIds || []);
  if (!rs.length) { out.innerHTML = '<p class="lede">没有可分析的记录。</p>'; return; }

  aiBusy = true;
  out.innerHTML = '<p class="lede">正在分析，约需 20–60 秒……</p>';

  var userMsg = buildUserMsg(rs, disIds);
  var ctl = new AbortController();
  var timer = setTimeout(function(){ ctl.abort(); }, AI_TIMEOUT);

  fetch(DS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      /* 密钥只出现在请求头，绝不进请求体 */
      "Authorization": "Bearer " + key
    },
    body: JSON.stringify({
      /* 有的模型只接受 temperature=1（如 kimi-k3），碰到就在下面自动重试 */
      model: DS_MODEL, max_tokens: 2000, temperature: (temp == null ? 0.3 : temp),
      messages: [{ role:"system", content: SYS_PROMPT },
                 { role:"user",   content: userMsg }]
    }),
    signal: ctl.signal
  })
  .then(function(res){
    clearTimeout(timer);
    return res.text().then(function(txt){
      var data = null;
      try { data = JSON.parse(txt); } catch (e) { data = null; }
      if (!res.ok) {
        /* 参数被拒就换 temperature=1 重来，别把它当成服务不可用报给用户 */
        if (/temperature/i.test(txt) && temp !== 1) {
          aiBusy = false;
          return runAI(disIds, 1);
        }
        var msg = res.status === 401 ? "密钥无效或已失效，去下面「设置与说明」里重填一次"
                : res.status === 402 ? "DeepSeek 账户余额不足"
                : res.status === 429 ? "请求太频繁，等一会儿再试"
                : ((data && data.error && data.error.message) ||
                   ("DeepSeek 返回 " + res.status));
        throw new Error(msg);
      }
      var choice = data && data.choices && data.choices[0];
      var text = choice && choice.message && choice.message.content;
      if (!text) throw new Error("返回内容为空");
      var model = (data && data.model) || DS_MODEL;
      return saveAI(disIds, model, userMsg, text).then(function(){
        return loadAICache();
      }).then(function(){
        showAI(text, model);
      });
    });
  })
  .catch(function(e){
    clearTimeout(timer);
    var body;
    if (e.name === "AbortError") {
      body = "分析超时（超过 2 分钟没有响应）。记录很多时会比较慢，可以先选一个病再试。";
    } else if (e instanceof TypeError) {
      body = "连不上分析服务。<br>1. 检查手机是否联网；<br>" +
             "2. 极少数网络会拦截 api.deepseek.com，换个网络（比如切到流量）再试。";
    } else {
      body = escapeHtml(e.message || String(e));
    }
    var o = document.getElementById("ai-out");
    if (o) o.innerHTML = '<div class="card flag-bad"><h3>分析失败</h3>' +
                         '<p class="tiny-note">' + body + '</p></div>';
  })
  .then(function(){ aiBusy = false; });
}

function showAI(text, model){
  var o = document.getElementById("ai-out");
  if (!o) return;
  o.innerHTML = '<div class="ai-res">' + mdLite(text) + '</div>' +
    '<div class="ai-meta">由 ' + escapeHtml(model) + ' 生成 · ' + today() + '</div>' +
    '<p class="tiny-note">这份分析已存下来，打印时可以选择带上它。</p>';
}

function saveAI(disIds, model, input, output){
  return idbPut("ai", {
    id: newId("ai"), kind: "analysis", at: new Date().toISOString(),
    scope: (disIds || []).slice(), model: model,
    input: input.slice(0, 4000),          // 只留个头用于排查，不必存全
    output: output
  });
}

/* 打印件要引用最近一次分析，范围必须对得上：
   选了病就找同样范围的那次，没选就找全量的那次。
   拿错范围的分析贴进打印件，等于给医生看一份文不对题的材料。 */
var _aiCache = null;
function loadAICache(){
  return idbAll("ai").then(function(a){
    _aiCache = a.sort(function(x, y){ return x.at < y.at ? 1 : -1; });
    return _aiCache;
  });
}
function lastAI(disIds){
  if (!_aiCache) return null;
  var want = (disIds || []).slice().sort().join(",");
  for (var i = 0; i < _aiCache.length; i++) {
    var got = (_aiCache[i].scope || []).slice().sort().join(",");
    if (got === want) return _aiCache[i];
  }
  return null;
}

/* ==========================================================================
 * 界面
 * ========================================================================== */
function aiBlock(disIds){
  var ready = aiReady();
  var bg = lsGet(LS.bg);
  var scope = disIds || [];
  var h = '<h2 class="sec">AI 分析</h2>';

  if (!ready) {
    return h + '<div class="card"><p class="lede">' +
      '把全部记录和用药时间线交给大模型，让它说说趋势、下次该查什么、' +
      '门诊时该问医生什么。</p>' +
      '<p class="tiny-note">需要一个 DeepSeek 的 API 密钥（自己去注册，按用量计费，' +
      '一次分析通常几分钱）。密钥只存在这台手机上，只发给 DeepSeek 自己的接口，' +
      '不经过任何第三方服务器。</p>' +
      '<div class="row"><button class="btn solid" onclick="setDsKey()">填入密钥</button></div>' +
      '</div>';
  }

  var prev = lastAI(scope);
  h += '<div class="card">';
  h += '<p class="lede">分析范围：' +
       (scope.length ? escapeHtml(scope.map(disName).join("、")) : "全部记录") + '</p>';
  h += '<div class="row"><button class="btn solid" onclick=\'runAI(' +
       escapeHtml(JSON.stringify(scope)) + ')\'>开始分析</button></div>';
  h += '<div id="ai-out">';
  if (prev) {
    h += '<div class="ai-res">' + mdLite(prev.output) + '</div>' +
         '<div class="ai-meta">上次由 ' + escapeHtml(prev.model || "大模型") +
         ' 生成于 ' + escapeHtml((prev.at || "").slice(0, 10)) + '</div>';
  }
  h += '</div>';
  h += '<details class="fold"><summary>设置与说明</summary>' +
    '<div class="v-row"><div class="v-n">DeepSeek 密钥</div>' +
      '<div class="v-t">已填写</div>' +
      '<div class="v-note"><button class="btn tiny" onclick="setDsKey()">修改</button></div></div>' +
    '<div class="v-row"><div class="v-n">病情背景</div>' +
      '<div class="v-t">' + (bg ? "已填写" : "未填写") + '</div>' +
      '<div class="v-note"><button class="btn tiny" onclick="setBg()">' +
      (bg ? "修改" : "填写") + '</button></div></div>' +
    '<p class="tiny-note">发给 DeepSeek 的内容包括：你填的背景、检查记录、用药时间线。' +
    '<b>不包括</b>姓名、身份证号、手机号、原始照片。<br>' +
    'AI 被明确要求不开药、不给剂量、不建议加减停药、不下诊断 —— ' +
    '它的输出是整理，不是医嘱。</p>' +
    '</details></div>';
  return h;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SYS_PROMPT, DS_API, DS_MODEL, AI_MAX_CHARS, AI_TIMEOUT,
                     recText, allRecordsText, medsText, dueText, neverText,
                     buildUserMsg, aiReady, lastAI, loadAICache, aiBlock };
}
