#!/usr/bin/env node
// mobile-cli — Claude Code 用的 mobile 命令
// 用法: mobile [input]
const { execSync } = require("child_process");
const path = require("path");

const MOBILE_SCRIPT = path.join(__dirname, "mobile-runner.mjs");
const input = process.argv.slice(2).join(" ").trim();

try {
  const result = execSync(`node --experimental-transform-types ${JSON.stringify(MOBILE_SCRIPT)} ${JSON.stringify(input)}`, {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  process.stdout.write(result);
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) {
    const clean = e.stderr.split("\n").filter(l => !l.includes("ExperimentalWarning") && !l.includes("Reparsing")).join("\n").trim();
    if (clean) process.stderr.write(clean + "\n");
  }
}
