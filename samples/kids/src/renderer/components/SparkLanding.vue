<template>
  <main class="spark-landing">
    <section class="spark-landing__card" aria-labelledby="spark-welcome-title">
      <div class="spark-landing__stars" aria-hidden="true">
        <span>✦</span>
        <span class="spark-landing__mascot">★</span>
        <span>✦</span>
      </div>
      <p class="spark-landing__eyebrow">A friendly place to wonder</p>
      <h1 id="spark-welcome-title">Welcome to Spark!</h1>
      <p class="spark-landing__description">
        Ask questions, invent stories, and discover something new.
      </p>
      <button
        class="spark-landing__sign-in"
        type="button"
        :disabled="busy"
        @click="emit('signIn')"
      >
        <span aria-hidden="true">{{ busy ? '…' : '→' }}</span>
        {{ busy ? 'Opening sign in…' : 'Sign in with ChatGPT' }}
      </button>
      <p class="spark-landing__grown-up">Ask a grown-up to help you sign in.</p>
      <p v-if="error" class="spark-landing__error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  busy?: boolean;
  error?: string | null;
}>(), {
  busy: false,
  error: null,
});

const emit = defineEmits<{
  signIn: [];
}>();
</script>
