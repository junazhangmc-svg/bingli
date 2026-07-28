// 打印件测试。运行：node test-print.js
// 最要紧的两条：
//   1. 黑白打印后异常还必须认得出来（颜色全没了）
//   2. 表格的行是疾病的核心项目，不是「所有出现过的项目」
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
global.setTimeout = () => 0;

require("./test-load").loadInto("store.js");
["openDB","seedOnce","requestPersist"].forEach(n => { global[n] = () => Promise.resolve(); });
global.loadRecords = () => Promise.resolve([]);
global.loadDiseases = () => Promise.resolve([]);
global.loadMeds = () => Promise.resolve([]);
global.loadTargets = () => Promise.resolve({});
global.storageInfo = () => Promise.resolve({ supported:false });
require("./test-load").loadInto("print.js");
require("./test-load").loadInto("app.js");

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

/* ---------- 固定数据：一段有真实感的血脂随访 ---------- */
const RECS = [
  { id:"r4", date:"2026-07-20", updatedAt:"d", type:"laboratory", title:"血脂八项",
    hospital:"某医院", dept:"心内科", dis:["hlp"], note:"停他汀 4 个月后",
    impression:"低密度脂蛋白升高", recommendation:"3个月后复查血脂",
    v:{ lipid_ldl_c:"4.20", lipid_apob:"1.15", lipid_tc:"5.80", lipid_hdl_c:"0.92" } },
  { id:"r3", date:"2026-01-04", updatedAt:"c", type:"laboratory", title:"生化全套",
    dis:["hlp"], note:"", v:{ lipid_ldl_c:"1.30", lipid_apob:"0.52",
                              lipid_tc:"3.40", enzyme_ck:"82.9" } },
  { id:"r2", date:"2025-09-26", updatedAt:"b", type:"laboratory", title:"血脂四项",
    dis:["hlp"], note:"", v:{ lipid_ldl_c:"1.29", lipid_tc:"3.30" } },
  { id:"r1", date:"2025-06-15", updatedAt:"a", type:"imaging", title:"甲状腺超声",
    dis:["thyca"], note:"", v:{ us_thyroid_bed:"正常" } },
];
const MEDS = [
  { id:"m1", name:"阿托伐他汀钙片", dose:"20mg", freq:"每晚一次",
    start:"2025-08-01", stop:"2026-03-01", dis:["hlp"] },
  { id:"m2", name:"二甲双胍", dose:"0.5g", freq:"每日两次",
    start:"2025-01-01", stop:null, dis:["dm"] },
];
ST.records = RECS;
ST.diseases = SEED_DIS.map(d => Object.assign({}, d));
ST.meds = MEDS;
ST.targets = {};
ST.ready = true;

const OPT = Object.assign(defaultPrintOpt(), { disIds:["hlp"] });

console.log("=== 取数 ===");
t("只取打了该疾病标签的", printRecords(OPT).map(r => r.id), ["r4","r3","r2"]);
t("不选疾病时取全部", printRecords(defaultPrintOpt()).length, 4);
t("时间下限生效",
  printRecords(Object.assign({}, OPT, { from:"2026-01-01" })).map(r => r.id), ["r4","r3"]);
t("时间上限生效",
  printRecords(Object.assign({}, OPT, { to:"2025-12-31" })).map(r => r.id), ["r2"]);
t("结果是日期倒序", printRecords(OPT)[0].date, "2026-07-20");

console.log("=== 表格的行 = 疾病的核心项目，且按 keyInd 顺序 ===");
const rows = printRows(OPT, printRecords(OPT));
t("首行是血脂的第一核心项", rows[0], "lipid_ldl_c");
t("顺序跟随 keyInd", rows.slice(0, 3), ["lipid_ldl_c","lipid_apob","lipid_tc"]);
t("从未测过的核心项不占行", rows.includes("lipid_lpa"), false);
t("测过的都在", rows.includes("lipid_hdl_c") && rows.includes("enzyme_ck"), true);
t("不掺进别的病的项目", rows.includes("us_thyroid_bed"), false);

console.log("=== 不选疾病时按字典顺序，不按出现顺序 ===");
const allRows = printRows(defaultPrintOpt(), printRecords(defaultPrintOpt()));
const dictOrder = IND.map(i => i.k).filter(k => allRows.includes(k));
t("与字典顺序一致", allRows, dictOrder);

