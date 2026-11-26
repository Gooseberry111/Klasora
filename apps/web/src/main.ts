import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles/main.css';
import App from './App.vue';
import { router } from './router';
import { useThemeStore } from './stores/theme';
import { isSupabaseConfigured } from './lib/supabase';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
useThemeStore(pinia).init();

if (isSupabaseConfigured) app.use(router);

app.config.errorHandler = (error, _instance, info) => {
  // Structured log for the browser console / future error monitoring hook.
  console.error('[klasora:web] unhandled error', { info, error });
};

app.mount('#app');
