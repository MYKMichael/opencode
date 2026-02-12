# OpenCode ACP 验证脚本使用指南

## 📋 概述

`verify_acp.js` 是一个完整的 Node.js 脚本,用于验证 OpenCode 的 ACP (Agent Client Protocol) 功能。它模拟了 LayaAir IDE 插件的后端逻辑,通过 stdio 与 OpenCode 进行 JSON-RPC 2.0 通信。

## 🎯 功能特性

### ✅ 核心功能

1. **进程管理**
   - 使用 `child_process.spawn` 启动 OpenCode ACP 模式
   - 完整的进程生命周期管理(启动/监控/清理)
   - 优雅的错误处理和退出机制

2. **JSON-RPC 2.0 通讯层**
   - 基于 `readline` 的逐行解析器
   - **解决粘包问题**: 确保每条 JSON 消息完整解析
   - 支持请求/响应/通知三种消息类型
   - 自动超时处理

3. **协议实现**
   - `initialize()` - 协议握手和能力协商
   - `newSession()` - 创建 AI 对话会话
   - `prompt()` - 发送用户消息
   - `cancel()` - 取消当前操作

4. **流式输出处理**
   - 实时捕获 `agent_message_chunk` (AI 文本输出)
   - 实时捕获 `agent_thought_chunk` (AI 思考过程)
   - 工具调用状态跟踪 (`tool_call`, `tool_call_update`)
   - 计划/待办事项显示 (`plan`)

5. **文件操作模拟**
   - `readTextFile` - 读取文件请求处理
   - `writeTextFile` - 写入文件请求处理(模拟确认)
   - `requestPermission` - 权限请求处理(模拟批准)

6. **详尽的日志系统**
   - 分级日志 (INFO/SUCCESS/ERROR/WARN/DEBUG)
   - 彩色输出
   - JSON 美化显示
   - 通信统计

## 📁 文件结构

```
opencode/
├── verify_acp.js              # 主验证脚本
├── ACP_VERIFICATION_README.md # 本文档
├── mock_project/              # 模拟 LayaAir 项目目录
│   ├── src/                   # 脚本目录(AI 会在这里生成文件)
│   ├── README.md              # 项目说明
│   └── package.json           # 项目配置
└── packages/opencode/
    └── dist/index.js          # 编译后的 OpenCode 程序
```

## 🚀 使用方法

### 前置条件

1. **已编译 OpenCode**
   ```bash
   # 在 opencode 根目录
   bun install
   bun run build
   ```

2. **Node.js 环境**
   - Node.js >= 14.x
   - 自带 `child_process` 和 `readline` 模块(无需额外安装)

### 运行脚本

```bash
# 方式 1: 直接运行
node verify_acp.js

# 方式 2: 添加执行权限后运行
chmod +x verify_acp.js
./verify_acp.js
```

### 预期输出

```
╔════════════════════════════════════════════════════════════════╗
║         OpenCode ACP Protocol Verification Script             ║
║         LayaAir IDE Plugin Backend Simulation                  ║
╚════════════════════════════════════════════════════════════════╝

[INFO] 启动 OpenCode ACP 进程...
[SUCCESS] OpenCode ACP 进程已启动
────────────────────────────────────────────────────────────────────────────────
[INFO] 🤝 开始协议初始化...
[INFO] 发送请求 [1]: initialize
[SUCCESS] 请求成功 [1]: initialize
[SUCCESS] 协议初始化成功!
[JSON] Agent Info:
{
  "name": "OpenCode",
  "version": "x.x.x"
}
────────────────────────────────────────────────────────────────────────────────
[INFO] 🎯 创建新会话...
[INFO] 发送请求 [2]: newSession
[SUCCESS] 请求成功 [2]: newSession
[SUCCESS] 会话创建成功!
[INFO] 会话 ID: session_xxxxx
────────────────────────────────────────────────────────────────────────────────
[INFO] 💬 发送 Prompt:
[INFO]    内容: 帮我在当前目录生成一个 LayaAir 3.x 的 TypeScript 脚本...
────────────────────────────────────────────────────────────────────────────────
[INFO] AI 正在思考...

我将帮你创建一个 LayaAir 3.x 的点击缩放脚本... [AI 实时输出]

[INFO] 工具调用: Write
────────────────────────────────────────────────────────────────────────────────
[INFO] 📝 收到文件写入请求:
[INFO]    路径: src/ClickScaleScript.ts
[INFO]    大小: 856 字符
────────────────────────────────────────────────────────────────────────────────
[INFO] 文件内容预览:
import { Script } from "laya/components/Script";
import { Event } from "laya/events/Event";
...
────────────────────────────────────────────────────────────────────────────────
[SUCCESS] ✅ 自动确认写入
[SUCCESS] 文件已写入: /workspace/opencode/mock_project/src/ClickScaleScript.ts
────────────────────────────────────────────────────────────────────────────────
[SUCCESS] Prompt 处理完成!
────────────────────────────────────────────────────────────────────────────────
[INFO] 📊 通信统计:
[INFO]    发送请求: 3
[INFO]    收到响应: 3
[INFO]    收到通知: 25
[INFO]    错误次数: 0
────────────────────────────────────────────────────────────────────────────────
```

