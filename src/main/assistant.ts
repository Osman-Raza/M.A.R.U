import Anthropic from '@anthropic-ai/sdk'
import * as db from './db'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = process.env.MARU_MODEL ?? 'claude-haiku-4-5-20251001'

/** Send raw audio to Whisper. Returns the transcript text. */
export async function transcribe(buffer: ArrayBuffer, mime = 'audio/webm'): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mime }), 'clip.webm')
  form.append('model', 'whisper-1')
  form.append('language', 'en')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  })

  if (!res.ok) throw new Error(`Transcription failed (${res.status})`)
  const data = (await res.json()) as { text: string }
  return data.text.trim()
}

const tools: Anthropic.Tool[] = [
  {
    name: 'add_task',
    description: 'Save a new assignment, task, exam, or reminder.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short specific name, e.g. "Lab 3 writeup".' },
        kind: { type: 'string', enum: ['task', 'assignment', 'exam', 'reading'] },
        course: {
          type: 'string',
          description: 'Course code like "COMPSCI 1MD3". Omit if not mentioned.'
        },
        due_at: {
          type: 'string',
          description: 'Local ISO 8601, e.g. 2026-09-14T23:59. Omit if no deadline.'
        },
        notes: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'list_tasks',
    description: 'Look up open work. Use this before answering any question about what is due.',
    input_schema: {
      type: 'object',
      properties: {
        window: { type: 'string', enum: ['today', 'tomorrow', 'week', 'ahead', 'overdue', 'all'] },
        course: { type: 'string' },
        include_done: { type: 'boolean' }
      }
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a task done. Match on a few distinctive words from its title.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  },
  {
    name: 'reschedule_task',
    description: 'Change the due date of an existing task.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, due_at: { type: 'string' } },
      required: ['query', 'due_at']
    }
  },
  {
    name: 'delete_task',
    description: 'Remove a task entirely. Only when the user says delete or remove.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  },
  {
    name: 'add_class_time',
    description: 'Save a recurring weekly class slot.',
    input_schema: {
      type: 'object',
      properties: {
        course: { type: 'string' },
        weekday: { type: 'string', description: 'Monday through Sunday.' },
        start: { type: 'string', description: '24h HH:MM' },
        end: { type: 'string', description: '24h HH:MM' },
        location: { type: 'string' }
      },
      required: ['course', 'weekday', 'start', 'end']
    }
  },
  {
    name: 'get_schedule',
    description: 'Look up class times for a weekday. Defaults to today.',
    input_schema: {
      type: 'object',
      properties: { weekday: { type: 'string' } }
    }
  }
]

const handlers: Record<string, (a: any) => unknown> = {
  add_task: db.addTask,
  list_tasks: db.listTasks,
  complete_task: db.completeTask,
  reschedule_task: db.rescheduleTask,
  delete_task: db.deleteTask,
  add_class_time: db.addClassTime,
  get_schedule: db.getSchedule
}

function systemPrompt(): string {
  const now = new Date()
  const stamp = now.toLocaleString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  return [
    `You run a voice assistant on the user's desktop. They speak one short command at a time.`,
    `Right now it is ${stamp} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    ``,
    `Resolve relative dates yourself against the time above. "Friday" means the next upcoming Friday.`,
    `If a deadline has no time attached, assume 23:59.`,
    `Never invent tasks. If asked what is due, call list_tasks before answering.`,
    ``,
    `Titles come from speech, so they arrive vague. Keep whatever detail the user gave and do not`,
    `pad it out. If add_task comes back with duplicate: true, say you already have that one`,
    `instead of claiming you added it.`,
    ``,
    `Reply in one sentence, under 15 words, confirming what you did.`,
    `Good: "Added Lab 3 writeup, due Friday 11:59pm."`,
    `Good: "Three things due this week."`,
    `Good: "Already have that one."`,
    `Bad: "I've gone ahead and successfully added that task to your list for you!"`,
    `Never use bullet points or markdown. The reply is read on a small overlay.`
  ].join('\n')
}

export type RunResult = {
  reply: string
  tasks: db.Task[]
  schedule: ReturnType<typeof db.getSchedule> | null
  actions: string[]
}

export async function run(transcript: string): Promise<RunResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: transcript }]
  const out: RunResult = { reply: '', tasks: [], schedule: null, actions: [] }

  for (let hop = 0; hop < 5; hop++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(),
      tools,
      messages
    })

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()

    if (text) out.reply = text
    if (!toolUses.length) break

    messages.push({ role: 'assistant', content: res.content })

    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((use) => {
      out.actions.push(use.name)
      let result: unknown
      try {
        result = handlers[use.name](use.input)
      } catch (err) {
        result = { error: (err as Error).message }
      }

      if (use.name === 'list_tasks' && Array.isArray(result)) out.tasks = result as db.Task[]
      if (use.name === 'get_schedule') out.schedule = result as RunResult['schedule']
      if (use.name === 'add_task' && result && typeof result === 'object') {
        out.tasks = [result as db.Task]
      }

      return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) }
    })

    messages.push({ role: 'user', content: results })
  }

  if (!out.reply) out.reply = 'Done.'
  return out
}
