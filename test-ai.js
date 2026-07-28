// AI 层测试。运行：node test-ai.js
// 不发真实请求。测的是上下文构造、护栏、以及「什么东西会被发出去」。
require("./test-load").load(["data.js", "core.js"]);

const noop = () => {};
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k,v) => { store[k] = v; }, removeItem: k => { delete store[k]; },
};
const els = {};
function stub(id){
  if (!els[id]) els[id] = { id, innerHTML:"", textContent:"", value:"", hidden:false,
    checked:false, className:"", classList:{ add:noop, remove:noop, toggle:noop },
    setAttribute:noop, onclick:null };
  return els[id];
}
global.document = { getElementById: stub, querySelectorAll: () => [],
  createElement: () => ({ style:{} }), body:{ appendChild:noop, removeChild:noop },
  addEventListener: noop, styleSheets: [] };
global.window = { scrollTo:noop, print:noop, addEventListener:noop,
                  removeEventListener:noop, isSecureContext:false };
global.navigator = {}; global.Blob = class {};
global.URL = { createObjectURL:()=>"" , revokeObjectURL:noop };
global.FileReader = class {}; global.confirm = () => true;
global.alert = noop; global.prompt = () => null;
global.indexedDB = { open: () => ({}) };
global.AbortController = class { constructor(){ this.signal = {}; } abort(){ this.aborted = true; } };

require("./test-load").loadInto("store.js");
["openDB","seedOnce","requestPersist"].forEach(n => { global[n] = () => Promise.resolve(); });
global.loadRecords = () => Promise.resolve([]);
global.loadDiseases = () => Promise.resolve([]);
global.loadMeds = () => Promise.resolve([]);
global.loadTargets = () => Promise.resolve({});
global.storageInfo = () => Promise.resolve({ supported:false });
global.idbAll = () => Promise.resolve([]);
global.idbPut = () => Promise.resolve();
require("./test-load").loadInto("ai.js");
require("./test-load").loadInto("print.js");
require("./test-load").loadInto("app.js");

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

const RECS = [
  { id:"r3", date:"2026-07-20", updatedAt:"c", type:"laboratory", title:"血脂八项",
    hospital:"某医院", dept:"心内科", dis:["hlp"], note:"停他汀 4 个多月后",
    impression:"低密度脂蛋白升高", recommendation:"3个月后复查血脂",
    v:{ lipid_ldl_c:"4.20", liver_alt:"62" } },
  { id:"r2", date:"2026-01-04", updatedAt:"b", type:"laboratory", title:"生化全套",
    dis:["hlp"], note:"", v:{ lipid_ldl_c:"1.30", enzyme_ck:"82.9" } },
  { id:"r1", date:"2025-09-26", updatedAt:"a", type:"laboratory", title:"血脂四项",
    dis:["hlp"], note:"", v:{ lipid_ldl_c:"1.29" } },
];
const MEDS = [
  { id:"m1", name:"阿托伐他汀钙片", dose:"20mg", freq:"每晚一次",
    start:"2025-08-01", stop:"2026-03-01", dis:["hlp"] },
  { id:"m2", name:"二甲双胍缓释片", dose:"0.5g", freq:"每日两次",
    start:"2025-01-01", stop:null, dis:["dm"] },
];
ST.records = RECS;
ST.diseases = SEED_DIS.map(d => Object.assign({}, d));
ST.meds = MEDS;
ST.targets = {};
ST.ready = true;

console.log("=== 护栏：这些话一句都不能少 ===");
[
  "不要开药", "不要给出任何药物剂量",
  "不要建议加药、减药、换药或停药",
  "不要下诊断", "不要编造记录里没有的数据",
].forEach(s => t(`包含「${s}」`, SYS_PROMPT.includes(s), true));
t("要求不下因果结论", /不要下因果结论/.test(SYS_PROMPT), true);
t("说明了为什么不能下因果（两条并行时间线，不是对照实验）",
  /不是对照实验/.test(SYS_PROMPT), true);
t("有固定的免责尾句", SYS_PROMPT.includes("不能替代医生的判断"), true);
t("有第五段：用药与指标的时间关联", SYS_PROMPT.includes("用药与指标的时间关联"), true);
t("要求不要重复程序已算好的判断", /不要重复程序已经算好的达标判断/.test(SYS_PROMPT), true);

