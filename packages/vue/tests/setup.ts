import { disableAutoUnmount, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, vi } from 'vitest';

vi.mock('fix-webm-duration', () => ({
  default: vi.fn(async (blob: Blob) => blob),
}));

disableAutoUnmount();
enableAutoUnmount(afterEach);
