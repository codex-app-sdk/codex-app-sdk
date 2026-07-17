<template>
  <article class="codex-approval-prompt" role="status">
    <div class="codex-approval-prompt__copy">
      <strong>{{ approval.title }}</strong>
      <p v-if="approval.description">{{ approval.description }}</p>
      <code v-if="approval.command">{{ approval.command }}</code>
      <small v-if="approval.cwd">{{ approval.cwd }}</small>
      <ul v-if="approval.requestedPermissions?.length" class="codex-approval-prompt__permissions" aria-label="Requested permissions">
        <li v-for="(permission, index) in approval.requestedPermissions" :key="`${permission.kind}-${index}`">
          {{ permissionLabel(permission) }}
        </li>
      </ul>
    </div>
    <div class="codex-approval-prompt__actions">
      <button v-if="canDeny" type="button" :disabled="disabled" @click="emit('resolve', 'deny', 'once')">Deny</button>
      <button v-if="allowedScopes.includes('session')" type="button" :disabled="disabled" @click="emit('resolve', 'approve', 'session')">Allow for session</button>
      <button v-if="allowedScopes.includes('once')" class="codex-approval-prompt__primary" type="button" :disabled="disabled" @click="emit('resolve', 'approve', 'once')">
        Allow once
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceRequestedPermission,
} from '../../surface/types';

const props = withDefaults(defineProps<{
  approval: CodexSurfaceApproval;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  resolve: [decision: CodexSurfaceApprovalDecision, scope: CodexSurfaceApprovalScope];
}>();

const allowedScopes = computed(() => props.approval.allowedScopes ?? ['once', 'session']);
const canDeny = computed(() => props.approval.canDeny ?? true);

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
.codex-approval-prompt {
  display: flex;
  align-items: flex-end;
  gap: var(--codex-space-3, 12px);
  justify-content: space-between;
  margin-bottom: var(--codex-space-2, 8px);
  padding: 12px;
  border: 1px solid var(--codex-border-color, #d8dadd);
  border-radius: 12px;
  background: var(--codex-subtle-surface-color, #f7f7f5);
}

.codex-approval-prompt__copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.codex-approval-prompt p,
.codex-approval-prompt code,
.codex-approval-prompt small,
.codex-approval-prompt__permissions {
  margin: 0;
  color: var(--codex-muted-text-color, #777b82);
  font-size: 12px;
}

.codex-approval-prompt__permissions {
  display: grid;
  gap: 2px;
  padding-left: 18px;
  overflow-wrap: anywhere;
}

.codex-approval-prompt code {
  overflow: hidden;
  color: var(--codex-text-color, #202124);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-approval-prompt__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.codex-approval-prompt button {
  padding: 6px 9px;
  border: 1px solid var(--codex-border-color, #d8dadd);
  border-radius: 8px;
  color: var(--codex-text-color, #202124);
  background: var(--codex-surface-color, #fff);
  cursor: pointer;
}

.codex-approval-prompt__primary {
  color: var(--codex-primary-contrast-color, #fff) !important;
  background: var(--codex-primary-color, #202124) !important;
}

.codex-approval-prompt button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 680px) {
  .codex-approval-prompt { align-items: stretch; flex-direction: column; }
  .codex-approval-prompt__actions { flex-wrap: wrap; }
}
</style>
