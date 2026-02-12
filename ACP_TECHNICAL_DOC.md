# OpenCode ACP 技术文档

## 🎯 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         LayaAir IDE Plugin                       │
│                      (或其他客户端应用)                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ JSON-RPC 2.0 over stdio
                      │ (newline-delimited JSON)
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                       verify_acp.js                              │
│                  (Node.js ACP Client)                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  • child_process.spawn (进程管理)                          │ │
│  │  • readline (粘包处理)                                     │ │
│  │  • JSON-RPC 解析器 (请求/响应/通知)                       │ │
│  │  • 文件操作处理器                                          │ │
│  │  • 权限管理处理器                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ stdin/stdout
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                  OpenCode ACP Process                            │
│                (bun run opencode acp --cwd ...)                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  packages/opencode/src/acp/agent.ts                        │ │
│  │  • AgentSideConnection                                     │ │
│  │  • SessionManager                                          │ │
│  │  • Event Subscription (权限/消息更新)                     │ │
│  │  • Tool Execution                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ HTTP API
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                  OpenCode Internal Server                        │
│                (Hono HTTP Server + SDK)                          │
│  • Session Management                                            │
│  • Message Handling                                              │
│  • Tool Registry                                                 │
│  • LLM Integration                                               │
└─────────────────────────────────────────────────────────────────┘
```

## 📡 通信协议详解

### 1. 消息格式

所有消息都是 **newline-delimited JSON** (NDJSON) 格式:

```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}\n
{"jsonrpc":"2.0","id":1,"result":{...}}\n
{"jsonrpc":"2.0","method":"sessionUpdate","params":{...}}\n
```

每条消息占一行,以 `\n` 结尾。

### 2. 消息类型

#### 2.1 请求 (Request)

**特征**: 包含 `id` 和 `method`,需要响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "LayaAir IDE Plugin",
      "version": "1.0.0"
    }
  }
}
```

#### 2.2 响应 (Response)

**特征**: 包含 `id` 和 `result`(成功) 或 `error`(失败)

**成功响应:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "OpenCode",
      "version": "1.0.0"
    }
  }
}
```

**错误响应:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": { "details": "..." }
  }
}
```

#### 2.3 通知 (Notification)

**特征**: 包含 `method` 但没有 `id`,不需要响应

```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "session_abc123",
    "update": {
      "type": "agent_message_chunk",
      "content": {
        "text": "I'll help you create..."
      }
    }
  }
}
```

### 3. 错误码

| 错误码 | 含义 | 说明 |
|-------|------|------|
| `-32700` | Parse error | JSON 解析失败 |
| `-32600` | Invalid Request | 请求格式错误 |
| `-32601` | Method not found | 方法不存在 |
| `-32602` | Invalid params | 参数错误 |
| `-32603` | Internal error | 内部错误 |

## 🔄 协议流程

### 完整的交互流程

```
Client                                    Agent
  │                                         │
  │─────(1) initialize ──────────────────>│
  │                                         │
  │<────(2) initialize result ────────────│
  │     (agentInfo, capabilities)          │
  │                                         │
  │─────(3) newSession ───────────────────>│
  │     (cwd, mcpServers)                  │
  │                                         │
  │<────(4) newSession result ────────────│
  │     (sessionId, models)                │
  │                                         │
  │─────(5) prompt ───────────────────────>│
  │     (sessionId, prompt[])              │
  │                                         │
  │<────(6) sessionUpdate ────────────────│ (通知)
  │     (type: agent_message_chunk)        │
  │                                         │
  │<────(7) sessionUpdate ────────────────│ (通知)
  │     (type: tool_call)                  │
  │                                         │
  │<────(8) requestPermission ────────────│ (请求)
  │     (toolCall, options)                │
  │                                         │
  │─────(9) requestPermission result ─────>│
  │     (outcome: approved)                │
  │                                         │
  │<────(10) writeTextFile ───────────────│ (请求)
  │     (path, content)                    │
  │                                         │
  │─────(11) writeTextFile result ────────>│
  │     ({})                                │
  │                                         │
  │<────(12) sessionUpdate ───────────────│ (通知)
  │     (type: tool_call_update, status: completed) │
  │                                         │
  │<────(13) prompt result ───────────────│
  │     (stopReason, usage)                │
  │                                         │
```

### 详细步骤说明

#### 步骤 1-2: 协议初始化

