# M.A.R.U

Push-to-talk desktop assistant. Hit the hotkey, say what you need, it files it.
A board pinned to the corner of your desktop shows what is actually going on.

```
Cmd/Ctrl + Shift + Space  →  overlay appears, mic opens
speak                     →  trace deflects along the bottom edge
stop speaking             →  auto-cuts after ~1.1s of silence
                          →  Whisper transcribes, Claude picks tools, SQLite writes
                          →  overlay shows what changed, board refreshes
```

## Setup

```bash
npm install
```

Create `.env` in the project root (see `env.example.txt`):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

MARU_MODEL=claude-haiku-4-5-20251001
MARU_HOTKEY=CommandOrControl+Shift+Space
MARU_PANEL_CORNER=top-right
```

```bash
npm run dev
```

No dock icon and no window on launch is correct. The board appears in the corner;
everything else lives behind the hotkey and the menu bar icon.

`better-sqlite3` is a native module. `npm install` runs `electron-builder install-app-deps`
to rebuild it against Electron's Node ABI. If you hit a `NODE_MODULE_VERSION` mismatch,
run that step again.

## Two windows

**Overlay** — bottom center, on top of everything, appears on the hotkey and goes away
when you dismiss it. This is where you talk.

**Board** — corner of the primary display, never takes focus, never raises. Click any
other window and it gets buried, which is as close to a desktop widget as Electron gets
on macOS. Shows current or next class, then Overdue, Today, Ahead, and today's classes.
Click a checkbox to complete something without speaking.

The board re-reads whenever a voice command runs, plus every 60 seconds so "overdue"
stays honest as the day rolls over.

## What it understands

Anything that maps to one of the seven tools in `src/main/assistant.ts`:

| You say | What happens |
|---|---|
| "Lab 3 writeup for 1MD3 due Friday" | `add_task`, date resolved to this Friday 23:59 |
| "What's due this week" | `list_tasks` with `window: week` |
| "I finished the stats problem set" | `complete_task`, fuzzy match on title |
| "Push the essay to Sunday" | `reschedule_task` |
| "2C03 is Tuesdays 2:30 to 4:20 in ITB 137" | `add_class_time` |
| "What do I have today" | `get_schedule` |

Adding a capability is one entry in `tools` and one line in `handlers`.

`add_task` refuses near-duplicates: same normalized title, same course, same due date
returns the existing row flagged `duplicate` instead of inserting a second one.

## Layout

```
src/main/index.ts        hotkey, both windows, tray, IPC
src/main/db.ts           SQLite schema, queries, getBoard()
src/main/assistant.ts    Whisper call, tool definitions, agent loop
src/preload/index.ts     the only bridge between main and renderer
src/renderer/
  index.html             overlay entry
  panel.html             board entry
  src/App.tsx            overlay: listening → thinking → result
  src/Board.tsx          the corner board
  src/useRecorder.ts     getUserMedia, MediaRecorder, silence detection
  src/Waveform.tsx       canvas trace
  src/styles.css         shared tokens + overlay
  src/panel.css          board
```

API keys live in the main process only. The renderer never sees them.

## Decisions worth knowing

**Hotkey toggles, it does not hold.** Electron's `globalShortcut` fires on keydown and
gives you no keyup, so true press-and-hold needs a native hook. The hotkey opens the mic
and silence closes it. If a result is on screen, the hotkey starts a fresh command instead
of dismissing, so you can chain them. For real hold, add
[`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) and swap `toggleOverlay()` for
keydown/keyup handlers.

**Neither window takes focus.** The overlay uses `showInactive()` so it won't pull you out
of your editor. The tradeoff is Escape only fires on Windows; on macOS use the × or the
hotkey.

**Silence threshold is 0.012 RMS** in `useRecorder.ts`. Raise it in a loud room, lower it
if it cuts you off mid-sentence.

**Model defaults to Haiku** because tool routing on a ten-word command does not need more.
Set `MARU_MODEL=claude-sonnet-5` if you want it to handle messier phrasing.

## Before you ship it

- Tray icon is `nativeImage.createEmpty()`. Drop a 16x16 template PNG in and load it.
- macOS mic permission is declared in `build.mac.extendInfo`. It still prompts on first run,
  and in dev it prompts as "Electron", not MARU.
- The DB lives at `app.getPath('userData')/maru.db`.

## Not built yet

Voice output, calendar import, recurring tasks, notifications, phone sync. The data layer
is one file, so moving to Supabase later means rewriting `db.ts` and nothing else.
