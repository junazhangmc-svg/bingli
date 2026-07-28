// store.js 纯逻辑测试。运行：node test-store.js
// IDB 那一层不在这里测（不装 fake-indexeddb），靠手机实测。
// 这里覆盖的是「错了会静默丢数据」的那部分：投影、合并、备份往返、zip 字节。
require("./test-load").load(["data.js", "core.js", "store.js"]);

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

console.log("=== obs → v 投影 ===");
const obs = [
  { k:"lipid_ldl_c", val:"2.59", unit:"mmol/L" },
  { k:"liver_alt",   val:"62",   unit:"U/L"    },
  { k:"x:某院自创项", val:"3.1"                 },   // 未识别的不进 v
  { k:"urine_ketone", val:"阴性"                },
];
const p = projectV(obs);
t("只收字典认识的", Object.keys(p.v).sort(), ["lipid_ldl_c","liver_alt","urine_ketone"]);
t("值转成字符串", p.v.liver_alt, "62");
t("定性项也收", p.v.urine_ketone, "阴性");
t("没有重复", p.dup, []);

console.log("=== 重复项要报出来（多半是识别串行了）===");
const dupP = projectV([
  { k:"lipid_ldl_c", val:"2.59" },
  { k:"lipid_ldl_c", val:"1.30" },
]);
t("保留第一条", dupP.v.lipid_ldl_c, "2.59");
t("记下重复的键", dupP.dup, ["lipid_ldl_c"]);

console.log("=== 数值型里的非数字要挡掉 ===");
t("ALT 写成「未做」不进 v",
  Object.keys(projectV([{ k:"liver_alt", val:"未做" }]).v), []);
t("空值不进 v", Object.keys(projectV([{ k:"liver_alt", val:"" }]).v), []);
t("null 不进 v", Object.keys(projectV([{ k:"liver_alt", val:null }]).v), []);

console.log("=== v → obs 反推 ===");
const back = obsFromV({ lipid_ldl_c:"2.59", liver_alt:"62" });
t("两条", back.length, 2);
t("带上显示名", back.find(o => o.k === "lipid_ldl_c").name, "低密度脂蛋白 LDL-C");
t("带上单位", back.find(o => o.k === "liver_alt").unit, "U/L");
t("标记来源为手动", back[0].src, "manual");
t("空值不生成 obs", obsFromV({ liver_alt:"" }).length, 0);

console.log("=== 记录规整 ===");
const r1 = normalizeRecord({ date:"2026/7/28", type:"physical_exam",
                             title:"体检报告", v:{ lipid_ldl_c:"2.59" } });
t("日期归一", r1.date, "2026-07-28");
t("类型归一", r1.type, "checkup");
t("泛标题被重做", r1.title, "综合体检体检报告");
t("自动生成 id", /^rec_/.test(r1.id), true);
t("手动录入的 v 反推出了 obs", r1.obs.length, 1);
t("数组字段都有默认值", [r1.dis, r1.imgs, r1.manual, r1.bodyParts], [[],[],[],[]]);
t("有 createdAt 和 updatedAt", !!(r1.createdAt && r1.updatedAt), true);

const r2 = normalizeRecord({ date:"2026-07-28", type:"laboratory",
                             obs:[{ k:"liver_alt", val:"62" }] });
t("给了 obs 就据此算 v", r2.v.liver_alt, "62");

console.log("=== 复查日期在存储层算，不在录入表单里算 ===");
// 拍照识别出来的记录不经过录入表单，也必须拿到复查日期
const rr = normalizeRecord({ date:"2026-07-20", type:"laboratory",
                             recommendation:"建议3个月后复查血脂" });
t("算出了复查日期", rr.recheckDue, "2026-10-20");
t("留下了判断依据", /3个月/.test(rr.recheckBasis), true);
t("没有复查建议就不算", normalizeRecord({ date:"2026-07-20" }).recheckDue, undefined);
t("已有的复查日期不被覆盖",
  normalizeRecord({ date:"2026-07-20", recommendation:"3个月后复查",
                    recheckDue:"2026-12-25" }).recheckDue, "2026-12-25");
t("不改传进来的对象", (() => {
  const src = { date:"2026-07-28", v:{} };
  normalizeRecord(src);
  return Object.keys(src).sort();
})(), ["date","v"]);

console.log("=== 排序：日期倒序，同日按 updatedAt 倒序 ===");
const sorted = sortRecords([
  { id:"a", date:"2025-01-01", updatedAt:"2025-01-01T10:00" },
  { id:"c", date:"2026-07-20", updatedAt:"2026-07-20T09:00" },
  { id:"d", date:"2026-07-20", updatedAt:"2026-07-20T15:00" },
  { id:"b", date:"2026-01-04", updatedAt:"2026-01-04T10:00" },
]);
t("顺序正确", sorted.map(r => r.id), ["d","c","b","a"]);

