// paimon naming → pi naming compatibility layer
// Ambient module declarations allow paimon naming conventions (messageDescription,
// messageType, label) to coexist alongside pi types. The paimon codebase was
// written with these conventions and is NOT expected to match the pi SDK
// types exactly at compile time — runtime mapping handles the translation.

// =========================================================================
// @mariozechner/pi-coding-agent — ambient module with paimon extensions
// =========================================================================
declare module "@mariozechner/pi-coding-agent" {
  // Re-export all the types actually imported by paimon source code
  export type ExtensionAPI = any;
  export type ExtensionContext = any;
  export type ExtensionContextActions = any;
  export type AgentToolUpdateCallback<T = any> = (update: T) => void;
  export type AgentToolResult<T = any> = { content: { type: string; text: string }[]; details?: T };
  export type ExtensionCommandContext = any;
  export type ExtensionCommandContextActions = any;
  export type MessageRenderer = any;
  export type MessageRenderOptions = any;

  // Tool definitions — accept paimon naming (messageDescription, label)
  // alongside standard pi naming (description)
  export interface ToolDefinition<
    TSchema = any,
    TOutput = any,
    TUpdate = any,
    TToolCallId = string,
    TSignal = AbortSignal,
    TCtx = any,
  > {
    name: string;
    description?: string;
    /** paimon convention: same as description */
    messageDescription?: string;
    /** paimon convention: unique label identifier */
    label?: string;
    promptSnippet?: string;
    parameters: TSchema;
    execute(
      toolCallId: TToolCallId,
      params: any,
      signal?: TSignal,
      onUpdate?: AgentToolUpdateCallback<TUpdate>,
      ctx?: TCtx,
    ): Promise<AgentToolResult<TOutput>>;
    renderCall?(args: any, theme: any, ctx?: any): any;
    renderResult?(args: any, theme: any): any;
  }

  export interface ToolInfo {
    name: string;
    description?: string;
    messageDescription?: string;
    label?: string;
    promptSnippet?: string;
    parameters?: any;
  }

  export interface RegisteredCommand {
    name: string;
    description?: string;
    messageDescription?: string;
    label?: string;
    sourceInfo?: any;
    handler?: any;
    promptSnippet?: string;
    parameters?: any;
    execute?: any;
  }

  export interface RegisteredTool extends ToolInfo {}

  export interface CustomMessage<T = unknown> {
    role: "custom";
    /** pi convention: custom message type */
    customType: string;
    /** paimon convention: same as customType */
    messageType?: string;
    content: string | { type: string; text?: string; [key: string]: any }[];
    /** pi convention: whether to display in TUI */
    display: boolean;
    /** paimon convention: same as display */
    isDisplayedInTUI?: boolean;
    details?: T;
    timestamp: number;
  }

  export interface SendMessageOptions {
    /** pi convention: whether to trigger a new turn */
    triggerTurn?: boolean;
    /** paimon convention: same as triggerTurn */
    isTriggerNewTurn?: boolean;
  }

  // Functions imported by paimon
  export function getMarkdownTheme(): any;
  export function isBashToolResult(event: any): boolean;
  export function isToolCallEventType(toolName: string, event: any): boolean;
}

// =========================================================================
// paimon global runtime variables (augment globalThis)
// =========================================================================
declare global {
  var __paimonPersonId: string;
  var __paimonPersonName: string;
  var __paimonPersonDir: string;
  var __paimonRuntimeDir: string;
  var __paimonChannelDir: string;
  var __paimonSessionDir: string;
  var __paimonAgentFileDir: string;
  var __ls_dir: string;
  // pi-runtime globals set by paimon
  var __piAbort: (() => void) | undefined;
  var __piRecapPending: boolean | undefined;
  var __piWatcher: any;
  var __piEscJustPressed: boolean | undefined;
  var __notificationPush: ((message: any) => void) | undefined;
}
