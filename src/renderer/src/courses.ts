/**
 * Course colours are derived from the code itself, not stored, so a course keeps
 * the same colour across restarts without a migration. Hues are spaced far enough
 * apart that two courses on the same day never read as the same block.
 */
const PALETTE = [
  '#FF8A5B', // ember
  '#4DC9F6', // ice
  '#A78BFA', // iris
  '#4ADE80', // mint
  '#FBBF24', // amber
  '#F472B6', // rose
  '#2DD4BF', // teal
  '#FB7185' // coral
] as const

export function courseColor(code: string | null | undefined): string {
  if (!code) return '#7A87A3'
  let h = 0
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** "COMPSCI 1MD3" -> "1MD3". Falls back to the first token when there is no code half. */
export function shortCourse(code: string | null | undefined): string {
  if (!code) return ''
  const parts = code.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : parts[0]
}

export const fmtMin = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
