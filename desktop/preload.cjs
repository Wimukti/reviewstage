// The bridge between every page this app shows and the main process: the preparing and phone
// pages, and the dashboard SPA itself (the preload is set on its BrowserWindow). The SPA treats
// `window.reviewstage.phone` as "running in the desktop app" and builds Settings → Your phone on
// it; `update` and `openAtLogin` drive the update banner and Settings → Desktop app.
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
    tailscale: {
      status: () => ipcRenderer.invoke("phone:tailscale:status"),
      set: (on) => ipcRenderer.invoke("phone:tailscale:set", !!on),
    },
  },
  update: {
    status: () => ipcRenderer.invoke("update:status"),
    check: () => ipcRenderer.invoke("update:check"),
    install: () => ipcRenderer.invoke("update:install"),
    onAvailable: (fn) => ipcRenderer.on("update", (_e, u) => fn(u)),
  },
  openAtLogin: {
    status: () => ipcRenderer.invoke("openAtLogin:status"),
    set: (on) => ipcRenderer.invoke("openAtLogin:set", !!on),
  },
  appShortcut: {
    status: () => ipcRenderer.invoke("appShortcut:status"),
    set: (on) => ipcRenderer.invoke("appShortcut:set", !!on),
  },
});
