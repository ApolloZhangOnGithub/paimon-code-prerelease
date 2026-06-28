// deploy/apply.js — 自动打所有 pi dist 补丁
const { execSync } = require("child_process");
const path = require("path");
const DEPLOY = __dirname;

const patches = [
  { name: "read-docs-ugly", script: "patch-pi-dist.js" },
];

console.log("pi-coding-master deploy");
for (const p of patches) {
  try {
    execSync(`node ${path.join(DEPLOY, p.script)}`, { stdio: "inherit" });
  } catch (e) {
    console.error(`ERROR ${p.name}: ${e.message}`);
  }
}
console.log("deploy done");
