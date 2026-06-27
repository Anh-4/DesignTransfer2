// preload.cjs — cầu nối an toàn giữa renderer (React, tải từ web) và main process.
// Lộ ra window.flowBridge để app gọi automation Flow qua IPC. Chỉ tồn tại khi
// chạy bản Electron -> renderer dựa vào sự tồn tại của nó để bật provider Flow.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowBridge', {
  available: true,
  // Mở sẵn Chrome + vào Flow + chờ đăng nhập (gọi ngay khi chọn provider Flow).
  open: () => ipcRenderer.invoke('flow:open'),
  // payload: { prompt, images:[{base64,mimeType}], aspectRatio, model }
  generate: (payload) => ipcRenderer.invoke('flow:generate', payload),
  // Đăng ký nhận log tiến trình; trả hàm huỷ đăng ký.
  onLog: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('flow:log', h);
    return () => ipcRenderer.removeListener('flow:log', h);
  },
});

// Provider automation Gemini web (tài khoản Google, Nano Banana Pro). Cùng cơ chế flowBridge.
contextBridge.exposeInMainWorld('geminiBridge', {
  available: true,
  open: () => ipcRenderer.invoke('gemini:open'),
  generate: (payload) => ipcRenderer.invoke('gemini:generate', payload),
  onLog: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('gemini:log', h);
    return () => ipcRenderer.removeListener('gemini:log', h);
  },
});

// Provider automation ChatGPT (tài khoản ChatGPT Plus/Pro). Cùng cơ chế.
contextBridge.exposeInMainWorld('chatgptBridge', {
  available: true,
  open: () => ipcRenderer.invoke('chatgpt:open'),
  generate: (payload) => ipcRenderer.invoke('chatgpt:generate', payload),
  onLog: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('chatgpt:log', h);
    return () => ipcRenderer.removeListener('chatgpt:log', h);
  },
});