console.log("=== 列：最新在右 ===");
const cols = printCols(printRecords(OPT), rows);
t("三个日期", cols.dates.length, 3);
t("最早在左", cols.dates[0], "2025-09-26");
t("最新在右", cols.dates[cols.dates.length - 1], "2026-07-20");
t("没有省略", cols.omitted, 0);

console.log("=== 列数超上限时保留最早一次和最近若干次 ===");
const many = [];
for (let i = 0; i < 20; i++) {
  const y = 2020 + Math.floor(i / 12), m = String(i % 12 + 1).padStart(2, "0");
  many.push({ id:"x"+i, date:`${y}-${m}-01`, updatedAt:"z", type:"laboratory",
              dis:["hlp"], v:{ lipid_ldl_c:String(2 + i / 10) } });
}
many.sort((a,b) => a.date < b.date ? 1 : -1);
const c2 = printCols(many, ["lipid_ldl_c"]);
t("不超过上限", c2.dates.length, MAX_COLS);
t("保留了最早一次（基线不能丢）", c2.dates[0], many[many.length-1].date);
t("保留了最近一次", c2.dates[c2.dates.length-1], many[0].date);
t("报出省略了几次", c2.omitted, 20 - MAX_COLS);
t("报出总次数", c2.total, 20);

console.log("=== 取值 ===");
const rs = printRecords(OPT);
t("取到对应日期的值", valOn(rs, "2026-07-20", "lipid_ldl_c"), "4.20");
t("没测的返回 null", valOn(rs, "2025-09-26", "lipid_apob"), null);

console.log("=== 黑白打印：异常必须不靠颜色也能看出来 ===");
const ldl = indByKey("lipid_ldl_c");   // 人群上限 3.4
t("达标值只有数字", cellHtml(ldl, "1.30"), "1.30");
t("超标带 p-abn 类（4.20 超出 3.4 的 15% 带）", /class="p-abn"/.test(cellHtml(ldl, "4.20")), true);
t("超标带向上箭头", /↑/.test(cellHtml(ldl, "4.20")), true);
t("轻度偏离加粗", /font-weight:600/.test(cellHtml(ldl, "3.50")), true);
t("轻度偏离也带箭头", /↑/.test(cellHtml(ldl, "3.50")), true);
const hdl = indByKey("lipid_hdl_c");   // 下限 1.0
t("低于下限带向下箭头", /↓/.test(cellHtml(hdl, "0.92")), true);
t("未测显示破折号", /—/.test(cellHtml(ldl, null)), true);
t("定性项异常也有标记", /!/.test(cellHtml(indByKey("urine_protein"), "2+")), true);
// 这条最关键：颜色被剥掉后，异常和达标必须仍然长得不一样
function stripColor(s){ return s.replace(/style="[^"]*"/g, "").replace(/class="[^"]*"/g, ""); }
t("剥掉所有颜色后超标与达标仍可区分",
  stripColor(cellHtml(ldl, "4.20")) !== stripColor(cellHtml(ldl, "1.30")), true);

console.log("=== 个人目标要影响打印件的判读 ===");
ST.targets = { lipid_ldl_c:{ max:1.4, t:"< 1.4", w:"极高危" } };
t("1.30 在个人目标下仍达标", cellHtml(ind("lipid_ldl_c"), "1.30"), "1.30");
t("1.60 在个人目标下变成超标", /p-abn/.test(cellHtml(ind("lipid_ldl_c"), "1.70")), true);
const docT = buildPrintDoc(OPT);
t("表头标注了这是个人目标", docT.includes("（个人）"), true);
t("显示的是个人目标值而非字典值", docT.includes("目标 &lt; 1.4"), true);
ST.targets = {};

console.log("=== 完整文档 ===");
const doc = buildPrintDoc(OPT);
t("有封面", doc.includes("历次检查汇总"), true);
t("封面写了疾病名", doc.includes("血脂异常"), true);
t("封面写了时间跨度", doc.includes("2025-09-26 至 2026-07-20"), true);
t("封面写了记录条数", doc.includes("共 3 次记录"), true);
t("有趋势表", doc.includes("关键指标"), true);
t("表头会在第二页重复（靠 thead 标签）", doc.includes("<thead>"), true);
t("有图例说明箭头含义", doc.includes("↑ 高于目标"), true);
t("有用药表", doc.includes("阿托伐他汀钙片"), true);
t("有逐次记录", doc.includes("逐次记录"), true);
t("有指标说明尾注", doc.includes("指标说明"), true);
t("有免责声明", doc.includes("请以医院原始报告为准"), true);
t("声明了判读依据是本人设置的目标", doc.includes("本人设置的目标值"), true);