## 🔧 配置选项

在 `verify_acp.js` 的 `CONFIG` 对象中可以修改以下配置:

```javascript
const CONFIG = {
  // OpenCode 可执行文件路径
  OPENCODE_BIN: path.join(__dirname, 'packages/opencode/dist/index.js'),

  // 工作目录
  WORKING_DIR: path.join(__dirname, 'mock_project'),

  // 请求超时时间(毫秒)
  REQUEST_TIMEOUT: 30000,

  // 是否启用详细日志
  VERBOSE: true,

  // 测试提示词
  TEST_PROMPT: '你的自定义提示词...'
};
```

## 📡 ACP 协议详解

### JSON-RPC 2.0 消息格式

#### 1. 请求 (Request)

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

#### 2. 响应 (Response)

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

#### 3. 通知 (Notification)

```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "xxx",
    "update": {
      "type": "agent_message_chunk",
      "content": {
        "text": "Hello"
      }
    }
  }
}
```

### 支持的方法

#### Client → Agent

| 方法 | 说明 | 参数 |
|-----|------|------|
| `initialize` | 初始化协议 | `{ protocolVersion, clientInfo }` |
| `newSession` | 创建会话 | `{ cwd, mcpServers[] }` |
| `prompt` | 发送消息 | `{ sessionId, prompt[], modelId? }` |
| `cancel` | 取消操作 | `{ sessionId }` |
| `loadSession` | 加载会话 | `{ sessionId }` |
| `setSessionMode` | 设置模式 | `{ sessionId, mode }` |

#### Agent → Client

| 方法 | 说明 | 参数 |
|-----|------|------|
| `readTextFile` | 读取文件 | `{ sessionId, path }` |
| `writeTextFile` | 写入文件 | `{ sessionId, path, content }` |
| `requestPermission` | 请求权限 | `{ sessionId, toolCall, options[] }` |

#### Agent → Client (Notifications)

| 方法 | 说明 | 触发时机 |
|-----|------|---------|
| `sessionUpdate` | 会话更新 | AI 输出、工具调用、计划更新等 |

### 会话更新类型

`sessionUpdate` 通知的 `update.type` 可能的值:

| 类型 | 说明 | 字段 |
|-----|------|------|
| `agent_message_chunk` | AI 消息片段 | `content.text` |
| `agent_thought_chunk` | AI 思考片段 | `content.text` |
| `tool_call` | 工具调用开始 | `toolCallId, tool, input` |
| `tool_call_update` | 工具执行更新 | `toolCallId, status, output` |
| `plan` | 计划/待办 | `todos[]` |
| `usage_update` | Token 统计 | `usage` |

## 🔍 关键实现细节

### 1. 粘包问题的解决

使用 `readline` 逐行读取 stdout,确保每条 JSON 消息完整:

```javascript
this.rl = readline.createInterface({
  input: this.opencodeProcess.stdout,
  crlfDelay: Infinity // 统一处理 \r\n 和 \n
});

this.rl.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line); // 每行都是完整的 JSON
  // ... 处理消息
});
```

### 2. 请求/响应匹配

使用 `Map` 存储待响应的请求:

```javascript
// 发送请求时
const id = ++this.requestId;
this.pendingRequests.set(id, { resolve, reject, timer });

// 收到响应时
const pending = this.pendingRequests.get(message.id);
pending.resolve(message.result);
this.pendingRequests.delete(message.id);
```

### 3. 文件操作的双向通信

