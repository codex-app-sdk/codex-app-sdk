import type { CodexAppServerClient } from '../codex/index';

/** Resolve through app-server so profiles, managed policy, CLI and cwd layers retain their native precedence. */
export async function configuredModelProvider(client: CodexAppServerClient, cwd?: string): Promise<string> {
  const { config } = await client.request('config/read', { includeLayers: false, ...(cwd ? { cwd } : {}) });
  return config.model_provider ?? 'openai';
}
