// The bridge between every page this app shows and the main process: the preparing and phone
// pages, and the dashboard SPA itself (the preload is set on its BrowserWindow). The SPA treats
// `window.reviewstage.phone` as "running in the desktop app" and builds Settings → Your phone on it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reviewstage", {
  onProgress: (fn) => ipcRenderer.on("progress", (_e, p) => fn(p)),
  retry: () => ipcRenderer.send("retry"),
  quit: () => ipcRenderer.send("quit"),
  phone: {
    enable: () => ipcRenderer.invoke("phone:enable"),
    disable: () => ipcRenderer.invoke("phone:disable"),
    status: () => ipcRenderer.invoke("phone:status"),
    onData: (fn) => ipcRenderer.on("phone", (_e, p) => fn(p)),
  },
});
