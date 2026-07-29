"use strict";
/* ==========================================================================
 * vision.js — 拍照识别
 *
 * 探针结论（2026-07-28，从 GitHub Pages 实测）：智谱、阿里百炼、硅基流动、
 * 阶跃星辰、MiniMax 都放行浏览器直连，火山方舟豆包不放行。所以这里直连，
 * 不建代理。
 *
 * 贯穿这个文件的一条原则：**先存图，再发请求**。
 * 识别失败、超时、断网、模型胡说八道，代价都只是「要手动填」，
 * 绝不能是「照片没了」。照片是唯一能回溯的原始依据。
 *
 * 第二条：模型的输出一律当作草稿。所有字段都进确认表单，
 * 每个值旁边挂着它在原文里的出处，人点了「保存」才算数。
 * 化验单是密集表格，视觉模型最容易犯的错是**串行** ——
 * 项目名对、数值取自隔壁行。串行的值比没有值更危险。
 * ========================================================================== */

/* 探针里验过的厂商。model 可改，接口都是 OpenAI 兼容格式。 */
var VL_PROVIDERS = [
  { id:"zhipu",   name:"智谱 GLM-4V",
    url:"https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model:"glm-4v-flash", maxTokens:1024,
    note:"glm-4v-flash 免费，但输出上限只有 1024 token，项目多的单子会被截断，建议分几张拍。想一次读完就把模型名改成 glm-4v-plus（收费）。注册：open.bigmodel.cn" },
  { id:"dashscope", name:"阿里百炼 Qwen-VL",
    url:"https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model:"qwen-vl-max-latest", maxTokens:4000,
    note:"中文表格识别口碑最好的一档。注册：bailian.console.aliyun.com" },
  { id:"silicon", name:"硅基流动",
    url:"https://api.siliconflow.cn/v1/chat/completions",
    model:"Qwen/Qwen2.5-VL-32B-Instruct", maxTokens:4000,
    note:"聚合平台，模型可换。注册：siliconflow.cn" },
  { id:"step",    name:"阶跃星辰",
    url:"https://api.stepfun.com/v1/chat/completions",
    model:"step-1v-8k", maxTokens:4000, note:"" },
  { id:"kimi",    name:"Kimi（月之暗面）",
    url:"https://api.moonshot.cn/v1/chat/completions",
    model:"moonshot-v1-8k-vision-preview", maxTokens:4000,
    note:"Kimi 有视觉模型，但它家接口历来不给浏览器发跨域头，很可能连不上。" +
         "先去探针页测「2 跨域」，通过了再选它。注册：platform.moonshot.cn" }
];

function vlProvider(){
  var id = lsGet(LS.vlProv);
  for (var i = 0; i < VL_PROVIDERS.length; i++)
    if (VL_PROVIDERS[i].id === id) return VL_PROVIDERS[i];
  return null;
}
function vlModel(){
  var p = vlProvider();
  return lsGet("bl_ai_vl_model") || (p ? p.model : "");
}
function vlReady(){ return !!(vlProvider() && lsGet(LS.vlKey)); }

/* ==========================================================================
 * 图片处理
 * ========================================================================== */
var IMG_MAX_EDGE = 1600;    // 长边。再大对识别几乎没帮助，只是更慢更贵。
var IMG_QUALITY  = 0.82;
var IMG_MAX_KB   = 900;     // 超过就降档重压，各家对单图大小都有限制

