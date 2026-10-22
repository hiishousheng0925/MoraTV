import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default {
  plugins: [tailwindcss(), sveltekit()],
  server: { host: '127.0.0.1', port: 5173 },
  // 开发服务器启动时把全部组件扫一遍，把图标等依赖一次预构建完（否则第一次打开新页面会触发 reload）
  optimizeDeps: { entries: ['src/**/*.svelte'] }
};
