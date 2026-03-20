declare module "@opencode-ai/plugin" {
  export type PluginHook = (...args: any[]) => unknown | Promise<unknown>;

  export type Plugin = () => Promise<Record<string, PluginHook>>;
}
