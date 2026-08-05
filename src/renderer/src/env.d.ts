/// <reference types="vite/client" />

type RunResult = {
  reply: string
  tasks: any[]
  schedule: { weekday: string; classes: any[] } | null
  actions: string[]
}

declare global {
  interface Window {
    maru: {
      onOpen: (cb: () => void) => () => void
      onDismiss: (cb: () => void) => () => void
      onRefresh: (cb: () => void) => () => void
      transcribe: (buffer: ArrayBuffer) => Promise<string>
      run: (transcript: string) => Promise<RunResult>
      board: () => Promise<any>
      week: (offset: number) => Promise<any>
      complete: (id: number) => Promise<any>
      close: () => void
    }
  }
}

export {}