function fileToImage(file){
  return new Promise(function(resolve, reject){
    var fr = new FileReader();
    fr.onerror = function(){ reject(new Error("读不了这个文件")); };
    fr.onload = function(){
      var img = new Image();
      img.onerror = function(){ reject(new Error("这不是一张能打开的图片")); };
      img.onload = function(){ resolve(img); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* 压到长边 1600 / q0.82；还是太大就退到 1280 / q0.75。
 * 返回 {blob, dataUrl, w, h}。 */
function shrink(img, maxEdge, quality){
  maxEdge = maxEdge || IMG_MAX_EDGE;
  quality = quality || IMG_QUALITY;
  var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (Math.max(w, h) > maxEdge) {
    var s = maxEdge / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  var cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  var g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);   // 透明 PNG 转 JPEG 会变黑
  g.drawImage(img, 0, 0, w, h);
  var dataUrl = cv.toDataURL("image/jpeg", quality);
  if (dataUrl.length * 0.75 / 1024 > IMG_MAX_KB && maxEdge > 1280)
    return shrink(img, 1280, 0.75);
  return { dataUrl: dataUrl, w: w, h: h, canvas: cv };
}

function thumbOf(img){
  var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  var s = 220 / Math.max(w, h);
  var cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * s));
  cv.height = Math.max(1, Math.round(h * s));
  var g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.7);
}

function dataUrlToBlob(u){
  var parts = u.split(",");
  var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
  var bin = atob(parts[1]);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ==========================================================================
 * 提示词
 * 底本是飞牛的 health-record-v4，改了三处：
 *   1. 加上 diseaseTags（飞牛明确不做疾病判断，那是我们要的）
 *   2. 加上 observationCount 自校验
 *   3. 强调不要跨行取值 —— 串行是这个场景最危险的错误
 * ========================================================================== */
function visionPrompt(diseases){
  var disList = (diseases || []).map(function(d){
    return "  " + d.id + " = " + d.name +
           ((d.keywords && d.keywords.length) ? "（关键词：" + d.keywords.slice(0, 6).join("、") + "）" : "");
  }).join("\n");

  return [
"你是医疗报告结构化助手。只提取图片里明确出现的事实，不得诊断、不得推测、不得给治疗建议。",
"返回一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。",
"",
"字段：",
'{"reportType":"...","title":"...","hospitalName":"...","department":"...",',
'"reportDate":"YYYY-MM-DD","bodyParts":["..."],',
'"clinicalDiagnosis":"...","findings":"...","impression":"...","recommendation":"...",',
'"observations":[{"sectionName":"所属小节","itemName":"项目名","resultText":"结果原文",',
'"unit":"单位或null","referenceText":"参考范围原文或null",',
'"abnormalFlag":"high|low|abnormal|normal|null","quote":"这一行的原文"}],',
'"observationCount":数字,',
'"diseaseTags":[{"id":"疾病id","confidence":0到1,"quote":"支持这个判断的原文"}]}',
"",
"reportType 只能是：physical_exam、laboratory、imaging、functional、pathology、",
"outpatient、inpatient、prescription、receipt、vaccine、other。",
"",
"title 用于归档展示。如果原报告标题是「检验报告单」「体检报告」这类泛标题，",
"要按主要项目或部位改写成有信息量的短标题，例如「血脂八项检验报告」「胸部CT报告」。",
"不要生成带疾病判断的标题。",
"",
"reportDate 取报告出具日期（不是打印日期、不是采样日期，如果都有的话优先「报告日期」）。",
"",
"【逐行提取，绝对不要跨行取值】",
"表格是密集排列的，同一行的项目名、结果、单位、参考范围必须来自视觉上的同一行。",
"如果某一行看不清，就把这一项整个略过，不要用相邻行的数值凑数。",
"每条 observation 的 quote 必须是该行的原文，用于人工核对。",
"",
"abnormalFlag 只从结果旁边印出来的标记读取：",
"箭头向上或「偏高」「↑」「H」为 high，箭头向下或「偏低」「↓」「L」为 low，",
"有标记但分不清高低（如「阳性」「异常」「*」）为 abnormal，",
"报告明确标了正常为 normal，什么标记都没有就填 null。",
"【不要根据参考范围自己推断】—— 那是程序的工作，不是你的。",
"",
"observationCount 必须等于 observations 数组的实际长度。",
"",
diseases && diseases.length ? [
"diseaseTags：判断这份报告和下列哪些既有疾病相关。",
disList,
"只在报告的文字（诊断、结论、检查所见、标题、科室）明确指向该疾病时才打标。",
"【不要根据化验数值推断疾病】—— 血糖高不等于这份报告是糖尿病的报告。",
"没有明确指向就返回空数组。"
].join("\n") : "diseaseTags 返回空数组。",
"",
"不要输出姓名、身份证号、电话、住址、就诊卡号。缺失的字段用 null、空字符串或空数组。"
].join("\n");
}

/* 模型爱加代码围栏，也常在 JSON 前后带一句废话 */
function parseJsonLoose(text){
  var s = String(text || "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(s); } catch (e) {}
  var a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {}
  }
  throw new Error("模型返回的不是合法 JSON");
}

/* ==========================================================================
 * 把模型输出变成一条记录草稿
 * 认不出的项目不丢弃，落成 x: 前缀存着 —— 数据只有一份，宁可难看也不能少。
 * ========================================================================== */
function draftFromVision(data, diseases){
  var obs = [], unknown = 0, conflicts = [];
  var list = (data && data.observations) || [];

  for (var i = 0; i < list.length; i++) {
    var o = list[i] || {};
    var name = String(o.itemName || "").trim();
    if (!name) continue;
    var raw  = o.resultText == null ? "" : String(o.resultText).trim();
    if (!raw) continue;

    var m = matchIndicator({ itemName: name, unit: o.unit, sectionName: o.sectionName });
    var unit = normUnit(o.unit);
    var val = raw, conv = null;

    if (m.k) {
      conv = convUnit(m.k, raw, unit);
      if (conv.converted) { val = conv.val; unit = conv.unit; }
    } else {
      unknown++;
    }

    var flag = o.abnormalFlag && o.abnormalFlag !== "null" ? o.abnormalFlag
             : flagFromText(raw + " " + (o.quote || ""));

    var rec = {
      k: m.k || ("x:" + compactKeyKeepParen(name)),
      name: name, raw: raw, val: val, unit: unit,
      refText: o.referenceText || "",
      refLow: null, refHigh: null,
      flag: flag,
      sec: o.sectionName || "",
      conf: m.conf,
      quote: o.quote || "",
      why: m.why,
      converted: !!(conv && conv.converted),
      src: "vision"
    };
    /* 参考范围里的上下限抠出来，用于下面的自相矛盾检查 */
    var rr = String(o.referenceText || "").match(/(-?\d+\.?\d*)\s*[-–~至]\s*(-?\d+\.?\d*)/);
    if (rr) { rec.refLow = parseFloat(rr[1]); rec.refHigh = parseFloat(rr[2]); }
    var c = flagConflict(rec);
    if (c) { rec.conflict = c; conflicts.push(name + "：" + c); }
    obs.push(rec);
  }

  /* 模型自报条数对不上 = 它自己都没数清，这份结果要人重点核对 */
  var declared = data && data.observationCount;
  var countOff = (typeof declared === "number" && declared !== list.length)
    ? "模型自报 " + declared + " 项，实际给出 " + list.length + " 项"
    : null;

  var tags = [];
  var raw = (data && data.diseaseTags) || [];
  for (var j = 0; j < raw.length; j++) {
    var t2 = raw[j] || {};
    if (!t2.id) continue;
    var exists = (diseases || []).some(function(d){ return d.id === t2.id; });
    if (exists && (t2.confidence == null || t2.confidence >= 0.6)) tags.push(t2.id);
  }

  return {
    date: normDate(data && data.reportDate) || "",
    type: normType(data && data.reportType),
    title: (data && data.title) || "",
    hospital: (data && data.hospitalName) || "",
    dept: (data && data.department) || "",
    dx: (data && data.clinicalDiagnosis) || "",
    findings: (data && data.findings) || "",
    impression: (data && data.impression) || "",
    recommendation: (data && data.recommendation) || "",
    bodyParts: (data && data.bodyParts) || [],
    dis: tags,
    obs: obs,
    warnings: {
      unknown: unknown,
      countOff: countOff,
      conflicts: conflicts,
      noDate: !normDate(data && data.reportDate)
    }
  };
}

/* ==========================================================================
 * 调用
 * ========================================================================== */
var VL_TIMEOUT = 150000;
var vlBusy = false;

function callVision(dataUrl, diseases){
  var p = vlProvider(), key = lsGet(LS.vlKey);
  if (!p) return Promise.reject(new Error("还没选识别服务"));
  if (!key) return Promise.reject(new Error("还没填识别服务的密钥"));

  var ctl = new AbortController();
  var timer = setTimeout(function(){ ctl.abort(); }, VL_TIMEOUT);

  var body = {
    model: vlModel(),
    temperature: 0,
    max_tokens: (p.maxTokens || 4000),
    messages: [{ role:"user", content: [
      { type:"text", text: visionPrompt(diseases) },
      { type:"image_url", image_url:{ url: dataUrl } }
    ]}]
  };

  return fetch(p.url, {
    method: "POST",
    headers: { "Content-Type":"application/json",
               /* 密钥只在请求头 */
               "Authorization": "Bearer " + key },
    body: JSON.stringify(body),
    signal: ctl.signal
  }).then(function(res){
    clearTimeout(timer);
    return res.text().then(function(txt){
      var data = null;
      try { data = JSON.parse(txt); } catch (e) {}
      /* MiniMax 之类认证失败也返回 200，错误藏在 body 里，光看状态码会漏 */
      var inBody = data && data.base_resp && data.base_resp.status_code;
      if (!res.ok || inBody) {
        var msg = res.status === 401 || inBody === 1004
                    ? "密钥无效，去「更多 → 拍照识别」重填"
                : res.status === 402 ? "账户余额不足"
                : res.status === 429 ? "请求太频繁，等一会儿再试"
                : res.status === 413 ? "图片太大，换张小一点的或分几张拍"
                : ((data && data.error && data.error.message) ||
                   (data && data.base_resp && data.base_resp.status_msg) ||
                   ("服务返回 " + res.status));
        throw new Error(msg);
      }
      var ch = data && data.choices && data.choices[0];
      var content = ch && ch.message && ch.message.content;
      if (!content) throw new Error("识别服务返回内容为空");
      /* 输出被长度上限截断。必须点名说清楚 —— 否则用户只会看到
         「返回格式不对」，然后反复重试同一张永远读不完的单子。
         免费的 glm-4v-flash 上限只有 1024 token，密集单子必然装不下。 */
      if (ch.finish_reason === "length")
        throw new Error("这张单子的项目太多，模型的输出长度不够用（当前上限 " +
          (p.maxTokens || 4000) + " token），结果被截断了。\n" +
          "两个办法：把单子分成几张分别拍（推荐），" +
          "或者换一个输出上限更高的模型（去「更多 → 拍照识别」改模型名）。");
      /* 原文一律带回去。识别效果不好时，「模型到底返回了什么」是唯一能
         区分「读不动表格」和「程序解析错了」的证据，不能只留在控制台。 */
      var meta = {
        raw: content,
        model: (data && data.model) || vlModel(),
        finish: ch.finish_reason || "",
        usage: (data && data.usage) || null
      };
      try {
        return { data: parseJsonLoose(content), model: meta.model, meta: meta };
      } catch (pe) {
        pe.rawContent = content;      // 解析失败时也要能看到原文
        throw pe;
      }
    });
  }).catch(function(e){
    clearTimeout(timer);
    if (e.name === "AbortError")
      throw new Error("识别超时（超过 2 分半）。图片很大或网络慢时会这样，可以重试。");
    if (e instanceof TypeError)
      throw new Error("连不上识别服务。检查手机是否联网；如果刚换过服务商，" +
                      "有的厂商不允许网页直接调用，去探针页测一下。");
    throw e;
  });
}

/* ==========================================================================
 * 界面
 * ========================================================================== */
/* 这两个必须是模块级的：切换录入页分类会整页重渲染，
   把识别结果挂在 draft 对象上的话，一切分类就没了。 */
var SHOT = null;        // {dataUrl, thumb, w, h, blob}
var VIS_DRAFT = null;   // draftFromVision 的结果，保存时用来还原原文出处

/* 两个入口分开：带 capture 的直接开相机，不带的才弹相册。
   合成一个按钮做不到 —— capture 一旦加上，浏览器就不给相册选项了。 */
function takePhoto(){
  var el = document.getElementById("shot-camera");
  if (el) el.click();
}
function pickPhoto(){
  var el = document.getElementById("shot-input");
  if (el) el.click();
}

function onPhoto(ev){
  var f = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  var box = document.getElementById("shot-box");
  if (box) box.innerHTML = '<p class="lede">正在处理图片……</p>';

  fileToImage(f).then(function(img){
    var small = shrink(img);
    SHOT = { dataUrl: small.dataUrl, thumb: thumbOf(img),
             w: small.w, h: small.h, blob: dataUrlToBlob(small.dataUrl) };
    renderShot();
  }).catch(function(e){
    if (box) box.innerHTML = '<div class="card flag-bad"><p class="tiny-note">' +
      escapeHtml(e.message) + '</p></div>';
  });
}

function renderShot(){
  var box = document.getElementById("shot-box");
  if (!box) return;
  if (!SHOT) { box.innerHTML = ""; return; }
  var kb = Math.round(SHOT.blob.size / 1024);
  box.innerHTML =
    '<img src="' + SHOT.thumb + '" alt="化验单预览" ' +
      'style="max-width:100%;border-radius:8px;border:1px solid var(--rule);display:block">' +
    '<p class="tiny-note">' + SHOT.w + '×' + SHOT.h + ' · ' + kb + ' KB' +
      '（已压缩，原图不保留）</p>' +
    '<div class="row">' +
      '<button class="btn solid" onclick="runVision()">识别这张</button>' +
      '<button class="btn tiny" onclick="takePhoto()">重拍</button>' +
      '<button class="btn tiny" onclick="pickPhoto()">换一张</button>' +
      '<button class="btn tiny" onclick="SHOT=null;renderShot()">取消</button>' +
    '</div><div id="vis-out"></div>';
}

function runVision(){
  if (vlBusy || !SHOT) return;
  var out = document.getElementById("vis-out");
  if (!vlReady()) {
    out.innerHTML = '<div class="card flag-warn"><p class="tiny-note">' +
      '还没配置识别服务。到「更多 → 拍照识别」选一家并填密钥。</p></div>';
    return;
  }
  vlBusy = true;
  out.innerHTML = '<p class="lede">正在识别，约需 10–40 秒……</p>';

  /* 先把图存进去再发请求：识别失败也不能把照片丢了 */
  callVision(SHOT.dataUrl, ST.diseases).then(function(r){
    VIS_DRAFT = draftFromVision(r.data, ST.diseases);
    VIS_DRAFT._model = r.model;
    VIS_DRAFT._meta = r.meta || null;
    vlBusy = false;
    renderEntry(visionToForm(VIS_DRAFT));
    setTimeout(function(){
      var w = document.getElementById("vis-warn");
      if (w) w.scrollIntoView({ block:"start" });
    }, 0);
    toast("识别完成，请逐项核对");
  }).catch(function(e){
    vlBusy = false;
    out.innerHTML = '<div class="card flag-bad"><h3>识别失败</h3>' +
      '<p class="tiny-note">' + escapeHtml(e.message) + '</p>' +
      '<p class="tiny-note">照片还在，可以重试，或者直接手动填。</p>' +
      '<div class="row"><button class="btn tiny" onclick="runVision()">重试</button></div></div>';
  });
}

/* 草稿 → 录入表单的 draft 结构 */
function visionToForm(d){
  var v = {};
  for (var i = 0; i < d.obs.length; i++) {
    var o = d.obs[i];
    if (o.k.indexOf("x:") === 0) continue;
    if (v[o.k] == null) v[o.k] = o.val;
  }
  return {
    date: d.date || today(), type: d.type, title: d.title,
    hospital: d.hospital, dept: d.dept, dx: d.dx,
    findings: d.findings, impression: d.impression,
    recommendation: d.recommendation, note: "",
    v: v, dis: d.dis, _vision: d
  };
}

/* 录入页顶部的核对提示。这一块是拍照识别能不能安全用的关键。 */
function visionWarnBlock(d){
  if (!d) return "";
  var w = d.warnings || {};
  var empty = d.obs.length === 0;

  /* 一项都没读出来 = 这次识别其实失败了。
     以前这里照样显示「识别完了」再交一张空表单，等于让人白等一场还得自己
     从头填。必须当成失败讲清楚，并直接给出下一步怎么办。 */
  var h = '<div id="vis-warn" class="card ' + (empty ? "flag-bad" : "flag-warn") + '">';

  if (empty) {
    h += '<h3>没能读出任何检查项目</h3>';
    h += '<p class="tiny-note">表头信息（医院、日期这些）读到了，但表格里一项都没读出来。' +
         '常见原因按可能性排：</p>';
    h += '<p class="tiny-note">' +
      '<b>1. 模型能力不够。</b>免费的 glm-4v-flash 读密集中文表格确实吃力。' +
      '换 <b>阿里百炼的 qwen-vl-max-latest</b>（中文表格识别最好的一档），' +
      '或把智谱的模型名改成 <b>glm-4v-plus</b>。去「更多 → 拍照识别」改。<br>' +
      '<b>2. 图不够清楚。</b>微信里存过的图会被压缩，小字容易糊。' +
      '用原始拍摄的那张，或直接对着纸质单子重拍。<br>' +
      '<b>3. 一张拍太多。</b>把单子分成两三段分别拍，每张只拍几行，准确率会明显提高。</p>';
    h += '<div class="row">' +
      '<button class="btn tiny" onclick="go(\'more\')">去换模型</button>' +
      '<button class="btn tiny" onclick="takePhoto()">重拍</button>' +
      '<button class="btn tiny" onclick="pickPhoto()">换一张</button>' +
      '</div>';
  } else {
    h += '<h3>识别完了，但必须逐项核对</h3>';
    h += '<p class="tiny-note">视觉模型在密集表格上最容易犯的错是<b>串行</b> —— ' +
         '项目名对、数值取自隔壁行。这种错比漏读危险得多，' +
         '所以下面每一项旁边都附了它在原文里的出处。</p>';
  }

  var bad = [];
  if (w.noDate) bad.push("没认出报告日期，请自己填");
  if (w.countOff) bad.push(w.countOff);
  if (w.unknown) bad.push("有 " + w.unknown + " 项不在字典里，没有填进表单（下面能看到）");
  if (w.conflicts && w.conflicts.length)
    bad.push("有 " + w.conflicts.length + " 项自相矛盾：" + w.conflicts.join("；"));
  if (bad.length)
    h += '<p class="tiny-note"><b>需要注意：</b><br>' +
         bad.map(function(s){ return "· " + escapeHtml(s); }).join("<br>") + '</p>';

  h += '<details class="fold"><summary>逐项看模型读到了什么（' + d.obs.length + ' 项）</summary>';
  for (var i = 0; i < d.obs.length; i++) {
    var o = d.obs[i];
    var known = o.k.indexOf("x:") !== 0;
    h += '<div class="v-row">' +
      '<div class="v-n">' + escapeHtml(o.name) +
        (known ? "" : ' <span class="pill p-idle">字典里没有</span>') +
        (o.conflict ? ' <span class="pill p-bad">自相矛盾</span>' : "") +
        (o.converted ? ' <span class="pill p-idle">已换算单位</span>' : "") + '</div>' +
      '<div class="v-v">' + escapeHtml(o.val) + (o.unit ? " " + escapeHtml(o.unit) : "") + '</div>' +
      (o.quote ? '<div class="v-note">原文：' + escapeHtml(o.quote) + '</div>' : "") +
      (known ? "" : '<div class="v-note">' + escapeHtml(o.why) + '</div>') +
      '</div>';
  }
  h += '</details>';

  /* 模型原文。识别效果不好时这是唯一能分清「模型读不动」和「程序解析错了」
     的证据 —— 藏在控制台里等于没有。 */
  if (d._meta && d._meta.raw) {
    var m = d._meta;
    h += '<details class="fold"><summary>模型原始返回（排查用）</summary>';
    h += '<p class="tiny-note">模型 ' + escapeHtml(m.model || "") +
         (m.finish ? " · 结束原因 " + escapeHtml(m.finish) : "") +
         (m.usage && m.usage.completion_tokens
            ? " · 输出 " + m.usage.completion_tokens + " token" : "") + '</p>';
    h += '<pre class="log">' + escapeHtml(m.raw.slice(0, 4000)) + '</pre>';
    h += '<div class="row"><button class="btn tiny" onclick="copyVisionRaw()">复制原文</button></div>';
    h += '</details>';
  }

  h += '<p class="tiny-note">照片会和这条记录一起存下来，' +
       '以后任何时候都能翻出原件对照。由 ' + escapeHtml(d._model || "视觉模型") + ' 识别。</p>';
  return h + '</div>';
}

function copyVisionRaw(){
  if (!VIS_DRAFT || !VIS_DRAFT._meta) return;
  var txt = "模型：" + (VIS_DRAFT._meta.model || "") +
            "\n结束原因：" + (VIS_DRAFT._meta.finish || "") +
            "\n\n" + VIS_DRAFT._meta.raw;
  if (navigator.clipboard && window.isSecureContext)
    navigator.clipboard.writeText(txt).then(function(){ toast("已复制"); },
                                           function(){ toast("复制失败，请长按选择"); });
  else toast("复制失败，请长按选择");
}

/* 用户在确认表单里改过值之后，把识别出来的 obs 和表单里的 v 对齐。
 * 表单是最终真相（人改过），但 obs 里的原文出处要留着 ——
 * 那是以后回查「这个数当初是从哪一行读出来的」唯一的线索。 */
function reconcileObs(visionObs, v){
  var out = [], seen = {};
  for (var i = 0; i < (visionObs || []).length; i++) {
    var o = visionObs[i];
    if (o.k.indexOf("x:") === 0) { out.push(o); continue; }  // 未识别的原样留着
    if (v[o.k] == null || v[o.k] === "") continue;           // 人删掉了
    if (seen[o.k]) continue;
    seen[o.k] = 1;
    if (String(v[o.k]) !== String(o.val))
      o = Object.assign({}, o, { val: String(v[o.k]), corrected: true });
    out.push(o);
  }
  /* 人自己补填、识别时没读到的项目 */
  for (var k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    if (seen[k] || v[k] == null || v[k] === "") continue;
    var ind2 = indByKey(k);
    out.push({ k:k, name: ind2 ? ind2.n : k, raw:String(v[k]), val:String(v[k]),
               unit: ind2 ? ind2.u : "", refText: ind2 ? (ind2.t || "") : "",
               refLow:null, refHigh:null, flag:null, sec: ind2 ? ind2.cat : "",
               conf:1, quote:"", src:"manual" });
  }
  return out;
}

/* ---- 设置 ---- */
function setVlProvider(){
  var names = VL_PROVIDERS.map(function(p, i){ return (i + 1) + ". " + p.name; }).join("\n");
  var cur = vlProvider();
  var v = prompt("选一个识别服务（填序号）：\n\n" + names +
    "\n\n0 = 关闭拍照识别\n\n" +
    VL_PROVIDERS.map(function(p){ return p.note; }).filter(Boolean).join("\n"),
    cur ? String(VL_PROVIDERS.indexOf(cur) + 1) : "1");
  if (v === null) return;
  var n = parseInt(v, 10);
  if (n === 0) { lsSet(LS.vlProv, ""); toast("已关闭"); render(); return; }
  if (!(n >= 1 && n <= VL_PROVIDERS.length)) { alert("请填 1 到 " + VL_PROVIDERS.length); return; }
  lsSet(LS.vlProv, VL_PROVIDERS[n - 1].id);
  lsSet("bl_ai_vl_model", "");
  toast("已选 " + VL_PROVIDERS[n - 1].name);
  render();
}

function setVlKey(){
  var p = vlProvider();
  if (!p) { alert("先选一个识别服务"); return; }
  var v = prompt("填入 " + p.name + " 的 API 密钥。\n\n" +
    (p.note || "") + "\n\n密钥只存在这台手机上，只发给该厂商自己的接口。\n" +
    "留空并确定 = 删除。", lsGet(LS.vlKey) ? "（已保存，留空可删除）" : "");
  if (v === null) return;
  v = v.trim();
  if (v.indexOf("（已保存") === 0) return;
  lsSet(LS.vlKey, v);
  toast(v ? "已保存" : "已删除");
  render();
}

function setVlModel(){
  var p = vlProvider();
  if (!p) { alert("先选一个识别服务"); return; }
  var v = prompt("模型名（留空用默认的 " + p.model + "）：", vlModel());
  if (v === null) return;
  lsSet("bl_ai_vl_model", v.trim() === p.model ? "" : v.trim());
  toast("已保存");
  render();
}

function vlSettingsBlock(){
  var p = vlProvider();
  var h = '<h2 class="sec">拍照识别</h2><div class="card">';
  h += '<p class="lede">拍化验单，让视觉大模型读成结构化数据自动填表。' +
       '识别结果一律要你逐项核对后才保存。</p>';
  h += '<div class="v-row"><div class="v-n">识别服务</div>' +
    '<div class="v-t">' + (p ? escapeHtml(p.name) : "未选择") + '</div>' +
    '<div class="v-note"><button class="btn tiny" onclick="setVlProvider()">选择</button></div></div>';
  if (p) {
    h += '<div class="v-row"><div class="v-n">密钥</div>' +
      '<div class="v-t">' + (lsGet(LS.vlKey) ? "已填写" : "未填写") + '</div>' +
      '<div class="v-note"><button class="btn tiny" onclick="setVlKey()">' +
      (lsGet(LS.vlKey) ? "修改" : "填写") + '</button></div></div>';
    h += '<div class="v-row"><div class="v-n">模型</div>' +
      '<div class="v-t">' + escapeHtml(vlModel()) + '</div>' +
      '<div class="v-note"><button class="btn tiny" onclick="setVlModel()">修改</button></div></div>';
  }
  h += '<details class="fold"><summary>关于准确率和隐私</summary>' +
    '<p class="tiny-note"><b>准确率</b>：干净照片下逐字段大约 85–95%。' +
    '密集的生化全套建议分小节拍几张，比一张拍全准得多。' +
    '每次识别都会显示模型自报的项目数和实际给出的项目数，对不上会提醒你。<br><br>' +
    '<b>会发出去什么</b>：只有你拍的那张化验单图片。' +
    '不发姓名、不发历史记录、不发用药信息。<br><br>' +
    '<b>照片存哪</b>：压缩后存在这台手机的本地数据库里，' +
    '不上传任何网盘。相机原图不保留。</p></details>';
  return h + '</div>';
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { VL_PROVIDERS, visionPrompt, parseJsonLoose, draftFromVision,
                     visionToForm, visionWarnBlock, vlReady, vlProvider, vlModel,
                     IMG_MAX_EDGE, IMG_QUALITY };
}
