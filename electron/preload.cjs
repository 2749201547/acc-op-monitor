const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aom', {
  /**
   * Convert a content-relative CSS rect (from getBoundingClientRect) to
   * physical screen pixels for positioning an external Chrome window.
   * @param {{ x: number, y: number, width: number, height: number }} rect
   */
  slotToScreen(rect) {
    return ipcRenderer.invoke('aom:slotToScreen', rect);
  },
});
