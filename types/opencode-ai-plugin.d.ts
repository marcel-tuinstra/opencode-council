declare module "@opencode-ai/plugin" {
  // OpencodeClient session methods (what we need)
  export interface OpencodeSessionClient {
    create(opts: { body?: { parentID?: string; title?: string }; query?: { directory?: string } }): Promise<{ data: { id: string; [key: string]: any } }>;
    promptAsync(opts: { path: { id: string }; body?: { system?: string; agent?: string; parts: Array<{ type: string; text?: string; [key: string]: any }> } }): Promise<void>;
    status(opts: { query?: { directory?: string } }): Promise<{ data: any }>;
    abort(opts: { path: { id: string } }): Promise<void>;
    children(opts: { path: { id: string } }): Promise<{ data: any[] }>;
    messages(opts: { path: { id: string } }): Promise<{ data: any[] }>;
    get(opts: { path: { id: string } }): Promise<{ data: any }>;
  }

  export interface OpencodeClient {
    session: OpencodeSessionClient;
    [key: string]: any;
  }

  export interface PluginInput {
    client: OpencodeClient;
    project: any;
    directory: string;
    worktree: string;
    serverUrl: URL;
    $: any;
  }

  export interface ToolContext {
    sessionID: string;
    messageID: string;
    agent: string;
    directory: string;
    worktree: string;
    abort: AbortSignal;
    metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
    ask(input: { message: string; allow?: string; deny?: string }): Promise<void>;
  }

  export interface ToolDefinition {
    // opaque — created by tool() helper
    [key: string]: any;
  }

  export function tool<T extends Record<string, any>>(input: {
    description: string;
    args: T;
    execute(args: any, context: ToolContext): Promise<string>;
  }): ToolDefinition;

  // Tool schema helpers
  export namespace tool {
    export const schema: {
      string(): { describe(d: string): any; optional(): { describe(d: string): any } };
      number(): { describe(d: string): any; optional(): { describe(d: string): any } };
      boolean(): { describe(d: string): any; optional(): { describe(d: string): any } };
    };
  }

  export interface Hooks {
    "tui.prompt.append"?: (input: { input: string }) => Promise<string | void> | string | void;
    "experimental.chat.messages.transform"?: (input: any, output: any) => Promise<void> | void;
    "experimental.chat.system.transform"?: (input: any, output: any) => Promise<void> | void;
    "tool.execute.before"?: (input: any) => Promise<any> | any;
    "experimental.text.complete"?: (input: any, output: any) => Promise<void> | void;
    event?: (input: { event: any }) => Promise<void> | void;
    tool?: Record<string, ToolDefinition>;
    [key: string]: any;
  }

  export type Plugin = (input: PluginInput) => Promise<Hooks>;
}
