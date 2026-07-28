// 测试用加载器：把浏览器端的传统 script 文件装进 Node 的全局作用域。
//
// 为什么要剥掉 "use strict"：严格模式下 eval 里的 var 不会泄漏到外层，
// 而这些文件在浏览器里本来就是靠全局变量互相引用的。剥掉指令前缀后
// 用间接 eval 执行，var 才会变成 globalThis 上的属性，跨文件引用才成立。
// 只影响测试环境；浏览器加载的是原文件，仍然是严格模式。
const fs = require("fs");
const path = require("path");

function loadInto(file){
  const full = path.join(__dirname, file);
  let src = fs.readFileSync(full, "utf8");
  src = src.replace(/^\s*["']use strict["'];?\s*/, "");
  (0, eval)(src);
}

/** 按依赖顺序加载。省略参数则加载全部数据与纯函数层。 */
function load(files){
  (files || ["data.js", "core.js"]).forEach(loadInto);
}

module.exports = { load, loadInto };
