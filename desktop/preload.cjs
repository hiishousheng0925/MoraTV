// 主窗口的 preload：只暴露几个客户端专有的口子给页面（页面按 window.mora 是否存在决定显示与否）。
//   mora.onUpdate(cb)  有新版本时回调版本号（页面晚于检查结果加载也能拿到）；返回取消监听的函数
//   mora.openUpdate()  重新打开更新弹窗
// sandbox 下的 preload 只能是 CommonJS、只能 require('electron') 的这几样
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mora', {
  onUpdate(cb) {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('mora:update', h);
    ipcRenderer.invoke('mora:update-state').then((v) => { if (v) cb(v); }).catch(() => {});
    return () => ipcRenderer.off('mora:update', h);
  },
  openUpdate() { ipcRenderer.send('mora:open-update'); }
});
