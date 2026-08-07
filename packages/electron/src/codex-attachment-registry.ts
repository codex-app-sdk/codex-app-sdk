import { randomUUID } from 'node:crypto';
import type { CodexHostAttachment } from '@codex-app-sdk/core/native';
import type {
  CodexRendererAttachment,
  CodexSurfaceAttachment,
} from '@codex-app-sdk/core/surface';

export type CodexElectronAttachmentRegistration = {
  type: CodexHostAttachment['type'];
  path: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};

type RegisteredAttachment = Omit<CodexElectronAttachmentRegistration, 'previewUrl' | 'size'>;

/** Keeps trusted local paths out of the renderer and scopes references to one Electron integration. */
export class CodexElectronAttachmentRegistry {
  readonly #attachments = new Map<string, RegisteredAttachment>();

  register(input: CodexElectronAttachmentRegistration): CodexHostAttachment {
    const reference = `electron-attachment:${randomUUID()}`;
    this.#attachments.set(reference, {
      type: input.type,
      path: input.path,
      name: input.name,
      mimeType: input.mimeType,
    });
    return {
      id: reference,
      reference,
      type: input.type,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      ...(input.previewUrl === undefined ? {} : { previewUrl: input.previewUrl }),
    };
  }

  resolve(attachment: CodexRendererAttachment): CodexSurfaceAttachment {
    const registered = this.#registered(attachment.reference);
    if (registered.type !== attachment.type) {
      throw new TypeError('Attachment reference type does not match');
    }
    return {
      type: registered.type,
      path: registered.path,
      name: registered.name,
      mimeType: registered.mimeType,
    };
  }

  path(reference: string): string {
    return this.#registered(reference).path;
  }

  clear(): void {
    this.#attachments.clear();
  }

  #registered(reference: string): RegisteredAttachment {
    const attachment = this.#attachments.get(reference);
    if (!attachment) throw new TypeError('Attachment reference is invalid or expired');
    return attachment;
  }
}
