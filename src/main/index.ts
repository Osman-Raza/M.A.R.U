import { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import 'dotenv/config'

let overlay: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let tray: Tray | null = null

const HOTKEY = process.env.MARU_HOTKEY ?? 'CommandOrControl+Shift+Space'
const CORNER = (process.env.MARU_PANEL_CORNER ?? 'top-right') as
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

const OVERLAY_W = 680
const OVERLAY_H = 320
const PANEL_W = 420
const PANEL_H = 700
const MARGIN = 22

function loadPage(win: BrowserWindow, page: string) {
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}`))
  }
}

/* ---------------------------------------------------------------- overlay */

function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: process.platform === 'win32',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadPage(win, 'index.html')
  return win
}

function positionOverlay(win: BrowserWindow) {
  const { x, y, width, height } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea
  win.setBounds({
    x: Math.round(x + (width - OVERLAY_W) / 2),
    y: Math.round(y + height - OVERLAY_H - 48),
    width: OVERLAY_W,
    height: OVERLAY_H
  })
}

function toggleOverlay() {
  if (!overlay) return
  if (overlay.isVisible()) {
    overlay.webContents.send('overlay:dismiss')
    return
  }
  positionOverlay(overlay)
  overlay.showInactive()
  overlay.webContents.send('overlay:open')
}

/* ------------------------------------------------------------------ panel */

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Never takes focus and never raises, so clicking any other window buries it.
    // This is as close to a desktop widget as Electron gets on macOS.
    focusable: false,
    alwaysOnTop: false,
    acceptFirstMouse: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  positionPanel(win)
  loadPage(win, 'panel.html')
  return win
}

function positionPanel(win: BrowserWindow) {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const left = CORNER.endsWith('left')
  const top = CORNER.startsWith('top')
  win.setBounds({
    x: Math.round(left ? x + MARGIN : x + width - PANEL_W - MARGIN),
    y: Math.round(top ? y + MARGIN : y + height - PANEL_H - MARGIN),
    width: PANEL_W,
    height: PANEL_H
  })
}

function refreshPanel() {
  panel?.webContents.send('panel:refresh')
}

function togglePanel() {
  if (!panel) return
  if (panel.isVisible()) {
    panel.hide()
  } else {
    positionPanel(panel)
    panel.showInactive()
    refreshPanel()
  }
}

/* ------------------------------------------------------------------- boot */

app.whenReady().then(() => {
  overlay = createOverlay()
  panel = createPanel()
  panel.once('ready-to-show', () => panel?.showInactive())

  if (!globalShortcut.register(HOTKEY, toggleOverlay)) {
    console.error(`Could not register ${HOTKEY}. Another app probably owns it.`)
  }

  // Placeholder. Drop a 16x16 template PNG in and load it before shipping.
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('M.A.R.U')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Listen  (${HOTKEY.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')})`,
        click: toggleOverlay
      },
      { label: 'Show panel', type: 'checkbox', checked: true, click: togglePanel },
      { type: 'separator' },
      { label: 'Quit M.A.R.U', click: () => app.quit() }
    ])
  )

  screen.on('display-metrics-changed', () => panel && positionPanel(panel))

  if (process.platform === 'darwin') app.dock?.hide()
})

/* -------------------------------------------------------------------- ipc */

ipcMain.on('overlay:close', () => overlay?.hide())

ipcMain.handle('assistant:transcribe', async (_e, buffer: ArrayBuffer) => {
  const { transcribe } = await import('./assistant')
  return transcribe(buffer)
})

ipcMain.handle('assistant:run', async (_e, transcript: string) => {
  const { run } = await import('./assistant')
  const result = await run(transcript)
  // Any command can mutate state, so the panel re-reads after every one.
  refreshPanel()
  return result
})

ipcMain.handle('board:get', async () => {
  const dbmod = await import('./db')
  return dbmod.getBoard()
})

ipcMain.handle('board:complete', async (_e, id: number) => {
  const dbmod = await import('./db')
  dbmod.completeById(id)
  return dbmod.getBoard()
})

ipcMain.handle('board:week', async (_e, offset: number) => {
  const dbmod = await import('./db')
  return dbmod.getWeek(offset)
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', (e: Event) => e.preventDefault())
