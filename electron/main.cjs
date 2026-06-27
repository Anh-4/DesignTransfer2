// Electron "thin shell": tải app từ web (GitHub Pages) nên mỗi lần mở là
// bản mới nhất — Anh4 chỉ cần push code, người dùng nhận bản mới ở lần mở kế.
// Offline / lỗi mạng -> fallback về bản bundled trong dist.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const flowRunner = require('./flow-runner.cjs');
const geminiRunner = require('./gemini-runner.cjs');
const chatgptRunner = require('./chatgpt-runner.cjs');

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
      // Cầu nối cho provider "Google Flow (automation)" -> window.flowBridge.
      preload: path.join(__dirname, 'preload.cjs'),
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

// Đường dẫn dùng chung cho automation Flow.
const flowPaths = () => ({
  profileDir: path.join(app.getPath('userData'), 'flow-profile'), // đăng nhập 1 lần, dùng lại
  downloadDir: app.getPath('downloads'),
});
const flowLogger = (event) => (msg) => {
  console.log('[flow]', msg);                          // hiện ở terminal để debug
  try { event.sender.send('flow:log', msg); } catch {} // gửi renderer (nếu cần hiển thị)
};

// IPC: mở sẵn Chrome + vào Flow + chờ đăng nhập (gọi ngay khi chọn provider Flow).
ipcMain.handle('flow:open', async (event) => {
  return flowRunner.prepare({ ...flowPaths() }, flowLogger(event));
});

// IPC: provider "Google Flow" — renderer gửi prompt + ảnh, main chạy Playwright.
ipcMain.handle('flow:generate', async (event, payload) => {
  return flowRunner.generate({ ...payload, ...flowPaths() }, flowLogger(event));
});

// IPC: provider "Gemini (automation)" — profile riêng cho Gemini web.
const geminiPaths = () => ({
  profileDir: path.join(app.getPath('userData'), 'gemini-profile'),
  downloadDir: app.getPath('downloads'),
});
const geminiLogger = (event) => (msg) => {
  console.log('[gemini]', msg);
  try { event.sender.send('gemini:log', msg); } catch {}
};
ipcMain.handle('gemini:open', async (event) => {
  return geminiRunner.prepare({ ...geminiPaths() }, geminiLogger(event));
});
ipcMain.handle('gemini:generate', async (event, payload) => {
  return geminiRunner.generate({ ...payload, ...geminiPaths() }, geminiLogger(event));
});

// IPC: provider "ChatGPT (automation)" — profile riêng cho ChatGPT.
const chatgptPaths = () => ({
  profileDir: path.join(app.getPath('userData'), 'chatgpt-profile'),
  downloadDir: app.getPath('downloads'),
});
const chatgptLogger = (event) => (msg) => {
  console.log('[chatgpt]', msg);
  try { event.sender.send('chatgpt:log', msg); } catch {}
};
ipcMain.handle('chatgpt:open', async (event) => {
  return chatgptRunner.prepare({ ...chatgptPaths() }, chatgptLogger(event));
});
ipcMain.handle('chatgpt:generate', async (event, payload) => {
  return chatgptRunner.generate({ ...payload, ...chatgptPaths() }, chatgptLogger(event));
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Đóng Chrome automation khi thoát app.
app.on('before-quit', () => { flowRunner.close(); geminiRunner.close(); chatgptRunner.close(); });
