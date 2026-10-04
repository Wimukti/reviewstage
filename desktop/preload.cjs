// The only bridge between the pages this app owns (preparing, phone) and the main process.
// The dashboard itself is a plain web page from the local server and gets no preload.
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