**Client → Agent:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "LayaAir IDE Plugin",
      "version": "1.0.0"
    }
  }
}
```

**Agent → Client:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "OpenCode",
      "version": "1.0.0"
    },
    "agentCapabilities": {
      "loadSession": true,
      "mcpCapabilities": {
        "http": true,
        "sse": true
      },
      "promptCapabilities": {
        "embeddedContext": true,
        "image": true
      },
      "sessionCapabilities": {
        "fork": {},
        "list": {},
        "resume": {}
      }
    },
    "authMethods": [
      {
        "id": "opencode-login",
        "name": "Login with OpenCode"
      }
    ]
  }
}
```

#### 步骤 3-4: 创建会话

**Client → Agent:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "newSession",
  "params": {
    "cwd": "/path/to/mock_project",
    "mcpServers": []
  }
}
```

**Agent → Client:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "session_abc123",
    "models": [
      {
        "id": "claude-sonnet-4.5",
        "name": "Claude Sonnet 4.5",
        "provider": "anthropic"
      }
    ],
    "modes": ["default", "plan"]
  }
}
```

#### 步骤 5-13: 发送 Prompt 和处理响应

**Client → Agent:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "prompt",
  "params": {
    "sessionId": "session_abc123",
    "prompt": [
      {
        "type": "text",
        "text": "帮我生成一个 LayaAir 脚本..."
      }
    ]
  }
}
```

**Agent → Client (多个通知):**

1. AI 开始输出:
```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "session_abc123",
    "update": {
      "type": "agent_message_chunk",
      "content": {
        "text": "我将帮你创建一个"
      }
    }
  }
}
```

2. AI 调用工具:
```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "session_abc123",
    "update": {
      "type": "tool_call",
      "toolCallId": "call_123",
      "tool": "Write",
      "input": {
        "filePath": "src/Script.ts",
        "content": "..."
      }
    }
  }
}
```

3. 请求权限:
```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "method": "requestPermission",
  "params": {
    "sessionId": "session_abc123",
    "toolCall": {
      "toolCallId": "call_123",
      "status": "pending",
      "title": "edit",
      "kind": "edit",
      "locations": [
        {
          "type": "path",
          "path": "src/Script.ts"
        }
      ]
    },
    "options": [
      {
        "id": "approve",
        "label": "Approve"
      },
      {
        "id": "reject",
        "label": "Reject"
      }
    ]
  }
}
```

**Client → Agent (权限响应):**
```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "result": {
    "outcome": {
      "outcome": "approved",
      "optionId": "approve"
    }
  }
}
```

4. 请求写入文件:
```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "writeTextFile",
  "params": {
    "sessionId": "session_abc123",
    "path": "src/Script.ts",
    "content": "import { Script } from 'laya/components/Script';\n..."
  }
}
```

**Client → Agent (文件写入响应):**
```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "result": {}
}
```

5. 工具执行完成:
```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "session_abc123",
    "update": {
      "type": "tool_call_update",
      "toolCallId": "call_123",
      "status": "completed",
      "output": {
        "success": true
      }
    }
  }
}
```

**Agent → Client (最终响应):**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "end_turn",
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 567
    }
  }
}
```

## 🛠️ 实现细节

### 1. 粘包问题的解决

**问题**: stdout 是流式输出,多条 JSON 可能粘在一起:

```
{"jsonrpc":"2.0",...}{"jsonrpc":"2.0",...}{"jsonrpc":"2.0",...}
```

**解决方案**: 使用 `readline` 逐行读取,每行是一条完整的 JSON:

```javascript
const readline = require('readline');

this.rl = readline.createInterface({
  input: this.opencodeProcess.stdout,
  crlfDelay: Infinity // 统一处理 \r\n 和 \n
});

this.rl.on('line', (line) => {
  if (!line.trim()) return; // 跳过空行

  try {
    const message = JSON.parse(line); // 每行都是完整的 JSON
    this.handleMessage(message);
  } catch (err) {
    // 非 JSON 输出,忽略或记录
  }
});
```

### 2. 请求/响应匹配

**问题**: 异步请求可能乱序返回,需要通过 `id` 匹配。

**解决方案**: 使用 `Map` 存储待响应的请求:

```javascript
class ACPClient {
  constructor() {
    this.requestId = 0;
    this.pendingRequests = new Map(); // id -> {resolve, reject, timer}
  }

  async sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      // 存储
      this.pendingRequests.set(id, { method, resolve, reject, timer });

      // 发送
      this.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n');
    });
  }

  handleResponse(message) {
    const { id, result, error } = message;
    const pending = this.pendingRequests.get(id);

    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);

    if (error) {
      pending.reject(new Error(error.message));
    } else {
      pending.resolve(result);
    }
  }
}
```

