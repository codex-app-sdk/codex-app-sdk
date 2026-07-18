import type { clipboard, dialog, shell } from 'electron';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  CodexNativeClipboard,
  CodexNativeDialog,
  CodexNativeShell,
} from '../src/electron';

describe('Electron native dependency type compatibility', () => {
  it('accepts Electron modules directly without host adapters', () => {
    expectTypeOf<typeof dialog>().toExtend<CodexNativeDialog>();
    expectTypeOf<typeof clipboard>().toExtend<CodexNativeClipboard>();
    expectTypeOf<typeof shell>().toExtend<CodexNativeShell>();
  });
});