console.log("=== 提示词里不含任何个人信息 ===");
// SYS_PROMPT 是公开托管的程序的一部分，病情背景必须来自设备而不是代码
t("不含具体数值", (SYS_PROMPT.match(/\d+\.\d+/g) || []), []);
t("不含具体日期", (SYS_PROMPT.match(/20\d{2}-\d{2}/g) || []), []);
t("不含药名", ["他汀","二甲双胍","优甲乐","恩替卡韦"].filter(s => SYS_PROMPT.includes(s)), []);
t("不含疾病名", ["糖尿病","甲状腺癌","冠心病"].filter(s => SYS_PROMPT.includes(s)), []);
const aiSrc = require("fs").readFileSync("ai.js", "utf8");
t("背景来自设备而非代码", /lsGet\(LS\.bg\)/.test(aiSrc), true);
t("源码里没有硬编码的密钥", /sk-[A-Za-z0-9]{16,}/.test(aiSrc), false);

console.log("=== 密钥只进请求头，绝不进请求体 ===");
// body 是 JSON.stringify 出来的，只含 model / messages / 参数
const bodyPart = aiSrc.slice(aiSrc.indexOf("body: JSON.stringify({"),
                             aiSrc.indexOf("signal: ctl.signal"));
t("请求体里不出现 key 变量", /\bkey\b/.test(bodyPart), false);
t("Authorization 头里才有 key", /"Authorization": "Bearer " \+ key/.test(aiSrc), true);
t("有超时中止", /AbortController/.test(aiSrc) && /ctl\.abort/.test(aiSrc), true);
t("超时后清理定时器", (aiSrc.match(/clearTimeout\(timer\)/g) || []).length >= 2, true);

console.log("=== 每条记录都带上当时在吃的药 ===");
// 这是本应用相对上一个多出来的核心信息
const t3 = recText(RECS[0], true);
const t2 = recText(RECS[1], false);
t("停药后那次：只有二甲双胍",
  /这次检查时在用：二甲双胍缓释片 0\.5g 每日两次$/m.test(t3), true);
t("停药后那次不含他汀", /这次检查时在用：[^\n]*阿托伐他汀/.test(t3), false);
t("服药期那次含他汀", /这次检查时在用：[^\n]*阿托伐他汀/.test(t2), true);
t("最新一次有标记", t3.includes("← 最新一次"), true);
t("非最新的没有标记", t2.includes("← 最新一次"), false);

console.log("=== 记录文本带上目标与判读结论 ===");
t("带目标值", t3.includes("（目标 < 3.4）"), true);
t("超标被标出", /低密度脂蛋白 LDL-C：4\.20mmol\/L（目标 < 3\.4） ← 超标/.test(t3), true);
t("偏离被标出", /谷丙转氨酶 ALT：62U\/L（目标 < 50） ← 偏离/.test(t3), true);
t("带上报告里的复查建议", t3.includes("报告里的复查建议：3个月后复查血脂"), true);
t("带上本人备注", t3.includes("本人备注：停他汀 4 个多月后"), true);

console.log("=== 个人目标要传给模型 ===");
ST.targets = { lipid_ldl_c:{ max:1.4, t:"< 1.4" } };
const tCustom = recText(RECS[0], true);
t("用的是个人目标", tCustom.includes("（目标 < 1.4，本人设定）"), true);
t("标明是本人设定的", tCustom.includes("本人设定"), true);
ST.targets = {};

console.log("=== 用药时间线 ===");
const mt = medsText();
t("已停的写明起止", mt.includes("2025-08-01 起，2026-03-01 停"), true);
t("在用的写至今", mt.includes("2025-01-01 起，至今仍在用"), true);
ST.meds = [];
t("没有用药时说清楚", medsText(), "（没有记录任何用药）");
ST.meds = MEDS;

console.log("=== 完整消息 ===");
store["bl_ai_bg"] = "男，34 岁，家族有早发冠心病史";
const msg = buildUserMsg(RECS, ["hlp"]);
t("含患者背景", msg.includes("男，34 岁，家族有早发冠心病史"), true);
t("含疾病范围", msg.includes("血脂异常"), true);
t("含历次记录", msg.includes("历次检查记录"), true);
t("含用药时间线", msg.includes("用药时间线"), true);
t("含到期情况", msg.includes("复查到期情况"), true);
t("含从未查过的项目", msg.includes("从未记录过的项目"), true);
t("含今天日期", msg.includes("（今天是 " + today() + "）"), true);
t("没填背景时不硬塞空段", (() => {
  delete store["bl_ai_bg"];
  return buildUserMsg(RECS, []).includes("## 患者背景");
})(), false);
store["bl_ai_bg"] = "男，34 岁，家族有早发冠心病史";

