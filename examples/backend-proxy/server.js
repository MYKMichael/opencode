import express from "express"

const app = express()
app.use(express.json({ limit: "10mb" }))

// ---------------------------------------------------------------------------
// Model mapping: frontend model name → real provider config
// ---------------------------------------------------------------------------
const MODEL_MAP = {
  "model-a": {
    provider: "anthropic",
    realModel: "claude-sonnet-4-5-20250514",
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com",
  },
  "model-b": {
    provider: "openai",
    realModel: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.openai.com",
  },
  "model-c": {
    provider: "deepseek",
    realModel: "deepseek-reasoner",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  },
}

// ---------------------------------------------------------------------------
// Token usage store (replace with a real database in production)
// ---------------------------------------------------------------------------
const usageLog = []

function logUsage(entry) {
  usageLog.push({ ...entry, timestamp: new Date().toISOString() })
  console.log("[token-usage]", JSON.stringify(entry))
}

// ---------------------------------------------------------------------------
// Helpers: convert between OpenAI and Anthropic formats
// ---------------------------------------------------------------------------

function openaiToAnthropicMessages(messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n")

  const converted = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content }
      }
      // Handle multi-part content (text + images)
      const parts = m.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text }
        if (part.type === "image_url") {
          const url = part.image_url.url
          if (url.startsWith("data:")) {
            const [meta, data] = url.split(",")
            const mediaType = meta.split(";")[0].split(":")[1]
            return {
              type: "image",
              source: { type: "base64", media_type: mediaType, data },
            }
          }
          return { type: "image", source: { type: "url", url } }
        }
        return part
      })
      return { role: m.role, content: parts }
    })

  return { system: system || undefined, messages: converted }
}

function anthropicToolToOpenAI(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }
}

function openaiToolToAnthropic(tool) {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }
}

function anthropicResponseToOpenAI(data, model) {
  const content = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")

  const toolCalls = data.content
    .filter((b) => b.type === "tool_use")
    .map((b, i) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input) },
      index: i,
    }))

  const finishReason =
    data.stop_reason === "end_turn"
      ? "stop"
      : data.stop_reason === "tool_use"
        ? "tool_calls"
        : data.stop_reason ?? "stop"

  return {
    id: `chatcmpl-${data.id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
      total_tokens:
        (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Proxy: forward to Anthropic
// ---------------------------------------------------------------------------

async function proxyAnthropic(config, body, res) {
  const { system, messages } = openaiToAnthropicMessages(body.messages)

  const anthropicBody = {
    model: config.realModel,
    max_tokens: body.max_tokens ?? 8192,
    messages,
    ...(system ? { system } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.tools
      ? { tools: body.tools.map(openaiToolToAnthropic) }
      : {}),
    ...(body.stream ? { stream: true } : {}),
  }

  const upstream = await fetch(`${config.baseURL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(anthropicBody),
  })

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error("[anthropic-error]", upstream.status, err)
    return res.status(upstream.status).json({ error: { message: err } })
  }

  if (body.stream) {
    return streamAnthropicToOpenAI(upstream, body.model, res)
  }

  const data = await upstream.json()
  const openaiResp = anthropicResponseToOpenAI(data, body.model)

  logUsage({
    model: body.model,
    realModel: config.realModel,
    provider: "anthropic",
    promptTokens: openaiResp.usage.prompt_tokens,
    completionTokens: openaiResp.usage.completion_tokens,
  })

  return res.json(openaiResp)
}

async function streamAnthropicToOpenAI(upstream, model, res) {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let inputTokens = 0
  let outputTokens = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === "[DONE]") continue

        try {
          const event = JSON.parse(payload)

          if (event.type === "message_start" && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0
          }

          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0
          }

          if (event.type === "content_block_delta") {
            const delta = event.delta
            if (delta.type === "text_delta") {
              const chunk = {
                id: `chatcmpl-stream`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: delta.text },
                    finish_reason: null,
                  },
                ],
              }
              res.write(`data: ${JSON.stringify(chunk)}\n\n`)
            }
          }

          if (event.type === "message_stop") {
            const finalChunk = {
              id: `chatcmpl-stream`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                { index: 0, delta: {}, finish_reason: "stop" },
              ],
              usage: {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
              },
            }
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
            res.write("data: [DONE]\n\n")

            logUsage({
              model,
              provider: "anthropic",
              promptTokens: inputTokens,
              completionTokens: outputTokens,
            })
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  } finally {
    res.end()
  }
}