### 3. 流式输出的处理

**问题**: AI 输出是流式的,需要实时显示。

**解决方案**: 监听 `agent_message_chunk` 通知:

```javascript
handleSessionUpdate(params) {
  const { update } = params;

  switch (update.type) {
    case 'agent_message_chunk':
      // 不换行,实时输出
      process.stdout.write(update.content.text);
      break;

    case 'agent_thought_chunk':
      // 显示思考过程(可选)
      console.log(`[THOUGHT] ${update.content.text}`);
      break;
  }
}
```

### 4. 双向通信

**关键点**: Agent 也可以向 Client 发送请求(如文件操作)。

**实现**:

```javascript
class ACPClient {
  handleStdoutLine(line) {
    const message = JSON.parse(line);
    const type = this.getMessageType(message);

    switch (type) {
      case 'response':
        // Client 发送的请求的响应
        this.handleResponse(message);
        break;

      case 'notification':
        // Agent 发送的通知(如会话更新)
        this.handleNotification(message);
        break;

      case 'request':
        // Agent 发送的请求(如文件操作)
        this.handleRequest(message);
        break;
    }
  }

  async handleRequest(message) {
    const { id, method, params } = message;

    try {
      let result = {};

      // 处理 Agent 的请求
      if (method === 'writeTextFile') {
        result = await this.handleWriteTextFile(params);
      }

      // 发送响应
      this.sendResponse(id, result);
    } catch (err) {
      this.sendErrorResponse(id, -32603, err.message);
    }
  }

  sendResponse(id, result) {
    this.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result
    }) + '\n');
  }
}
```

## 📊 性能考虑

### 1. 消息缓冲

**优化**: 使用 Buffer 而不是字符串拼接:

```javascript
const chunks = [];

process.stdout.on('data', (chunk) => {
  chunks.push(chunk);
});

// 完成后
const fullOutput = Buffer.concat(chunks).toString('utf-8');
```

### 2. 超时控制

**建议**:
- `initialize`: 30秒
- `newSession`: 30秒
- `prompt`: 5分钟(AI 处理时间较长)

### 3. 内存管理

**注意**:
- 及时清理 `pendingRequests`
- 流式输出不要累积大量文本
- 进程退出时清理所有资源

## 🔒 安全考虑

### 1. 路径验证

```javascript
async handleWriteTextFile(params) {
  const { path: filePath } = params;

  // 解析为绝对路径
  const fullPath = path.resolve(this.workingDir, filePath);

  // 检查是否在工作目录内(防止路径遍历攻击)
  if (!fullPath.startsWith(this.workingDir)) {
    throw new Error('Invalid path: outside working directory');
  }

  // 检查黑名单
  const blocked = [/\.env$/, /\.key$/, /node_modules\//];
  if (blocked.some(pattern => pattern.test(filePath))) {
    throw new Error('Access denied: blocked path pattern');
  }

  // 写入文件
  fs.writeFileSync(fullPath, params.content);
}
```

### 2. 权限控制

```javascript
async handleRequestPermission(params) {
  const { toolCall } = params;

  // 自动批准的工具类型
  const autoApprove = ['read', 'search', 'fetch'];

  if (autoApprove.includes(toolCall.kind)) {
    return {
      outcome: {
        outcome: 'approved',
        optionId: 'approve'
      }
    };
  }

  // 其他操作需要用户确认
  return await this.showConfirmDialog(toolCall);
}
```

### 3. 输入验证

```javascript
// 验证 JSON-RPC 消息
function validateMessage(message) {
  if (message.jsonrpc !== '2.0') {
    throw new Error('Invalid JSON-RPC version');
  }

  if (message.method && typeof message.method !== 'string') {
    throw new Error('Invalid method');
  }

  if (message.id !== undefined) {
    if (typeof message.id !== 'number' && typeof message.id !== 'string') {
      throw new Error('Invalid id');
    }
  }
}
```

## 🧪 测试策略

### 1. 单元测试

```javascript
// 测试 JSON-RPC 消息创建
test('createJsonRpcRequest', () => {
  const request = createJsonRpcRequest('initialize', { version: 1 }, 1);

  expect(request).toEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { version: 1 }
  });
});

// 测试消息类型判断
test('getMessageType', () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'test', params: {} };
  const response = { jsonrpc: '2.0', id: 1, result: {} };
  const notification = { jsonrpc: '2.0', method: 'notify', params: {} };

  expect(getMessageType(request)).toBe('request');
  expect(getMessageType(response)).toBe('response');
  expect(getMessageType(notification)).toBe('notification');
});
```

