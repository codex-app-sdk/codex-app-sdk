import { describe, expect, it } from 'vitest';
import { codexNativeRendererGlobal } from '../src/native';

describe('native host contract', () => {
  it('uses the stable renderer global name', () => {
    expect(codexNativeRendererGlobal).toBe('codexAppSdkNative');
  });
});
