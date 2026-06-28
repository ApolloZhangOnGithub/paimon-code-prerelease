// pi-coding-master 统一提示词档案 — TypeScript 入口
// 所有提示词集中在 prompts.json，此文件导出类型安全的常量供 .ts 文件使用。
// JS 文件（dist-override 等）请用 prompts-reader.js 读取。

import prompts from "./prompts.json" with { type: "json" };

export type Prompts = typeof prompts;
export const P = prompts as Prompts;

// ---- 工具提示词 ----
export const TOOL_BASH_SNIPPET = P.tools.bash.snippet;
export const TOOL_BASH_DESC = P.tools.bash.messageDescription;

export const TOOL_EDIT_SNIPPET = P.tools.edit.snippet;

export const TOOL_FIND_SNIPPET = P.tools.find.snippet;
export const TOOL_FIND_DESC = P.tools.find.messageDescription;

export const TOOL_GREP_SNIPPET = P.tools.grep.snippet;
export const TOOL_GREP_DESC = P.tools.grep.messageDescription;

export const TOOL_LS_SNIPPET = P.tools.ls.snippet;
export const TOOL_LS_DESC = P.tools.ls.messageDescription;

export const TOOL_READ_SNIPPET = P.tools.read.snippet;
export const TOOL_READ_DESC = P.tools.read.messageDescription;
export const TOOL_READ_GUIDELINES = P.tools.read.guidelines;

export const TOOL_WRITE_SNIPPET = P.tools.write.snippet;
export const TOOL_WRITE_GUIDELINES = P.tools.write.guidelines;

// ---- 系统提示词模板 ----
export const SYSTEM_TEMPLATE = P.system.template;

// ---- Provider 文本 ----
export const ATTACHED_IMAGE_PREFIX = P.provider.attachedImagePrefix;
export const PROCESSED_TOOL_RESULTS = P.provider.processedToolResults;

// ---- 视觉桥接 ----
export const VISION_BRIDGE_PROMPT = P.vision.bridgePrompt;

// ---- DNA 提示词（原 coded.dna） ----
// 各器官通过 runtime.getPrompt(name) 读取，直接引用 P.dna[name] 也可。
export const DNA = P.dna;