```javascript
// Agent 请求写入文件
handleRequest(message) {
  if (message.method === 'writeTextFile') {
    // 1. 显示文件内容
    // 2. 模拟用户确认
    // 3. 写入文件
    fs.writeFileSync(fullPath, params.content);

    // 4. 发送响应
    this.sendResponse(message.id, {});
  }
}
```

## 🧪 测试场景

### 基础测试

1. **协议初始化测试**
   - 验证 `initialize` 方法
   - 检查能力协商
   - 确认 Agent 信息

2. **会话创建测试**
   - 验证 `newSession` 方法
   - 检查会话 ID 生成
   - 确认可用模型列表

3. **消息发送测试**
   - 验证 `prompt` 方法
   - 检查流式输出
   - 确认响应格式

### 高级测试

4. **文件操作测试**
   - 验证文件写入请求
   - 检查文件内容正确性
   - 确认目录自动创建

5. **权限管理测试**
   - 验证权限请求流程
   - 检查批准/拒绝机制
   - 确认选项列表

6. **错误处理测试**
   - 超时处理
   - 进程崩溃恢复
   - JSON 解析错误

## 🐛 常见问题

### Q1: 提示 "找不到 OpenCode 可执行文件"

**A:** 确保已经编译 OpenCode:
```bash
bun run build
```

### Q2: 进程启动后无响应

**A:** 检查 stderr 输出,可能是 OpenCode 内部错误:
```javascript
CONFIG.VERBOSE = true; // 启用详细日志
```

### Q3: JSON 解析错误

**A:** 检查是否有非 JSON 输出混入 stdout:
```javascript
// 脚本会自动跳过非 JSON 行
handleStdoutLine(line) {
  try {
    const message = JSON.parse(line);
  } catch (err) {
    Logger.debug(`非 JSON 输出: ${line}`);
  }
}
```

### Q4: 文件未写入

**A:** 检查工作目录权限和路径:
```javascript
// 查看实际路径
Logger.debug(`工作目录: ${this.workingDir}`);
Logger.debug(`完整路径: ${fullPath}`);
```

## 📚 扩展开发

### 添加新的处理器

```javascript
class ACPClient {
  handleSessionUpdate(params) {
    switch (params.update.type) {
      case 'your_custom_type':
        this.handleYourCustomType(params.update);
        break;
      // ...
    }
  }

  handleYourCustomType(update) {
    // 自定义处理逻辑
  }
}
```

### 集成到 IDE 插件

```javascript
const { ACPClient } = require('./verify_acp');

// 在你的插件中
class LayaAirPlugin {
  async initialize() {
    this.acpClient = new ACPClient({
      workingDir: this.projectPath
    });

    await this.acpClient.start();
    await this.acpClient.initialize();
    await this.acpClient.createSession();
  }

  async sendUserMessage(text) {
    return await this.acpClient.sendPrompt(text);
  }
}
```

### 自定义文件确认对话框

```javascript
class ACPClient {
  async handleWriteTextFile(params) {
    // 替换为实际的 UI 对话框
    const confirmed = await this.showConfirmDialog({
      title: '文件写入确认',
      message: `是否写入文件: ${params.path}`,
      content: params.content
    });

    if (confirmed) {
      fs.writeFileSync(fullPath, params.content);
      return {};
    } else {
      throw new Error('用户取消写入');
    }
  }
}
```

## 📊 性能优化建议

1. **使用流式处理**: 脚本已实现流式输出,避免等待完整响应
2. **异步操作**: 所有 I/O 操作都是异步的
3. **资源清理**: 进程退出时自动清理所有资源
4. **超时控制**: 可根据实际情况调整 `REQUEST_TIMEOUT`

## 🔒 安全考虑

1. **路径验证**: 所有文件操作都限制在 `workingDir` 内
2. **权限确认**: 敏感操作需要用户明确批准
3. **输入验证**: JSON 解析带有错误处理
4. **进程隔离**: OpenCode 运行在独立子进程中

## 📖 参考资料

- [ACP 协议规范](https://github.com/agentclientprotocol/spec)
- [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)
- [OpenCode ACP 实现](./packages/opencode/src/acp/README.md)

## 💡 贡献

欢迎提交 Issue 和 Pull Request!

## 📄 许可证

MIT License

---

**Happy Coding! 🚀**
