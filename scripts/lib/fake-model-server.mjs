import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Loopback OpenAI-compatible Chat Completions stub for headless gate probes.
 * It never forwards anything: every reply is scripted. A request selects its
 * script through a `⟦gate:<id>⟧` marker in a user message; the step is the
 * number of assistant messages after that message. Requests without tools
 * (session titles and other auxiliary calls) get a short fixed reply.
 *
 * A step is `{ chunks?, chunkDelayMs?, firstDelayMs?, toolCall?, hang? }`:
 * text chunks are streamed, then an optional tool call, then the stream either
 * finishes or, with `hang`, stays open until the client closes it or
 * `releaseHangs()` is called. Only the marker set, tool names and timing are
 * recorded; prompt text is not retained.
 */
export const FAKE_MODEL_KEY = 'sk-corn-gate-FAKE-0000'
export const FAKE_PROVIDER = 'corn-gate-fake'
export const FAKE_MODEL = 'corn-gate-model'
export const FAKE_KEY_ENV = 'CORN_GATE_FAKE_API_KEY'

const MARKER = /⟦([a-z]+):([^⟧]+)⟧/gu

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
  return ''
}

/** Markers in user messages, in message order, plus the script selection. */
export function classifyRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const markers = []
  let scriptId
  let scriptIndex = -1
  messages.forEach((message, index) => {
    if (message?.role !== 'user') return
    for (const match of textOf(message.content).matchAll(MARKER)) {
      markers.push(`${match[1]}:${match[2]}`)
      if (match[1] === 'gate' && scriptId === undefined) {
        scriptId = match[2]
        scriptIndex = index
      }
    }
  })
  const step =
    scriptIndex < 0
      ? 0
      : messages.slice(scriptIndex + 1).filter((m) => m?.role === 'assistant')
          .length
  const tools = Array.isArray(body?.tools)
    ? body.tools.map((tool) => tool?.function?.name ?? tool?.name).sort()
    : []
  return {
    kind: tools.length > 0 ? 'agent' : 'aux',
    scriptId,
    step,
    markers,
    tools,
    toolResults: messages.filter((m) => m?.role === 'tool').length,
  }
}

function chunk(id, model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

export async function startFakeModel({ scripts = {}, auxReply = 'ok' } = {}) {
  const requests = []
  const hangs = new Set()
  const sockets = new Set()

  async function stream(response, row, steps, closed) {
    const id = `chatcmpl-${randomUUID()}`
    const model = row.model
    const write = (text) => {
      if (closed.value) return false
      if (row.firstByteAt === undefined) row.firstByteAt = Date.now()
      response.write(text)
      return true
    }
    const step = steps[Math.min(row.step, steps.length - 1)] ?? {
      chunks: ['done'],
    }
    row.stepPlan = {
      chunks: step.chunks?.length ?? 0,
      toolCall: step.toolCall?.name ?? null,
      hang: step.hang === true,
    }
    if (step.firstDelayMs) await delay(step.firstDelayMs)
    write(chunk(id, model, { role: 'assistant', content: '' }))
    for (const text of step.chunks ?? []) {
      if (step.chunkDelayMs) await delay(step.chunkDelayMs)
      if (!write(chunk(id, model, { content: text }))) return
      row.chunksSent++
    }
    if (step.toolCall) {
      const callId = `call_${randomUUID().replaceAll('-', '').slice(0, 20)}`
      row.toolCallId = callId
      if (
        !write(
          chunk(id, model, {
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: 'function',
                function: {
                  name: step.toolCall.name,
                  arguments: JSON.stringify(step.toolCall.arguments ?? {}),
                },
              },
            ],
          }),
        )
      )
        return
    }
    if (step.hang) {
      row.hanging = true
      await new Promise((resolve) => {
        const entry = { resolve }
        hangs.add(entry)
        closed.onClose = () => {
          hangs.delete(entry)
          resolve()
        }
      })
      row.hanging = false
      if (closed.value) return
    }
    const finish = step.toolCall ? 'tool_calls' : 'stop'
    write(chunk(id, model, {}, finish))
    write('data: [DONE]\n\n')
    response.end()
    row.completed = true
  }

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'GET' && path.endsWith('/models')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: FAKE_MODEL }] }))
      return
    }
    if (request.method !== 'POST' || !path.endsWith('/chat/completions')) {
      response.statusCode = 404
      response.end('not found')
      return
    }
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (part) => {
      text += part
    })
    request.on('end', () => {
      let body
      try {
        body = JSON.parse(text)
      } catch {
        response.statusCode = 400
        response.end('bad json')
        return
      }
      const facts = classifyRequest(body)
      const row = {
        index: requests.length,
        receivedAt: Date.now(),
        authOk: request.headers.authorization === `Bearer ${FAKE_MODEL_KEY}`,
        model: typeof body.model === 'string' ? body.model : null,
        stream: body.stream === true,
        ...facts,
        chunksSent: 0,
        firstByteAt: undefined,
        endedAt: undefined,
        closedByClient: false,
        completed: false,
        hanging: false,
      }
      requests.push(row)
      const closed = { value: false, onClose: undefined }
      response.on('close', () => {
        row.endedAt = Date.now()
        if (!row.completed) {
          closed.value = true
          row.closedByClient = true
          closed.onClose?.()
        }
      })
      // Auxiliary calls (titles) carry the prompt's marker but no tools; they
      // always get the fixed reply so a script only drives the agent loop.
      const steps =
        facts.kind === 'agent' && facts.scriptId
          ? scripts[facts.scriptId]
          : undefined
      if (!row.stream) {
        response.setHeader('Content-Type', 'application/json')
        response.end(
          JSON.stringify({
            id: `chatcmpl-${randomUUID()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: row.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: auxReply },
                finish_reason: 'stop',
              },
            ],
          }),
        )
        row.completed = true
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      stream(response, row, steps ?? [{ chunks: [auxReply] }], closed).catch(
        () => {
          if (!response.writableEnded) response.destroy()
        },
      )
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    /** Ends every hanging stream normally. */
    releaseHangs() {
      for (const entry of [...hangs]) {
        hangs.delete(entry)
        entry.resolve()
      }
    },
    async waitFor(predicate, label, timeoutMs = 20_000) {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) {
        const found = requests.find(predicate)
        if (found) return found
        await delay(25)
      }
      throw new Error(`Fake model deadline exceeded: ${label}`)
    },
    /** Drops every connection, bounded; the server never outlives its run. */
    async close() {
      for (const entry of [...hangs]) entry.resolve()
      hangs.clear()
      for (const socket of sockets) socket.destroy()
      await Promise.race([
        new Promise((resolve) => server.close(() => resolve())),
        delay(5_000),
      ])
    },
  }
}
