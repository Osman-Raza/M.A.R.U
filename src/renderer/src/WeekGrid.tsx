import { useEffect, useMemo, useRef, useState } from 'react'
import { courseColor, shortCourse } from './courses'

type Klass = {
  course: string
  start: string
  end: string
  start_min: number
  end_min: number
  location: string | null
}

type Task = {
  id: number
  title: string
  kind: string
  course: string | null
  due_at: string | null
}

export type WeekData = {
  offset: number
  range: string
  now_min: number
  bounds: { start: number; end: number }
  days: {
    iso: string
    label: string
    initial: string
    dayOfMonth: number
    isToday: boolean
    isPast: boolean
    classes: Klass[]
    tasks: Task[]
  }[]
  overdue: Task[]
}

const GRID_H = 268

export function WeekGrid({
  week,
  selected,
  onSelect
}: {
  week: WeekData
  selected: string
  onSelect: (iso: string) => void
}) {
  const { start, end } = week.bounds
  const span = Math.max(60, end - start)
  const scale = GRID_H / span

  // Local clock so the now-line creeps between the 60s data refreshes.
  const [nowMin, setNowMin] = useState(week.now_min)
  useEffect(() => {
    setNowMin(week.now_min)
    const t = window.setInterval(() => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }, 30_000)
    return () => window.clearInterval(t)
  }, [week.now_min])

  const hours = useMemo(() => {
    const out: number[] = []
    for (let m = Math.ceil(start / 60) * 60; m <= end; m += 60) out.push(m)
    return out
  }, [start, end])

  const gridRef = useRef<HTMLDivElement>(null)
  const showNow = week.offset === 0 && nowMin >= start && nowMin <= end
  const maxDue = Math.max(1, ...week.days.map((d) => d.tasks.length))

  return (
    <div className="wk">
      <div className="wk__head">
        <div className="wk__gutter" />
        {week.days.map((d) => (
          <button
            key={d.iso}
            className="wk__day"
            data-today={d.isToday}
            data-past={d.isPast}
            data-selected={d.iso === selected}
            onClick={() => onSelect(d.iso)}
          >
            <span className="wk__day-i">{d.initial}</span>
            <span className="wk__day-n">{d.dayOfMonth}</span>
          </button>
        ))}
      </div>

      <div className="wk__grid" ref={gridRef} style={{ height: GRID_H }}>
        <div className="wk__gutter wk__gutter--rows">
          {hours.map((m) => (
            <span key={m} className="wk__hour" style={{ top: (m - start) * scale }}>
              {String(Math.floor(m / 60)).padStart(2, '0')}
            </span>
          ))}
        </div>

        <div className="wk__lanes">
          {hours.map((m) => (
            <div key={m} className="wk__rule" style={{ top: (m - start) * scale }} />
          ))}

          {week.days.map((d) => (
            <div
              key={d.iso}
              className="wk__lane"
              data-today={d.isToday}
              data-past={d.isPast}
              data-selected={d.iso === selected}
              onClick={() => onSelect(d.iso)}
            >
              {d.classes.map((c, i) => {
                const top = (c.start_min - start) * scale
                const h = Math.max(14, (c.end_min - c.start_min) * scale)
                const live = d.isToday && week.offset === 0 && nowMin >= c.start_min && nowMin < c.end_min
                const tint = courseColor(c.course)
                return (
                  <div
                    key={i}
                    className="wk__block"
                    data-live={live}
                    style={{
                      top,
                      height: h,
                      // Depth comes from a tinted fill plus a saturated left rail,
                      // so overlapping colours still read as separate courses.
                      background: `linear-gradient(135deg, ${tint}2E, ${tint}14)`,
                      borderLeft: `2px solid ${tint}`,
                      boxShadow: live ? `0 0 0 1px ${tint}88, 0 0 14px ${tint}44` : undefined
                    }}
                    title={`${c.course} ${c.start}-${c.end}${c.location ? ` · ${c.location}` : ''}`}
                  >
                    <span className="wk__block-c" style={{ color: tint }}>
                      {shortCourse(c.course)}
                    </span>
                  </div>
                )
              })}

              {showNow && d.isToday && (
                <div className="wk__now" style={{ top: (nowMin - start) * scale }}>
                  <span className="wk__now-dot" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="wk__due">
        <div className="wk__gutter wk__gutter--label">due</div>
        {week.days.map((d) => (
          <button
            key={d.iso}
            className="wk__duecell"
            data-selected={d.iso === selected}
            data-past={d.isPast}
            onClick={() => onSelect(d.iso)}
          >
            {d.tasks.length === 0 ? (
              <span className="wk__dueempty" />
            ) : (
              <>
                <span
                  className="wk__duebar"
                  style={{ height: `${Math.round((d.tasks.length / maxDue) * 100)}%` }}
                />
                <span className="wk__duenum">{d.tasks.length}</span>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
