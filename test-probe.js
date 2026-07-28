// 探针的对分逻辑测试。运行：node test-probe.js（在 bingli-app 目录下）
// 只测纯逻辑（score / summarize），网络和 canvas 部分靠手机实测。
const fs = require("fs");
const js = fs.readFileSync("probe.html", "utf8").split("<script>")[1].split("</script>")[0];

/* ---- 最小 DOM / 浏览器桩 ---- */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
  removeItem: k => { delete store[k]; },
};
const noop = () => {};
const gctx = () => new Proxy({}, { get: () => function(){} });
const els = {};
function stub(id){
  if (!els[id]) els[id] = { id, innerHTML:"", textContent:"", value:"", hidden:false,
    className:"", scrollTop:0, getContext:gctx, toDataURL:()=>"data:image/jpeg;base64,AAAA" };
  return els[id];
}
global.document = {
  getElementById: stub,
  createElement: () => ({ style:{}, select:noop, getContext:gctx,
    toDataURL:()=>"data:image/jpeg;base64,AAAA", width:0, height:0 }),
  body: { appendChild:noop, removeChild:noop },
};
global.getComputedStyle = () => ({ fontFamily:"sans-serif" });
global.window = { matchMedia: () => ({ matches:false }), navigator:{}, isSecureContext:false };
global.location = { origin:"https://x.github.io", protocol:"https:" };
global.navigator = { onLine:true };
global.fetch = async () => ({ ok:true, status:200, text: async () => "{}" });
global.AbortController = class { constructor(){ this.signal = {}; } abort(){} };
global.Image = class {};
global.FileReader = class {};

eval(js + "\n;module.exports={score,RESULTS,EXPECT,summarize};");
const M = module.exports;

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

const perfect = JSON.stringify({ observations:[
  { itemName:"谷丙转氨酶 ALT",      resultText:"62",   unit:"U/L",    abnormalFlag:"high" },
  { itemName:"低密度脂蛋白 LDL-C",  resultText:"2.59", unit:"mmol/L", abnormalFlag:null   },
  { itemName:"糖化血红蛋白 HbA1c",  resultText:"6.4",  unit:"%",      abnormalFlag:"high" },
], observationCount:3 });

console.log("=== 完美答案 ===");
M.score("zhipu", perfect, 5000);
t("三项全中", M.RESULTS.zhipu.acc, "3/3 关键值命中");

console.log("=== 串行：ALT 拿到了隔壁行的值 ===");
// 这是最危险的错误模式：项目名对、数值来自相邻行
const shifted = JSON.stringify({ observations:[
  { itemName:"谷丙转氨酶 ALT",     resultText:"31"   },
  { itemName:"低密度脂蛋白 LDL-C", resultText:"2.59" },
  { itemName:"糖化血红蛋白 HbA1c", resultText:"6.4"  },
], observationCount:3 });
M.score("ark", shifted, 5000);
t("检出串行",     /ALT 疑似串行/.test(M.RESULTS.ark.acc), true);
t("命中降为 2/3", /^2\/3/.test(M.RESULTS.ark.acc), true);

console.log("=== 模型自报条数与实际不符 ===");
M.score("silicon", perfect.replace('"observationCount":3', '"observationCount":8'), 5000);
t("检出计数不一致", /自报 8 条实际 3 条/.test(M.RESULTS.silicon.acc), true);

console.log("=== 完全没读懂 ===");
M.score("step", "抱歉，我无法识别这张图片。", 5000);
t("零命中", /^0\/3/.test(M.RESULTS.step.acc), true);

console.log("=== 汇总表 ===");
M.summarize();
const h = els["sum"].innerHTML;
t("四家都出现在表里", ["智谱","火山方舟","硅基流动","阶跃星辰"].filter(s => h.indexOf(s) < 0), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