console.log("=== 用药与检查日期的对应（医生真正想看的）===");
t("有「每次检查时正在服用」", doc.includes("每次检查时正在服用"), true);
// 2026-01-04 在他汀期间（2025-08-01 至 2026-03-01）
t("2026-01-04 标出在吃他汀",
  /2026-01-04<\/span>　[^<]*阿托伐他汀/.test(doc), true);
// 2026-07-20 已停药 4 个多月
t("2026-07-20 不再标他汀",
  /2026-07-20<\/span>　[^<]*阿托伐他汀/.test(doc), false);
t("停药后仍标出还在吃的二甲双胍",
  /2026-07-20<\/span>　[^<]*二甲双胍/.test(doc), true);

console.log("=== 分段开关 ===");
t("关掉趋势表", buildPrintDoc(Object.assign({}, OPT, { trend:false })).includes("↑ 高于目标"), false);
t("关掉用药", buildPrintDoc(Object.assign({}, OPT, { meds:false })).includes("阿托伐他汀"), false);
t("关掉逐次记录", buildPrintDoc(Object.assign({}, OPT, { visits:false })).includes("逐次记录"), false);
t("关掉尾注", buildPrintDoc(Object.assign({}, OPT, { notes:false })).includes("指标说明"), false);
t("免责声明关不掉", buildPrintDoc(Object.assign({}, OPT,
  { trend:false, meds:false, visits:false, notes:false, ai:false }))
  .includes("请以医院原始报告为准"), true);

console.log("=== 逐次记录里异常排在前面 ===");
const v = buildPrintDoc(Object.assign({}, OPT, { trend:false, meds:false, notes:false }));
t("异常项单独成段", v.includes("需关注："), true);
t("异常项带 p-abn", /需关注：[\s\S]{0,200}p-abn/.test(v), true);
t("正常项归到「其余正常」", v.includes("其余正常："), true);

console.log("=== 尾注只解释这份材料用到的指标 ===");
const notes = buildPrintDoc(Object.assign({}, OPT,
  { trend:true, meds:false, visits:false, ai:false, notes:true }));
t("解释了 LDL", notes.includes("降脂治疗唯一的主要靶点"), true);
t("不解释没出现的甲状腺项目", notes.includes("甲状腺球蛋白"), false);

console.log("=== 空结果不崩 ===");
t("没有匹配记录时给提示",
  buildPrintDoc(Object.assign({}, OPT, { from:"2030-01-01" })).includes("没有记录"), true);
t("疾病选了但一条没有也不崩",
  typeof buildPrintDoc(Object.assign({}, OPT, { disIds:["gout"] })), "string");

console.log("=== 转义 ===");
ST.records = [{ id:"z", date:"2026-07-20", updatedAt:"z", type:"laboratory",
  title:'<img src=x onerror=alert(1)>', hospital:'"><b>x</b>', dis:["hlp"],
  note:"<script>bad</" + "script>", impression:"<b>结论</b>",
  v:{ lipid_ldl_c:"4.20" } }];
const esc = buildPrintDoc(OPT);
t("标题被转义", esc.includes("&lt;img src=x"), true);
t("没有真的 img 标签", /<img /.test(esc), false);
t("备注被转义", esc.includes("&lt;script&gt;"), true);
t("结论里的标签也被转义", esc.includes("&lt;b&gt;结论"), true);
ST.records = RECS;

console.log("=== 渲染打印页 ===");
renderPrint();
const page = els["v-print"].innerHTML;
t("列出有记录的疾病", page.includes("血脂异常（3）"), true);
t("不列没有记录的疾病", page.includes("痛风 · 高尿酸（"), false);
t("有分段开关", page.includes("关键指标趋势表"), true);
t("有打印按钮", page.includes("打印 / 存成 PDF"), true);
t("有导出 HTML", page.includes("导出 HTML"), true);
t("带预览而不是盲打", page.includes("下面就是要打印的内容"), true);
t("告诉用户怎么存 PDF", page.includes("另存为 PDF"), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
