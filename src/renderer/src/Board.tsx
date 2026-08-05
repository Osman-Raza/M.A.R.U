import { useCallback, useEffect, useMemo, useState } from 'react'
import { WeekGrid, type WeekData } from './WeekGrid'
import { courseColor, shortCourse } from './courses'

type Task = {
  id: number
  title: string
  kind: string
  course: string | null
  due_at: string | null
}

type Klass = {
  course: string
  start: string
  end: string
  start_min: number
  end_min: number
  location: string | null
}

type BoardData = {
  weekday: string
  date: string
  classes: Klass[]
  current: Klass | null
  next: Klass | null
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

/** Minutes until the next class, phrased the way you'd say it out loud. */
function untilLabel(startMin: number, nowMin: number): string {
  const d = startMin - nowMin
  if (d <= 0) return 'now'
  if (d < 60) return `in ${d}m`
  const h = Math.floor(d / 60)
  const m = d % 60
  return m ? `in ${h}h ${m}m` : `in ${h}h`
}

function Row({ task, onDone }: { task: Task; onDone: (id: number) => void }) {
  const tint = courseColor(task.course)
  return (
    <li className="p-row">
      <button
        className="p-check"
        onClick={() => onDone(task.id)}
        aria-label={`Complete ${task.title}`}
      />
      <span className="p-rail" style={{ background: tint }} />
      <div className="p-row__main">
        <span className="p-row__title">{task.title}</span>
        <span className="p-row__meta">
          {task.course && (
            <span className="p-row__course" style={{ color: tint }}>
              {shortCourse(task.course)}
            </span>
          )}
          <span className="p-row__kind">{task.kind}</span>
        </span>
      </div>
      <span className="p-row__due">{shortDue(task.due_at)}</span>
    </li>
  )
}

function ClassRow({ c, nowMin, live }: { c: Klass; nowMin: number; live: boolean }) {
  const tint = courseColor(c.course)
  const past = nowMin >= 0 && c.end_min <= nowMin
  return (
    <li className="p-class" data-past={past} data-live={live}>
      <span className="p-class__time">{c.start}</span>
      <span className="p-rail" style={{ background: tint, opacity: past ? 0.35 : 1 }} />
      <div className="p-class__main">
        <span className="p-class__course" style={{ color: past ? undefined : tint }}>
          {c.course}
        </span>
        {c.location && <span className="p-class__room">{c.location}</span>}
      </div>
      <span className="p-class__span">
        {live ? `till ${c.end}` : past || nowMin < 0 ? c.end : untilLabel(c.start_min, nowMin)}
      </span>
    </li>
  )
}

export default function Board() {
  const [tab, setTab] = useState<'today' | 'week'>('today')
  const [board, setBoard] = useState<BoardData | null>(null)
  const [week, setWeek] = useState<WeekData | null>(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState('')
  const [clock, setClock] = useState(() => new Date())

  const nowMin = clock.getHours() * 60 + clock.getMinutes()

  const load = useCallback(async () => {
    try {
      const [b, w] = await Promise.all([window.maru.board(), window.maru.week(offset)])
      setBoard(b)
      setWeek(w)
      setSelected((cur) => {
        if (cur && w.days.some((d: any) => d.iso === cur)) return cur
        return (w.days.find((d: any) => d.isToday) ?? w.days[0]).iso
      })
    } catch {
      /* main process not ready yet; the poll below retries */
    }
  }, [offset])

  useEffect(() => {
    load()
    const off = window.maru.onRefresh(load)
    const poll = window.setInterval(load, 60_000)
    const tick = window.setInterval(() => setClock(new Date()), 30_000)
    return () => {
      off()
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [load])

  const complete = useCallback(
    async (id: number) => {
      // Drop the row immediately, then reconcile against the DB.
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
      setWeek(await window.maru.week(offset))
    },
    [offset]
  )

  const selectedDay = useMemo(
    () => week?.days.find((d) => d.iso === selected) ?? null,
    [week, selected]
  )

  const weekLoad = useMemo(() => {
    if (!week) return { due: 0, hours: 0 }
    const due = week.days.reduce((n, d) => n + d.tasks.length, 0)
    const mins = week.days.reduce(
      (n, d) => n + d.classes.reduce((m, c) => m + (c.end_min - c.start_min), 0),
      0
    )
    return { due, hours: Math.round(mins / 60) }
  }, [week])

  if (!board) return <div className="panel panel--loading" />

  const nothingToday =
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
        <div className="p-head__right">
          <div className="p-clock">
            {clock.toLocaleTimeString('en-CA', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            })}
          </div>
          {board.overdue.length > 0 && <div className="p-alarm">{board.overdue.length} late</div>}
        </div>
      </header>

      <nav className="p-tabs" data-at={tab}>
        <button data-on={tab === 'today'} onClick={() => setTab('today')}>
          Today
        </button>
        <button data-on={tab === 'week'} onClick={() => setTab('week')}>
          Week
        </button>
        <span className="p-tabs__ink" />
      </nav>

      {tab === 'today' ? (
        <>
          {board.current && (
            <div
              className="p-now"
              data-live="true"
              style={{ ['--tint' as any]: courseColor(board.current.course) }}
            >
              <span className="p-now__tag">In class</span>
              <span className="p-now__course">{board.current.course}</span>
              <span className="p-now__meta">
                until {board.current.end}
                {board.current.location ? ` · ${board.current.location}` : ''}
              </span>
            </div>
          )}

          {!board.current && board.next && (
            <div className="p-now" style={{ ['--tint' as any]: courseColor(board.next.course) }}>
              <span className="p-now__tag">Next</span>
              <span className="p-now__course">{board.next.course}</span>
              <span className="p-now__meta">
                {board.next.start} · {untilLabel(board.next.start_min, nowMin)}
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
                  {board.classes.map((c, i) => (
                    <ClassRow
                      key={i}
                      c={c}
                      nowMin={nowMin}
                      live={board.current?.start_min === c.start_min}
                    />
                  ))}
                </ul>
              </section>
            )}

            {nothingToday && <p className="p-empty">Nothing on the board.</p>}
          </div>
        </>
      ) : (
        <div className="p-scroll">
          {week && (
            <>
              <div className="p-weeknav">
                <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
                  &lsaquo;
                </button>
                <div className="p-weeknav__mid">
                  <span className="p-weeknav__range">{week.range}</span>
                  <span className="p-weeknav__load">
                    {weekLoad.hours}h class · {weekLoad.due} due
                  </span>
                </div>
                <button onClick={() => setOffset((o) => o + 1)} aria-label="Next week">
                  &rsaquo;
                </button>
              </div>

              {offset !== 0 && (
                <button className="p-todaybtn" onClick={() => setOffset(0)}>
                  Back to this week
                </button>
              )}

              <WeekGrid week={week} selected={selected} onSelect={setSelected} />

              {selectedDay && (
                <section className="p-sec p-sec--day">
                  <h2 className="p-sec__h">
                    {selectedDay.label} {selectedDay.dayOfMonth}
                    {selectedDay.tasks.length > 0 && <span>{selectedDay.tasks.length}</span>}
                  </h2>

                  {selectedDay.tasks.length > 0 ? (
                    <ul className="p-list">
                      {selectedDay.tasks.map((t) => (
                        <Row key={t.id} task={t} onDone={complete} />
                      ))}
                    </ul>
                  ) : (
                    <p className="p-empty p-empty--tight">Nothing due.</p>
                  )}

                  {selectedDay.classes.length > 0 && (
                    <ul className="p-list">
                      {selectedDay.classes.map((c, i) => (
                        <ClassRow
                          key={i}
                          c={c}
                          nowMin={selectedDay.isToday ? nowMin : -1}
                          live={false}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
