import { useCallback, useEffect, useState } from 'react'

type Task = {
  id: number
  title: string
  kind: string
  course: string | null
  due_at: string | null
}

type Class = {
  course: string
  start: string
  end: string
  start_min: number
  end_min: number
  location: string | null
}

type BoardData = {
  generated_at: string
  weekday: string
  date: string
  classes: Class[]
  current: Class | null
  next: Class | null
  overdue: Task[]
  today: Task[]
  ahead: Task[]
}

function shortDue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.round(
    (new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000
  )
  if (days === 0) return d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'tmrw'
  if (days < 0) return `${Math.abs(days)}d late`
  if (days < 7) return d.toLocaleDateString('en-CA', { weekday: 'short' })
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function Row({ task, onDone }: { task: Task; onDone: (id: number) => void }) {
  return (
    <li className="p-row">
      <button
        className="p-check"
        onClick={() => onDone(task.id)}
        aria-label={`Complete ${task.title}`}
      />
      <div className="p-row__main">
        <span className="p-row__title">{task.title}</span>
        {task.course && <span className="p-row__course">{task.course}</span>}
      </div>
      <span className="p-row__due">{shortDue(task.due_at)}</span>
    </li>
  )
}

export default function Board() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [clock, setClock] = useState(() => new Date())

  const load = useCallback(async () => {
    try {
      setBoard(await window.maru.board())
    } catch {
      /* main process not ready yet; the poll below retries */
    }
  }, [])

  useEffect(() => {
    load()
    const off = window.maru.onRefresh(load)
    // Cheap re-read keeps "overdue" and the current class honest across the day.
    const poll = window.setInterval(load, 60_000)
    const tick = window.setInterval(() => setClock(new Date()), 30_000)
    return () => {
      off()
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [load])

  const complete = useCallback(async (id: number) => {
    // Drop the row immediately, then reconcile with whatever the DB returns.
    setBoard((b) =>
      b
        ? {
            ...b,
            overdue: b.overdue.filter((t) => t.id !== id),
            today: b.today.filter((t) => t.id !== id),
            ahead: b.ahead.filter((t) => t.id !== id)
          }
        : b
    )
    setBoard(await window.maru.complete(id))
  }, [])

  if (!board) return <div className="panel panel--loading" />

  const empty =
    board.overdue.length === 0 &&
    board.today.length === 0 &&
    board.ahead.length === 0 &&
    board.classes.length === 0

  return (
    <div className="panel">
      <header className="p-head">
        <div>
          <div className="p-day">{board.weekday}</div>
          <div className="p-date">{board.date}</div>
        </div>
        <div className="p-clock">
          {clock.toLocaleTimeString('en-CA', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })}
        </div>
      </header>

      {board.current && (
        <div className="p-now" data-live="true">
          <span className="p-now__tag">In class</span>
          <span className="p-now__course">{board.current.course}</span>
          <span className="p-now__meta">
            until {board.current.end}
            {board.current.location ? ` · ${board.current.location}` : ''}
          </span>
        </div>
      )}

      {!board.current && board.next && (
        <div className="p-now">
          <span className="p-now__tag">Next</span>
          <span className="p-now__course">{board.next.course}</span>
          <span className="p-now__meta">
            {board.next.start}
            {board.next.location ? ` · ${board.next.location}` : ''}
          </span>
        </div>
      )}

      <div className="p-scroll">
        {board.overdue.length > 0 && (
          <section className="p-sec" data-tone="late">
            <h2 className="p-sec__h">
              Overdue<span>{board.overdue.length}</span>
            </h2>
            <ul className="p-list">
              {board.overdue.map((t) => (
                <Row key={t.id} task={t} onDone={complete} />
              ))}
            </ul>
          </section>
        )}

        {board.today.length > 0 && (
          <section className="p-sec">
            <h2 className="p-sec__h">
              Today<span>{board.today.length}</span>
            </h2>
            <ul className="p-list">
              {board.today.map((t) => (
                <Row key={t.id} task={t} onDone={complete} />
              ))}
            </ul>
          </section>
        )}

        {board.ahead.length > 0 && (
          <section className="p-sec">
            <h2 className="p-sec__h">
              Ahead<span>{board.ahead.length}</span>
            </h2>
            <ul className="p-list">
              {board.ahead.map((t) => (
                <Row key={t.id} task={t} onDone={complete} />
              ))}
            </ul>
          </section>
        )}

        {board.classes.length > 0 && (
          <section className="p-sec">
            <h2 className="p-sec__h">Classes</h2>
            <ul className="p-list">
              {board.classes.map((c, i) => {
                const marker = board.current ?? board.next
                const past = marker ? c.start_min < marker.start_min : false
                return (
                  <li key={i} className="p-class" data-past={past}>
                    <span className="p-class__time">{c.start}</span>
                    <span className="p-class__course">{c.course}</span>
                    <span className="p-class__room">{c.location ?? ''}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {empty && <p className="p-empty">Nothing on the board.</p>}
      </div>
    </div>
  )
}
