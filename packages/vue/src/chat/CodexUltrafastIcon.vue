<template>
  <svg class="codex-ultrafast-icon" xmlns="http://www.w3.org/2000/svg" :width="size" :height="size"
    viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="bolt" transform="translate(-3 0)" fill="none" />
    <path :d="bolt" transform="translate(3 0)" fill="none" stroke="var(--color-surface-lowest, #fff)" stroke-width="5" />
    <path :d="bolt" transform="translate(3 0)" fill="currentColor" />
  </svg>
</template>

<script setup lang="ts">
const { size = 16 } = defineProps<{ size?: number }>();
const bolt = 'M13 3v7h6l-8 11v-7H5L13 3z';
</script>
