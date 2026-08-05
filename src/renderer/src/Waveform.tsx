import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'

export type WaveformHandle = {
  push: (samples: Uint8Array, rms: number) => void
  idle: () => void
}

/**
 * The trace is the bottom edge of the bar. At rest it is a flat hairline.
 * Speaking deflects it upward; the deflection decays back down on its own,
 * so the line never snaps to zero the instant you stop talking.
 */
export const Waveform = forwardRef<WaveformHandle, { active: boolean }>(function Waveform(
  { active },
  ref
) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const samples = useRef<Uint8Array | null>(null)
  const level = useRef(0)
  const target = useRef(0)
  const phase = useRef(0)
  const raf = useRef(0)

  useImperativeHandle(ref, () => ({
    push: (s, rms) => {
      samples.current = s
      target.current = Math.min(1, rms * 9)
    },
    idle: () => {
      samples.current = null
      target.current = 0
    }
  }))

  useEffect(() => {
    const el = canvas.current!
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      el.width = el.clientWidth * dpr
      el.height = el.clientHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    const ctx = el.getContext('2d')!

    const draw = () => {
      const w = el.width
      const h = el.height
      ctx.clearRect(0, 0, w, h)

      // Damped approach so the line settles instead of jittering.
      level.current += (target.current - level.current) * 0.16
      phase.current += 0.05

      const baseline = h - 2 * dpr
      const amp = level.current * (h * 0.72)
      const buf = samples.current

      ctx.beginPath()
      ctx.moveTo(0, baseline)
      const steps = 160
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        // Taper the ends so the trace melts into the bar's corners.
        const taper = Math.sin(Math.PI * t) ** 0.85
        const sample = buf ? (buf[Math.floor(t * (buf.length - 1))] - 128) / 128 : 0
        const drift = Math.sin(t * 11 + phase.current) * 0.12
        const y = baseline - (sample + drift) * amp * taper
        ctx.lineTo(t * w, y)
      }

      const glow = 0.25 + level.current * 0.75
      ctx.strokeStyle = active ? `rgba(245, 165, 36, ${glow})` : `rgba(124, 135, 152, 0.28)`
      ctx.lineWidth = (active ? 1.7 : 1) * dpr
      ctx.lineJoin = 'round'
      ctx.shadowBlur = active ? 14 * dpr * level.current : 0
      ctx.shadowColor = 'rgba(245, 165, 36, 0.6)'
      ctx.stroke()

      raf.current = requestAnimationFrame(draw)
    }
    raf.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf.current)
      window.removeEventListener('resize', resize)
    }
  }, [active])

  return <canvas ref={canvas} className="wave" aria-hidden="true" />
})
