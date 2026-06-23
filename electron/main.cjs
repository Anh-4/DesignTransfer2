// Electron "thin shell": tải app từ web (GitHub Pages) nên mỗi lần mở là
// bản mới nhất — Anh4 chỉ cần push code, người dùng nhận bản mới ở lần mở kế.
// Offline / lỗi mạng -> fallback về bản bundled trong dist.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// URL GitHub Pages của app (username trên github.io luôn viết thường).
const APP_URL = 'https://anh-4.github.io/DesignTransfer2/';
const isDev = !!process.env.ELECTRON_DEV;

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0e0e0e',
    autoHideMenuBar: true,
    title: 'Design Transfer 2',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Tránh lỗi CORS khi gọi Gemini/OpenRouter API từ trang web.
      webSecurity: false,
    },
  });

  win.removeMenu();

  const fallback = path.join(__dirname, '..', 'dist', 'index.html');
  const loadFallback = () => win.loadFile(fallback);

  // Dev: tải từ vite server; Production: tải bản web đã deploy, lỗi thì fallback.
  const target = isDev ? 'http://localhost:5173' : APP_URL;
  win.loadURL(target).catch(loadFallback);
  win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame) loadFallback();
  });

  // Link ngoài mở bằng trình duyệt hệ thống.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
