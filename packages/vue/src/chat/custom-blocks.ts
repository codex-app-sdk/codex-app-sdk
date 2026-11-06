import { inject, type Component, type InjectionKey } from 'vue'

/** Hosts render registered assistant fences. Components receive source, language and complete props. */
export type CodexCustomBlocks = Readonly<Record<string, Component>>
export const codexCustomBlocksKey: InjectionKey<CodexCustomBlocks> = Symbol.for('codex.custom-blocks')
export function useCodexCustomBlocks(): CodexCustomBlocks {
  return inject(codexCustomBlocksKey, {})
}
