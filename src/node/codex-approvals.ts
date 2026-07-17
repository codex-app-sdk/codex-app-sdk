import type { CodexAppServerClient, v2 } from '../codex/index';
import type {
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
} from '../surface/types';

export type PendingCodexApproval = {
  approval: CodexSurfaceApproval;
  resolve(decision: CodexSurfaceApprovalDecision, scope: CodexSurfaceApprovalScope): void;
};

export function registerCodexApprovalHandlers(
  client: CodexAppServerClient,
  onApproval: (pending: PendingCodexApproval) => void,
): () => void {
  const unsubscribers = [
    client.onServerRequest('item/commandExecution/requestApproval', (request, responder) => {
      onApproval({
        approval: commandApproval(request.id, request.params),
        resolve: (decision, scope) => responder.resolve({
          decision: decision === 'deny' ? 'decline' : scope === 'session' ? 'acceptForSession' : 'accept',
        }),
      });
      return true;
    }),
    client.onServerRequest('item/fileChange/requestApproval', (request, responder) => {
      onApproval({
        approval: fileChangeApproval(request.id, request.params),
        resolve: (decision, scope) => responder.resolve({
          decision: decision === 'deny' ? 'decline' : scope === 'session' ? 'acceptForSession' : 'accept',
        }),
      });
      return true;
    }),
    client.onServerRequest('item/permissions/requestApproval', (request, responder) => {
      onApproval({
        approval: permissionsApproval(request.id, request.params),
        resolve: (decision, scope) => responder.resolve({
          permissions: decision === 'deny' ? {} : {
            ...(request.params.permissions.fileSystem ? { fileSystem: request.params.permissions.fileSystem } : {}),
            ...(request.params.permissions.network ? { network: request.params.permissions.network } : {}),
          },
          scope: scope === 'session' ? 'session' : 'turn',
        }),
      });
      return true;
    }),
    client.onServerRequest('execCommandApproval', (request, responder) => {
      onApproval({
        approval: {
          id: String(request.id),
          kind: 'command',
          conversationId: request.params.conversationId,
          itemId: request.params.callId,
          title: 'Run command',
          command: request.params.command.join(' '),
          cwd: request.params.cwd,
          ...(request.params.reason ? { description: request.params.reason } : {}),
        },
        resolve: (decision, scope) => responder.resolve({
          decision: decision === 'deny' ? 'denied' : scope === 'session' ? 'approved_for_session' : 'approved',
        }),
      });
      return true;
    }),
    client.onServerRequest('applyPatchApproval', (request, responder) => {
      onApproval({
        approval: {
          id: String(request.id),
          kind: 'file-change',
          conversationId: request.params.conversationId,
          itemId: request.params.callId,
          title: 'Apply file changes',
          ...((request.params.reason || request.params.grantRoot) ? {
            description: request.params.reason ?? `Write under ${request.params.grantRoot}`,
          } : {}),
        },
        resolve: (decision, scope) => responder.resolve({
          decision: decision === 'deny' ? 'denied' : scope === 'session' ? 'approved_for_session' : 'approved',
        }),
      });
      return true;
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

function commandApproval(
  id: string | number,
  params: v2.CommandExecutionRequestApprovalParams,
): CodexSurfaceApproval {
  return {
    id: String(id),
    kind: 'command',
    conversationId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    title: 'Run command',
    command: params.command ?? undefined,
    cwd: params.cwd ?? undefined,
    ...(params.reason ? { description: params.reason } : {}),
  };
}

function fileChangeApproval(
  id: string | number,
  params: v2.FileChangeRequestApprovalParams,
): CodexSurfaceApproval {
  return {
    id: String(id),
    kind: 'file-change',
    conversationId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    title: 'Apply file changes',
    ...((params.reason || params.grantRoot) ? {
      description: params.reason ?? `Write under ${params.grantRoot}`,
    } : {}),
  };
}

function permissionsApproval(
  id: string | number,
  params: v2.PermissionsRequestApprovalParams,
): CodexSurfaceApproval {
  return {
    id: String(id),
    kind: 'permissions',
    conversationId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    title: 'Grant additional permissions',
    description: params.reason ?? 'Codex requested additional access for this task.',
    cwd: params.cwd,
  };
}
