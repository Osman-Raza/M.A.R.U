import { useCallback, useEffect, useRef, useState } from 'react'
import { useRecorder } from './useRecorder'
import { Waveform, type WaveformHandle } from './Waveform'

type Task = {
  id: number
  title: string
  kind: string
  course: string | null
  due_at: string | null
  done_at: string | null
}

type Phase = 'hidden' | 'listening' | 'thinking' | 'result' | 'error'

const LABEL: Record<Exclude<Phase, 'hidden'>, string> = {
  listening: 'Listening',
  thinking: 'Working',
  result: 'Done',
  error: 'Failed'
}

function dueLabel(iso: string | null): string {
  if (!iso) return 'no deadline'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const days = Math.round(
    (new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000
  )
  const time = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days < 7) return `${d.toLocaleDateString('en-CA', { weekday: 'long' })} ${time}`
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [schedule, setSchedule] = useState<{ weekday: string; classes: any[] } | null>(null)

  const wave = useRef<WaveformHandle>(null)
  const { start, stop } = useRecorder()

  // Mirror of phase that event handlers can read without re-subscribing.
  const phaseRef = useRef<Phase>('hidden')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const reset = useCallback(() => {
    setTranscript('')
    setReply('')
    setTasks([])
    setSchedule(null)
  }, [])

  const hide = useCallback(() => {
    setPhase('hidden')
    // Let the exit transition finish before the window actually goes away.
    window.setTimeout(() => {
      window.maru.close()
      reset()
    }, 220)
  }, [reset])

  const handleClip = useCallback(
    async (clip: ArrayBuffer) => {
      wave.current?.idle()
      if (clip.byteLength === 0) {
        hide()
        return
      }
      setPhase('thinking')
      try {
        const text = await window.maru.transcribe(clip)
        if (!text) {
          hide()
          return
        }
        // Show what it heard before the model has answered.
        setTranscript(text)
        const res = await window.maru.run(text)
        setReply(res.reply)
        setTasks(res.tasks ?? [])
        setSchedule(res.schedule ?? null)
        setPhase('result')
      } catch (err) {
        setReply((err as Error).message)
        setPhase('error')
      }
    },
    [hide]
  )

  const beginListening = useCallback(async () => {
    reset()
    setPhase('listening')
    try {
      await start({
        onFrame: (samples, rms) => wave.current?.push(samples, rms),
        onDone: handleClip
      })
    } catch {
      setReply('No microphone access. Check System Settings > Privacy > Microphone.')
      setPhase('error')
    }
  }, [start, handleClip, reset])

  useEffect(() => {
    const offOpen = window.maru.onOpen(beginListening)

    // Hotkey behaviour depends on what is on screen:
    //   listening        -> cut the recording short
    //   result or error  -> start a fresh command, keep the window up
    //   anything else    -> dismiss
    const offDismiss = window.maru.onDismiss(() => {
      const p = phaseRef.current
      if (p === 'listening') stop()
      else if (p === 'result' || p === 'error') beginListening()
      else hide()
    })

    return () => {
      offOpen()
      offDismiss()
    }
  }, [beginListening, stop, hide])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (phaseRef.current === 'listening') stop()
      else hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop, hide])

  const open = phase !== 'hidden'

  return (
    <div className={`stage ${open ? 'is-open' : ''}`}>
      <div className="bar" data-phase={phase}>
        <header className="bar__head">
          <span className="pip" data-phase={phase} />
          <span className="status">{open ? LABEL[phase as Exclude<Phase, 'hidden'>] : ''}</span>

          {(phase === 'result' || phase === 'error') && (
            <button className="again" onClick={beginListening}>
              Ask again
            </button>
          )}

          <button className="close" onClick={hide} aria-label="Close">
            &times;
          </button>
        </header>

        <div className="bar__body">
          {transcript && <p className="heard">{transcript}</p>}
          {reply && <p className="reply">{reply}</p>}

          {tasks.length > 0 && (
            <ul className="rows">
              {tasks.map((t) => (
                <li key={t.id} className="row" data-done={!!t.done_at}>
                  <span className="row__course">{t.course ?? t.kind}</span>
                  <span className="row__title">{t.title}</span>
                  <span className="row__due">{dueLabel(t.due_at)}</span>
                </li>
              ))}
            </ul>
          )}

          {schedule && schedule.classes.length > 0 && (
            <ul className="rows">
              {schedule.classes.map((c, i) => (
                <li key={i} className="row">
                  <span className="row__course">{c.course}</span>
                  <span className="row__title">{c.location ?? 'no room set'}</span>
                  <span className="row__due">
                    {c.start}&thinsp;&ndash;&thinsp;{c.end}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Waveform ref={wave} active={phase === 'listening'} />
      </div>
    </div>
  )
}
