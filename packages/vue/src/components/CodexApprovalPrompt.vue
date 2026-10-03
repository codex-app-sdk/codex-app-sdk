<template>
  <ChatApprovalCard
    class="codex-approval-prompt"
    role="status"
    :summary="approval.title"
    :description="approval.description"
    :actions="actions"
    :disabled="disabled"
    @decide="decide"
  >
    <template v-if="approval.command || approval.cwd || approval.requestedPermissions?.length" #details>
      <div class="codex-approval-prompt__details">
        <code v-if="approval.command">{{ approval.command }}</code>
        <small v-if="approval.cwd">{{ approval.cwd }}</small>
        <ul v-if="approval.requestedPermissions?.length" aria-label="Requested permissions">
          <li v-for="(permission, index) in approval.requestedPermissions" :key="index">
            {{ permissionLabel(permission) }}
          </li>
        </ul>
      </div>
    </template>
  </ChatApprovalCard>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ChatApprovalCard from '../chat/ChatApprovalCard.vue';
import type {
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceRequestedPermission,
} from '@codex-app-sdk/core/surface';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  approval: CodexSurfaceApproval;
  disabled?: boolean;
}>(), {
  disabled: false,
});
// Stryker restore all

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const emit = defineEmits<{
  resolve: [decision: CodexSurfaceApprovalDecision, scope: CodexSurfaceApprovalScope];
}>();
// Stryker restore all

const allowedScopes = computed(() => props.approval.allowedScopes ?? ['once', 'session']);
const canDeny = computed(() => props.approval.canDeny ?? true);
const actions = computed(() => [
  ...(allowedScopes.value.includes('once') ? [{ id: 'once' as const, label: 'Allow', primary: true }] : []),
  ...(allowedScopes.value.includes('session') ? [{ id: 'session' as const, label: 'Allow for session' }] : []),
  ...(canDeny.value ? [{ id: 'deny' as const, label: 'Deny' }] : []),
]);

function decide(decision: 'once' | 'session' | 'deny'): void {
  emit('resolve', decision === 'deny' ? 'deny' : 'approve', decision === 'session' ? 'session' : 'once');
}

function permissionLabel(permission: CodexSurfaceRequestedPermission): string {
  if (permission.kind === 'network') {
    const destination = permission.host
      ? ` to ${permission.protocol ? `${permission.protocol}://` : ''}${permission.host}`
      : '';
    return `Network access${destination}: ${permission.enabled ? 'enabled' : 'disabled'}`;
  }
  return `${permission.access[0]?.toUpperCase()}${permission.access.slice(1)} access: ${permission.path}`;
}
</script>

<style scoped>
.codex-approval-prompt__details {
  display: grid;
  gap: var(--space-3);
}
.codex-approval-prompt__details code,
.codex-approval-prompt__details small {
  font: inherit;
}
.codex-approval-prompt__details ul {
  margin: 0;
  padding-left: var(--space-8);
}
</style>
