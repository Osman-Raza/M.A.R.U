import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

const db = new Database(join(app.getPath('userData'), 'maru.db'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS courses (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT NOT NULL UNIQUE,
  title     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'task',
  course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  due_at     TEXT,
  done_at    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS class_times (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday   INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min   INTEGER NOT NULL,
  location  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_due  ON tasks(due_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_day  ON class_times(weekday);
`)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type Task = {
  id: number
  title: string
  kind: string
  course: string | null
  due_at: string | null
  done_at: string | null
  notes: string | null
}

function courseId(code?: string | null): number | null {
  if (!code) return null
  const norm = code.trim().toUpperCase().replace(/\s+/g, ' ')
  db.prepare('INSERT OR IGNORE INTO courses (code) VALUES (?)').run(norm)
  const row = db.prepare('SELECT id FROM courses WHERE code = ?').get(norm) as { id: number }
  return row.id
}

const SELECT_TASK = `
  SELECT t.id, t.title, t.kind, c.code AS course, t.due_at, t.done_at, t.notes
  FROM tasks t LEFT JOIN courses c ON c.id = t.course_id
`

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Guards against the same assignment being filed twice because speech-to-text
 * heard it slightly differently. Same course, same day, same normalized title.
 */
function findDuplicate(title: string, course: string | null, due_at: string | null): Task | null {
  const key = normalize(title)
  if (!key) return null
  const open = db.prepare(`${SELECT_TASK} WHERE t.done_at IS NULL`).all() as Task[]

  return (
    open.find((c) => {
      const sameDay =
        (!due_at && !c.due_at) ||
        (!!due_at && !!c.due_at && due_at.slice(0, 10) === c.due_at.slice(0, 10))
      return normalize(c.title) === key && sameDay && (course ?? null) === (c.course ?? null)
    }) ?? null
  )
}

export function addTask(a: {
  title: string
  kind?: string
  course?: string
  due_at?: string
  notes?: string
}): Task & { duplicate?: boolean } {
  const normCourse = a.course ? a.course.trim().toUpperCase().replace(/\s+/g, ' ') : null
  const existing = findDuplicate(a.title, normCourse, a.due_at ?? null)
  if (existing) return { ...existing, duplicate: true }

  const info = db
    .prepare('INSERT INTO tasks (title, kind, course_id, due_at, notes) VALUES (?, ?, ?, ?, ?)')
    .run(a.title, a.kind ?? 'task', courseId(a.course), a.due_at ?? null, a.notes ?? null)
  return db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(info.lastInsertRowid) as Task
}

export function listTasks(
  a: { window?: string; course?: string; include_done?: boolean } = {}
): Task[] {
  const where: string[] = []
  const params: unknown[] = []

  if (!a.include_done) where.push('t.done_at IS NULL')
  if (a.course) {
    where.push('c.code = ?')
    params.push(a.course.trim().toUpperCase().replace(/\s+/g, ' '))
  }

  if (a.window === 'today') where.push("date(t.due_at) = date('now','localtime')")
  else if (a.window === 'tomorrow') where.push("date(t.due_at) = date('now','localtime','+1 day')")
  else if (a.window === 'week')
    where.push(
      "t.due_at IS NOT NULL AND date(t.due_at) BETWEEN date('now','localtime') AND date('now','localtime','+7 days')"
    )
  else if (a.window === 'ahead')
    where.push("t.due_at IS NOT NULL AND date(t.due_at) > date('now','localtime')")
  else if (a.window === 'overdue')
    where.push("t.due_at IS NOT NULL AND datetime(t.due_at) < datetime('now','localtime')")

  const sql = `${SELECT_TASK} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.due_at IS NULL, t.due_at ASC LIMIT 40`
  return db.prepare(sql).all(...params) as Task[]
}

export function findTask(query: string): Task | null {
  const row = db
    .prepare(
      `${SELECT_TASK} WHERE t.done_at IS NULL AND t.title LIKE ? ORDER BY t.due_at IS NULL, t.due_at LIMIT 1`
    )
    .get(`%${query.trim()}%`)
  return (row as Task) ?? null
}

export function completeTask(a: { query: string }): Task | { error: string } {
  const task = findTask(a.query)
  if (!task) return { error: `No open task matching "${a.query}".` }
  db.prepare("UPDATE tasks SET done_at = datetime('now') WHERE id = ?").run(task.id)
  return { ...task, done_at: new Date().toISOString() }
}

/** Used by the panel checkbox, which already knows the exact row. */
export function completeById(id: number) {
  db.prepare("UPDATE tasks SET done_at = datetime('now') WHERE id = ?").run(id)
}

export function rescheduleTask(a: { query: string; due_at: string }): Task | { error: string } {
  const task = findTask(a.query)
  if (!task) return { error: `No open task matching "${a.query}".` }
  db.prepare('UPDATE tasks SET due_at = ? WHERE id = ?').run(a.due_at, task.id)
  return { ...task, due_at: a.due_at }
}

export function deleteTask(a: { query: string }): { deleted: string } | { error: string } {
  const task = findTask(a.query)
  if (!task) return { error: `No open task matching "${a.query}".` }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)
  return { deleted: task.title }
}

export function addClassTime(a: {
  course: string
  weekday: string
  start: string
  end: string
  location?: string
}) {
  const cid = courseId(a.course)!
  const day = WEEKDAYS.findIndex((d) => d.toLowerCase() === a.weekday.trim().toLowerCase())
  if (day < 0) return { error: `Unknown weekday "${a.weekday}".` }
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  db.prepare(
    'INSERT INTO class_times (course_id, weekday, start_min, end_min, location) VALUES (?, ?, ?, ?, ?)'
  ).run(cid, day, toMin(a.start), toMin(a.end), a.location ?? null)
  return { course: a.course, weekday: WEEKDAYS[day], start: a.start, end: a.end }
}

const fmtMin = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function getSchedule(a: { weekday?: string } = {}) {
  const day = a.weekday
    ? WEEKDAYS.findIndex((d) => d.toLowerCase() === a.weekday!.trim().toLowerCase())
    : new Date().getDay()
  const rows = db
    .prepare(
      `SELECT c.code AS course, ct.start_min, ct.end_min, ct.location
       FROM class_times ct JOIN courses c ON c.id = ct.course_id
       WHERE ct.weekday = ? ORDER BY ct.start_min`
    )
    .all(day) as { course: string; start_min: number; end_min: number; location: string | null }[]

  return {
    weekday: WEEKDAYS[day],
    classes: rows.map((r) => ({
      course: r.course,
      start: fmtMin(r.start_min),
      end: fmtMin(r.end_min),
      start_min: r.start_min,
      end_min: r.end_min,
      location: r.location
    }))
  }
}

/** Everything the always-on panel renders, in one round trip. */
export function getBoard() {
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  const schedule = getSchedule()

  const current = schedule.classes.find((c) => minutes >= c.start_min && minutes < c.end_min) ?? null
  const next = schedule.classes.find((c) => c.start_min > minutes) ?? null

  const overdue = listTasks({ window: 'overdue' })
  const today = listTasks({ window: 'today' }).filter((t) => !overdue.some((o) => o.id === t.id))
  const seen = new Set([...overdue, ...today].map((t) => t.id))
  const ahead = listTasks({ window: 'ahead' }).filter((t) => !seen.has(t.id)).slice(0, 8)

  return {
    generated_at: now.toISOString(),
    weekday: schedule.weekday,
    date: now.toLocaleDateString('en-CA', { month: 'long', day: 'numeric' }),
    classes: schedule.classes,
    current,
    next,
    overdue,
    today,
    ahead
  }
}
