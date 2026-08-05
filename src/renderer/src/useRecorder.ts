import { useCallback, useRef } from 'react'

type StartOptions = {
  /** Called ~60x/sec with the current analyser buffer, for drawing. */
  onFrame: (samples: Uint8Array, rms: number) => void
  /** Called once recording ends, with the encoded clip. */
  onDone: (clip: ArrayBuffer) => void
  /** Stop automatically after this many ms below the speech threshold. */
  silenceMs?: number
  maxMs?: number
}

const THRESHOLD = 0.012

export function useRecorder() {
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const raf = useRef<number>(0)

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    ctx.current?.close().catch(() => {})
    stream.current = null
    ctx.current = null
    recorder.current = null
  }, [])

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    else teardown()
  }, [teardown])

  const start = useCallback(
    async ({ onFrame, onDone, silenceMs = 1100, maxMs = 20000 }: StartOptions) => {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      stream.current = media

      const audio = new AudioContext()
      ctx.current = audio
      const analyser = audio.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.65
      audio.createMediaStreamSource(media).connect(analyser)

      const buf = new Uint8Array(analyser.fftSize)
      const chunks: BlobPart[] = []

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const rec = new MediaRecorder(media, { mimeType: mime })
      recorder.current = rec

      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        teardown()
        if (blob.size > 1200) onDone(await blob.arrayBuffer())
        else onDone(new ArrayBuffer(0))
      }
      rec.start()

      const began = performance.now()
      let lastVoice = began
      let heardAnything = false

      const tick = () => {
        analyser.getByteTimeDomainData(buf)

        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        onFrame(buf, rms)

        const now = performance.now()
        if (rms > THRESHOLD) {
          lastVoice = now
          heardAnything = true
        }

        if ((heardAnything && now - lastVoice > silenceMs) || now - began > maxMs) {
          stop()
          return
        }
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    },
    [stop, teardown]
  )

  return { start, stop }
}
