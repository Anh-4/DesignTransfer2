import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';

// Ngày build (giờ VN, dd/mm/yyyy) — tự gắn lúc build/deploy nên mỗi bản đều khác.
const buildDate = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' });

// base: './' để asset dùng đường dẫn tương đối -> Electron load qua file:// chạy được.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Nhúng version + ngày build -> hiển thị trên giao diện (bump version / deploy là UI tự đổi).
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(buildDate) },
  // host 127.0.0.1: bind IPv4 để khớp wait-on/Electron (Windows hay bind IPv6 ::1 gây kẹt).
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist' },
});