console.log("=== 导入合并 ===");
const cur = [
  { id:"r1", date:"2026-07-20", title:"血脂八项", updatedAt:"2026-07-20T10:00" },
  { id:"r2", date:"2026-01-04", title:"生化全套", updatedAt:"2026-01-04T10:00" },
];
const m1 = mergeRecords(cur, [
  { id:"r1", date:"2026-07-20", title:"血脂八项", updatedAt:"2026-07-25T10:00" }, // 更新
  { id:"r3", date:"2025-06-15", title:"甲功五项", updatedAt:"2025-06-15T10:00" }, // 新增
  { id:"r2", date:"2026-01-04", title:"生化全套", updatedAt:"2025-01-01T10:00" }, // 更旧，跳过
]);
t("新增 1 条", m1.added, 1);
t("更新 1 条", m1.updated, 1);
t("跳过 1 条", m1.skipped, 1);
t("总数 3", m1.merged.length, 3);
t("更新的取了新版本", m1.merged.find(r => r.id === "r1").updatedAt, "2026-07-25T10:00");
t("结果是排好序的", m1.merged.map(r => r.date), ["2026-07-20","2026-01-04","2025-06-15"]);

console.log("=== 没有 id 时按 日期+标题 认同一条 ===");
const m2 = mergeRecords(cur, [
  { date:"2026-07-20", title:"血脂八项", updatedAt:"2026-07-30T10:00" },
]);
t("认出是同一条而非新增", m2.added, 0);
t("并且更新了它", m2.updated, 1);

console.log("=== 非法记录被跳过而不是写坏数据 ===");
const m3 = mergeRecords([], [
  { date:"乱写" }, null, { }, { date:"2026-07-28", title:"好的" },
]);
t("只留下合法的", m3.merged.length, 1);
t("其余计入 skipped", m3.skipped, 3);

console.log("=== 备份成形：图片二进制绝不进 JSON ===");
const shaped = shapeBackup({
  records:[{ id:"r1", date:"2026-07-28" }],
  images:[{ id:"i1", recId:"r1", seq:0, mime:"image/jpeg", bytes:301244,
            w:1200, h:1600, createdAt:"2026-07-28T10:00",
            blob:{ fake:"这是二进制，绝不能进 JSON" }, thumb:{ fake:"缩略图" } }],
});
t("有格式标识", shaped.format, "bingli-backup-1");
t("带上字典版本", shaped.dictVersion, DICT_VERSION);
t("图片只留清单", Object.keys(shaped.images[0]).sort(),
  ["bytes","createdAt","h","id","mime","recId","seq","w"]);
t("清单里没有 blob", "blob" in shaped.images[0], false);
t("清单里没有 thumb", "thumb" in shaped.images[0], false);
t("序列化后不含二进制痕迹", JSON.stringify(shaped).includes("绝不能进"), false);

console.log("=== 备份往返 ===");
const roundTrip = parseBackup(JSON.stringify(shapeBackup({
  records:[{ id:"r1", date:"2026-07-28", title:"甲功五项", updatedAt:"2026-07-28T10:00" }],
  diseases:[{ id:"thyca", name:"甲状腺癌术后" }],
  meds:[{ id:"m1", name:"某药", start:"2026-01-01", stop:null }],
  targets:{ lipid_ldl_c:{ max:1.4 } },
})));
t("识别为本 app 格式", roundTrip.kind, "native");
t("记录回来了", roundTrip.records[0].title, "甲功五项");
t("疾病回来了", roundTrip.diseases[0].id, "thyca");
t("用药回来了", roundTrip.meds[0].name, "某药");
t("个人目标回来了", roundTrip.targets.lipid_ldl_c.max, 1.4);

console.log("=== 坏文件要报错，不要静默吞掉 ===");
function threw(fn){ try { fn(); return false; } catch(e){ return e.message; } }
t("非 JSON", threw(() => parseBackup("不是json")), "这不是一个 JSON 文件");
t("陌生格式", threw(() => parseBackup('{"format":"别的app"}')), "不认识这个备份格式");
t("空数组", threw(() => parseBackup("[]")), "文件里没有可识别的记录");

console.log("=== 兼容导入父亲那个 app 的备份 ===");
const legacyFile = JSON.stringify([
  { date:"2026-07-20", v:{ ldl:"2.59", tsh:"3.79", alt:"62" }, note:"停药后复查" },
  { date:"2026-01-04", v:{ ldl:"1.30", apob:"0.52" }, note:"" },
  { date:"2025-01-15", v:{}, note:"手术记录" },
]);
const legacy = parseBackup(legacyFile);
t("识别为旧格式", legacy.kind, "legacy");
t("三条都在", legacy.records.length, 3);
t("ldl 映射到 canonicalKey", legacy.records[0].v.lipid_ldl_c, "2.59");
t("tsh 映射正确", legacy.records[0].v.thyroid_tsh, "3.79");
t("apob 映射正确", legacy.records[1].v.lipid_apob, "0.52");
t("备注保留", legacy.records[0].note, "停药后复查");
t("有数值的判为检验", legacy.records[0].type, "laboratory");
t("只有备注的判为其他", legacy.records[2].type, "other");
t("同时生成了 obs", legacy.records[0].obs.length, 3);
t("每条都有新 id", new Set(legacy.records.map(r => r.id)).size, 3);