// ---------------------------------------------------------------------------
// Proxy: forward to OpenAI-compatible providers (OpenAI, DeepSeek, etc.)
// ---------------------------------------------------------------------------

async function proxyOpenAICompatible(config, body, res) {
  const proxyBody = { ...body, model: config.realModel }

  const upstream = await fetch(`${config.baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(proxyBody),
  })

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error(`[${config.provider}-error]`, upstream.status, err)
    return res.status(upstream.status).json({ error: { message: err } })
  }

  if (body.stream) {
    // Pipe SSE stream, intercept usage for logging
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let lastUsage = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        buffer += text

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          // Rewrite model name back to frontend alias
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const chunk = JSON.parse(line.slice(6))
              chunk.model = body.model
              if (chunk.usage) lastUsage = chunk.usage
              res.write(`data: ${JSON.stringify(chunk)}\n\n`)
              continue
            } catch {
              // pass through as-is
            }
          }
          res.write(line + "\n")
        }
      }
    } finally {
      if (lastUsage) {
        logUsage({
          model: body.model,
          realModel: config.realModel,
          provider: config.provider,
          promptTokens: lastUsage.prompt_tokens,
          completionTokens: lastUsage.completion_tokens,
        })
      }
      res.end()
    }
    return
  }

  // Non-streaming
  const data = await upstream.json()
  data.model = body.model // rewrite model name

  if (data.usage) {
    logUsage({
      model: body.model,
      realModel: config.realModel,
      provider: config.provider,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    })
  }

  return res.json(data)
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------

app.post("/v1/chat/completions", async (req, res) => {
  const { model } = req.body

  const config = MODEL_MAP[model]
  if (!config) {
    return res.status(400).json({
      error: {
        message: `Unknown model: "${model}". Available: ${Object.keys(MODEL_MAP).join(", ")}`,
        type: "invalid_request_error",
      },
    })
  }

  if (!config.apiKey) {
    return res.status(500).json({
      error: {
        message: `API key not configured for provider: ${config.provider}`,
        type: "server_error",
      },
    })
  }

  try {
    if (config.provider === "anthropic") {
      return await proxyAnthropic(config, req.body, res)
    }
    // OpenAI, DeepSeek, and other OpenAI-compatible providers
    return await proxyOpenAICompatible(config, req.body, res)
  } catch (err) {
    console.error("[proxy-error]", err)
    return res.status(502).json({
      error: { message: "Upstream provider error", type: "proxy_error" },
    })
  }
})

// ---------------------------------------------------------------------------
// Token usage stats API
// ---------------------------------------------------------------------------

app.get("/api/usage", (req, res) => {
  const { model, since } = req.query
  let results = usageLog

  if (model) results = results.filter((e) => e.model === model)
  if (since) results = results.filter((e) => e.timestamp >= since)

  const summary = {}
  for (const entry of results) {
    if (!summary[entry.model]) {
      summary[entry.model] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
      }
    }
    summary[entry.model].requests++
    summary[entry.model].promptTokens += entry.promptTokens ?? 0
    summary[entry.model].completionTokens += entry.completionTokens ?? 0
  }

  res.json({ summary, total: results.length })
})

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  const available = Object.entries(MODEL_MAP)
    .filter(([, v]) => !!v.apiKey)
    .map(([k]) => k)
  res.json({ status: "ok", availableModels: available })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  const available = Object.entries(MODEL_MAP)
    .filter(([, v]) => !!v.apiKey)
    .map(([k, v]) => `${k} → ${v.provider}/${v.realModel}`)
  console.log(`\nOpenCode Backend Proxy running on http://localhost:${PORT}`)
  console.log(`Available models:`)
  available.forEach((m) => console.log(`  - ${m}`))
  console.log(`\nConfigure OpenCode with:`)
  console.log(`  "baseURL": "http://localhost:${PORT}/v1"\n`)
})
