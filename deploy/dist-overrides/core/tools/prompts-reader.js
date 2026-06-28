// pi-coding-master 统一提示词读取器 — ESM 版本，供 dist-override JS 文件 import
// 用法：
//   import { getToolPrompt } from './prompts-reader.js';
//   const snippet = getToolPrompt('read', 'snippet');

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

let _cache = null;
const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadPrompts() {
  if (_cache) return _cache;
  // 生产路径：~/.pi/agent/extensions/pi-coding-master/prompts/prompts.json
  const prodPath = join(homedir(), '.pi', 'agent', 'extensions', 'pi-coding-master', 'prompts', 'prompts.json');
  try {
    _cache = JSON.parse(readFileSync(prodPath, 'utf-8'));
    return _cache;
  } catch {
    // 开发路径：Codebase/core/prompts/prompts.json
    try {
      const devPath = join(__dirname, '..', '..', '..', '..', '..', 'core', 'prompts', 'prompts.json');
      _cache = JSON.parse(readFileSync(devPath, 'utf-8'));
      return _cache;
    } catch {
      return null;
    }
  }
}

export function getToolPrompt(toolName, field) {
  const p = loadPrompts();
  return p?.tools?.[toolName]?.[field] ?? undefined;
}

export function getSystemTemplate() {
  return loadPrompts()?.system?.template ?? null;
}

export function getDnaPrompt(name) {
  return loadPrompts()?.dna?.[name] ?? null;
}

export function getProviderMessage(name) {
  return loadPrompts()?.provider?.[name] ?? null;
}

export function getVisionBridgePrompt() {
  return loadPrompts()?.vision?.bridgePrompt ?? null;
}