console.log("=== 旧格式里认不出的键不能丢 ===");
const withUnknown = parseBackup(JSON.stringify([
  { date:"2026-07-20", v:{ ldl:"2.59", 某个旧键:"9.9" }, note:"原备注" },
]));
t("认识的进 v", withUnknown.records[0].v.lipid_ldl_c, "2.59");
t("不认识的不进 v", "某个旧键" in withUnknown.records[0].v, false);
t("但被写进了备注", /某个旧键=9\.9/.test(withUnknown.records[0].note), true);
t("原备注还在", /原备注/.test(withUnknown.records[0].note), true);

console.log("=== 父亲 app 的全部指标键都能映射 ===");
// 漏一个就是导入时静默丢一项数据
t("LEGACY_KEY 的目标都存在于字典",
  Object.keys(LEGACY_KEY).filter(k => !IND.some(i => i.k === LEGACY_KEY[k])), []);
// 父亲那个 app 里 IND 的全部 35 个 id。少一个 = 导入时静默丢一项数据。
const FATHER_IDS = [
  "hba1c","fpg","ldl","apob","tc","tg","hdl","alt","ast","ggt","tbil","cr",
  "urea","egfr","ua","k","na","hct","ket","upro",
  "tsh","ft4","tgn","tgab","ck","uacr",
  "cpep","ins","lpa",
  "caro","thyus","fund","ecg","neuro","lungct",
];
t("父亲 app 的每个 id 都有映射", FATHER_IDS.filter(k => !LEGACY_KEY[k]), []);
t("没有多余的映射", Object.keys(LEGACY_KEY).filter(k => !FATHER_IDS.includes(k)), []);
t("映射目标无重复（两个旧键指向同一个新键会覆盖数据）",
  Object.values(LEGACY_KEY).length, new Set(Object.values(LEGACY_KEY)).size);

console.log("=== CRC32 ===");
// 用已知向量校验，写错了 zip 会「看起来没问题」但解压时报损坏
t('"" 的 CRC', crc32(utf8("")), 0);
t('"a" 的 CRC', crc32(utf8("a")).toString(16), "e8b7be43");
t('"123456789" 的 CRC', crc32(utf8("123456789")).toString(16), "cbf43926");
t('"The quick brown fox jumps over the lazy dog"',
  crc32(utf8("The quick brown fox jumps over the lazy dog")).toString(16), "414fa339");

console.log("=== UTF-8 编码 ===");
t("ASCII", Array.from(utf8("ab")), [97,98]);
t("中文三字节", utf8("中").length, 3);
t("中文字节值", Array.from(utf8("中")), [228,184,173]);

console.log("=== ZIP 字节结构 ===");
const zip = zipStore([
  { name:"bingli.json", data:utf8('{"a":1}') },
  { name:"img/中文名.jpg", data:new Uint8Array([255,216,255,224]) },
]);
function u32at(b, i){ return b[i] | (b[i+1]<<8) | (b[i+2]<<16) | (b[i+3]<<24); }
function u16at(b, i){ return b[i] | (b[i+1]<<8); }
t("以本地文件头开始", u32at(zip, 0) >>> 0, 0x04034b50);
t("通用标志位开了 UTF-8（第 11 位）", u16at(zip, 6) & 0x0800, 0x0800);
t("压缩方法为 0（store）", u16at(zip, 8), 0);
t("压缩前后大小一致", u32at(zip, 18), u32at(zip, 22));
// 尾部 22 字节是 EOCD
const eocd = zip.length - 22;
t("有 EOCD 记录", u32at(zip, eocd) >>> 0, 0x06054b50);
t("EOCD 记录了 2 个条目", u16at(zip, eocd + 10), 2);
t("中央目录偏移落在文件内", u32at(zip, eocd + 16) < zip.length, true);
t("中央目录起始处是中央目录头",
  u32at(zip, u32at(zip, eocd + 16)) >>> 0, 0x02014b50);
t("空 zip 也是合法的", (() => {
  const z = zipStore([]);
  return z.length === 22 && (u32at(z, 0) >>> 0) === 0x06054b50;
})(), true);

console.log("=== localStorage 键不与父亲那个 app 相撞 ===");
const fs = require("fs");
const src = fs.readFileSync("store.js", "utf8");
t("全部用 bl_ 前缀", Object.values(LS).filter(k => !k.startsWith("bl_")), []);
t("源码里不出现 hm_ 前缀", /["']hm_/.test(src), false);
t("键无重复", Object.values(LS).length, new Set(Object.values(LS)).size);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
