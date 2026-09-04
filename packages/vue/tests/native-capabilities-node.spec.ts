// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  getCodexGlobalHostCapabilities,
  getCodexNativeRendererApi,
} from '../src/native-capabilities';

describe('native renderer capabilities outside a browser', () => {
  it('reports no global host capabilities during server-side rendering', () => {
    expect(getCodexGlobalHostCapabilities()).toBeUndefined();
    expect(getCodexNativeRendererApi()).toBeUndefined();
  });
});
