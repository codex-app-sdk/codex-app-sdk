import { createApp } from 'vue';
import 'codex-app-sdk/styles.css';
import App from './App.vue';
import './styles.css';

document.documentElement.dataset.platform = navigator.platform.startsWith('Mac')
  || navigator.userAgent.includes('Macintosh')
  ? 'macos'
  : 'other';

createApp(App).mount('#app');
