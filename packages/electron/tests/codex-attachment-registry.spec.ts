import { describe, expect, it } from 'vitest';
import { CodexElectronAttachmentRegistry } from '../src';

describe('Codex Electron attachment registry', () => {
  it('keeps paths private while preserving image previews', () => {
    const registry = new CodexElectronAttachmentRegistry();
    const rendererAttachment = registry.register({
      type: 'image',
      path: '/trusted/image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 3,
      previewUrl: 'data:image/png;base64,cG5n',
    });

    expect(rendererAttachment).not.toHaveProperty('path');
    expect(rendererAttachment.previewUrl).toBe('data:image/png;base64,cG5n');
    expect(registry.resolve({
      type: 'image', reference: rendererAttachment.reference,
    })).toStrictEqual({
      type: 'image',
      path: '/trusted/image.png',
      name: 'image.png',
      mimeType: 'image/png',
      previewUrl: 'data:image/png;base64,cG5n',
    });
  });

  it('omits absent previews and never exposes a preview for file resolutions', () => {
    const registry = new CodexElectronAttachmentRegistry();
    const withoutPreview = registry.register({
      type: 'file', path: '/trusted/notes.md', name: 'notes.md', mimeType: 'text/markdown', size: 5,
    });
    expect(Object.hasOwn(withoutPreview, 'previewUrl')).toBe(false);
    expect(Object.hasOwn(registry.resolve({
      type: 'file', reference: withoutPreview.reference,
    }), 'previewUrl')).toBe(false);

    const fileWithUntrustedPreview = registry.register({
      type: 'file',
      path: '/trusted/archive.bin',
      name: 'archive.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      previewUrl: 'data:image/png;base64,cG5n',
    });
    expect(Object.hasOwn(registry.resolve({
      type: 'file', reference: fileWithUntrustedPreview.reference,
    }), 'previewUrl')).toBe(false);
  });

  it('rejects type confusion and expires references on clear', () => {
    const registry = new CodexElectronAttachmentRegistry();
    const attachment = registry.register({
      type: 'image', path: '/trusted/image.png', name: 'image.png', mimeType: 'image/png', size: 3,
    });

    expect(() => registry.resolve({
      type: 'file', reference: attachment.reference,
    })).toThrow('Attachment reference type does not match');
    registry.clear();
    expect(() => registry.path(attachment.reference)).toThrow('Attachment reference is invalid or expired');
  });
});