### 2. 集成测试

```javascript
// 测试完整流程
test('full ACP flow', async () => {
  const client = new ACPClient();

  await client.start();
  const initResult = await client.initialize();
  expect(initResult.protocolVersion).toBe(1);

  const sessionResult = await client.createSession();
  expect(sessionResult.sessionId).toBeTruthy();

  const promptResult = await client.sendPrompt('Hello');
  expect(promptResult.stopReason).toBeTruthy();

  client.cleanup();
});
```

### 3. 压力测试

```javascript
// 测试并发请求
test('concurrent requests', async () => {
  const client = new ACPClient();
  await client.start();
  await client.initialize();
  await client.createSession();

  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(client.sendPrompt(`Test ${i}`));
  }

  const results = await Promise.all(promises);
  expect(results.length).toBe(10);

  client.cleanup();
});
```

## 📈 监控和调试

### 1. 日志系统

```javascript
class Logger {
  static log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level}] ${message}`;

    console.log(formatted, ...args);

    // 可选: 写入文件
    if (this.logToFile) {
      fs.appendFileSync(this.logFile, formatted + '\n');
    }
  }
}
```

### 2. 性能监控

```javascript
class ACPClient {
  constructor() {
    this.stats = {
      requestsSent: 0,
      responsesReceived: 0,
      notificationsReceived: 0,
      errors: 0,
      avgResponseTime: 0
    };
  }

  async sendRequest(method, params) {
    const startTime = Date.now();
    this.stats.requestsSent++;

    try {
      const result = await this._sendRequest(method, params);
      this.stats.responsesReceived++;

      const duration = Date.now() - startTime;
      this.updateAvgResponseTime(duration);

      return result;
    } catch (err) {
      this.stats.errors++;
      throw err;
    }
  }

  printStats() {
    console.log('Statistics:');
    console.log(`  Requests sent: ${this.stats.requestsSent}`);
    console.log(`  Responses received: ${this.stats.responsesReceived}`);
    console.log(`  Notifications: ${this.stats.notificationsReceived}`);
    console.log(`  Errors: ${this.stats.errors}`);
    console.log(`  Avg response time: ${this.stats.avgResponseTime}ms`);
  }
}
```

### 3. 调试工具

```javascript
// 保存所有消息到文件
class MessageRecorder {
  constructor(dir) {
    this.dir = dir;
    this.index = 0;
    fs.mkdirSync(dir, { recursive: true });
  }

  record(direction, message) {
    const filename = `${this.index++}_${direction}_${message.method || 'response'}.json`;
    const filepath = path.join(this.dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(message, null, 2));
  }
}

// 使用
const recorder = new MessageRecorder('./acp_messages');
recorder.record('sent', request);
recorder.record('received', response);
```

## 🎓 最佳实践

### 1. 错误处理

```javascript
// ✅ 好的做法
try {
  const result = await client.sendPrompt(text);
} catch (err) {
  if (err.message.includes('timeout')) {
    // 重试
    return await client.sendPrompt(text);
  } else {
    // 记录并抛出
    Logger.error('Prompt failed:', err);
    throw err;
  }
}

// ❌ 不好的做法
const result = await client.sendPrompt(text); // 可能抛出未捕获的异常
```

### 2. 资源清理

```javascript
// ✅ 好的做法
class ACPClient {
  async runTest() {
    try {
      await this.start();
      await this.initialize();
      // ...
    } finally {
      this.cleanup(); // 确保总是清理
    }
  }

  cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    // 拒绝所有待响应的请求
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Process terminated'));
    }
    this.pendingRequests.clear();
  }
}
```

### 3. 类型安全

```javascript
// ✅ 使用 JSDoc 提供类型提示
/**
 * @typedef {Object} PromptParams
 * @property {string} sessionId
 * @property {Array<PromptItem>} prompt
 * @property {string} [modelId]
 */

/**
 * @param {PromptParams} params
 * @returns {Promise<PromptResult>}
 */
async sendPrompt(params) {
  // ...
}
```

## 📚 参考资源

- [ACP 协议规范](https://github.com/agentclientprotocol/spec)
- [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)
- [OpenCode ACP 源码](./packages/opencode/src/acp/)
- [Node.js child_process 文档](https://nodejs.org/api/child_process.html)
- [Node.js readline 文档](https://nodejs.org/api/readline.html)

---

**最后更新**: 2024-02-11