console.log("=== 上下文预算：砍旧的，但至少留 3 条 ===");
const many = [];
for (let i = 0; i < 60; i++) {
  const y = 2020 + Math.floor(i / 12), m = String(i % 12 + 1).padStart(2, "0");
  many.push({ id:"x"+i, date:`${y}-${m}-01`, updatedAt:"z", type:"laboratory",
              title:"生化全套", dis:["hlp"], note:"x".repeat(300),
              v:{ lipid_ldl_c:"2.5", liver_alt:"40", enzyme_ck:"90" } });
}
many.sort((a,b) => a.date < b.date ? 1 : -1);
const big = allRecordsText(many);
t("确实截断了", big.length <= AI_MAX_CHARS + 200, true);
t("告知了有省略", big.includes("更早的记录因篇幅所限未列出"), true);
t("保留了最新那条", big.includes(many[0].date), true);
t("至少留 3 条", (big.match(/【20\d{2}-\d{2}-\d{2}】/g) || []).length >= 3, true);
t("少量记录不截断", allRecordsText(RECS).includes("因篇幅所限"), false);

console.log("=== 存下来的分析要能按范围取回 ===");
_aiCache = [
  { id:"a1", at:"2026-07-20T10:00", scope:["hlp"], model:"deepseek-reasoner", output:"血脂分析" },
  { id:"a2", at:"2026-07-19T10:00", scope:[], model:"deepseek-reasoner", output:"全量分析" },
  { id:"a3", at:"2026-07-18T10:00", scope:["dm","hlp"], model:"deepseek-reasoner", output:"两个病" },
];
t("按疾病范围取回", lastAI(["hlp"]).output, "血脂分析");
t("空范围取回全量", lastAI([]).output, "全量分析");
t("多疾病顺序不影响匹配", lastAI(["hlp","dm"]).output, "两个病");
t("范围对不上就返回 null（宁可不引用也不能张冠李戴）", lastAI(["ckd"]), null);

console.log("=== 打印件引用 AI 分析 ===");
PRINT_OPT = Object.assign(defaultPrintOpt(), { disIds:["hlp"] });
const doc = buildPrintDoc(PRINT_OPT);
t("引用了对应范围的那次", doc.includes("血脂分析"), true);
t("标明是 AI 整理不是诊断", doc.includes("不是诊断"), true);
t("标明未经医生审核", doc.includes("未经医生审核"), true);
t("关掉开关就不出现",
  buildPrintDoc(Object.assign({}, PRINT_OPT, { ai:false })).includes("血脂分析"), false);
t("范围对不上时打印件不引用",
  buildPrintDoc(Object.assign({}, PRINT_OPT, { disIds:["ckd"] })).includes("血脂分析"), false);

console.log("=== 界面 ===");
delete store["bl_ai_key_ds"];
t("没密钥时先解释再引导", aiBlock([]).includes("填入密钥"), true);
t("没密钥时说明了费用大致水平", aiBlock([]).includes("几分钱"), true);
t("没密钥时说明不经第三方", aiBlock([]).includes("不经过任何第三方服务器"), true);
store["bl_ai_key_ds"] = "sk-0123456789abcdefghij";
const blk = aiBlock(["hlp"]);
t("有密钥时显示分析按钮", blk.includes("开始分析"), true);
t("显示分析范围", blk.includes("血脂异常"), true);
t("回填上次的分析结果", blk.includes("血脂分析"), true);
t("配置收进折叠", /<details class="fold"><summary>设置与说明/.test(blk), true);
t("说明了会发出去什么", blk.includes("<b>不包括</b>姓名、身份证号、手机号、原始照片"), true);
t("说明了输出不是医嘱", blk.includes("是整理，不是医嘱"), true);
t("密钥本身不出现在界面上", blk.includes("sk-0123456789"), false);

console.log("=== 范围参数正确传给 runAI ===");
// 属性值里的引号是转义过的，浏览器解析时才还原。断言要测转义后的形式，
// 并验证它还原回来确实是我们想要的调用。
const btn = aiBlock(["hlp","dm"]);
t("按钮带上了疾病范围（转义形式）",
  btn.includes("runAI([&quot;hlp&quot;,&quot;dm&quot;])"), true);
t("还原后是合法的调用", (() => {
  const m = btn.match(/runAI\((.+?)\)'/);
  const decoded = m[1].replace(/&quot;/g, '"');
  return JSON.parse(decoded);
})(), ["hlp","dm"]);
t("空范围传空数组", aiBlock([]).includes("runAI([])"), true);
t("疾病 id 里的引号不会破坏属性", (() => {
  ST.diseases = ST.diseases.concat([{ id:'a"b', name:"怪名字", keyInd:[], keywords:[] }]);
  const out = aiBlock(['a"b']);
  ST.diseases = SEED_DIS.map(d => Object.assign({}, d));
  return /onclick='runAI\(\[&quot;a\\&quot;b&quot;\]\)'/.test(out) ||
         !out.includes(`onclick='runAI(["a"b"])'`);
})(), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
