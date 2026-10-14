import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 产物输出到 web/dist, 由 web/server.js 统一伺服 (生产单端口);
// dev 模式 5173 端口, /api 代理到 8787 的后端。
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
