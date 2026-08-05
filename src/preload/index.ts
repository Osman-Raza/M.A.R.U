import { contextBridge, ipcRenderer } from 'electron'

const api = {
  onOpen: (cb: () => void) => {
    ipcRenderer.on('overlay:open', cb)
    return () => ipcRenderer.removeListener('overlay:open', cb)
  },
  onDismiss: (cb: () => void) => {
    ipcRenderer.on('overlay:dismiss', cb)
    return () => ipcRenderer.removeListener('overlay:dismiss', cb)
  },
  onRefresh: (cb: () => void) => {
    ipcRenderer.on('panel:refresh', cb)
    return () => ipcRenderer.removeListener('panel:refresh', cb)
  },
  transcribe: (buffer: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('assistant:transcribe', buffer),
  run: (transcript: string) => ipcRenderer.invoke('assistant:run', transcript),
  board: () => ipcRenderer.invoke('board:get'),
  complete: (id: number) => ipcRenderer.invoke('board:complete', id),
  close: () => ipcRenderer.send('overlay:close')
}

contextBridge.exposeInMainWorld('maru', api)

export type MaruApi = typeof api
