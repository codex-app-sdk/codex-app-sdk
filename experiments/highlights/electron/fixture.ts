import { createApp, computed, defineComponent, h } from 'vue';
import { renderCodeBlock } from '../../../packages/vue/src/chat/syntax-highlighting';
import '../../../packages/vue/src/base.css';

createApp(defineComponent({
  setup() {
    const html = computed(() => renderCodeBlock('<tag>\nconst answer = 42', 'typescript'));
    return () => h('div', { class: 'codex-chat-theme--dark codex-markdown', innerHTML: html.value });
  },
})).mount('#app');
