# OpenCode ACP - 快速参考卡片

## 🚀 快速开始

```bash
# 1. 编译 OpenCode
bun run build

# 2. 运行验证脚本
node verify_acp.js

# 或使用快速测试脚本
./quick_test_acp.sh
```

## 📁 文件清单

| 文件 | 大小 | 说明 |
|-----|------|------|
| `verify_acp.js` | 25KB | ⭐ 主验证脚本 |
| `ACP_VERIFICATION_README.md` | 14KB | 📖 使用指南 |
| `ACP_TECHNICAL_DOC.md` | 24KB | 📚 技术文档 |
| `ACP_DELIVERABLES.md` | 15KB | 📦 交付清单 |
| `example_usage.js` | 15KB | 💡 使用示例 |
| `verify_acp.config.example.js` | 7.6KB | ⚙️ 配置示例 |
| `quick_test_acp.sh` | 3.4KB | 🧪 快速测试 |
| `mock_project/` | - | 📂 模拟项目 |

## 🎯 核心 API

### 初始化流程

```javascript
const { ACPClient } = require('./verify_acp');

const client = new ACPClient({
  workingDir: '/path/to/project'
});

// 1. 启动进程
await client.start();

// 2. 初始化协议
await client.initialize();

// 3. 创建会话
await client.createSession();

// 4. 发送消息
await client.sendPrompt('your prompt here');

// 5. 清理资源
client.cleanup();
```

### 主要方法

| 方法 | 说明 | 返回值 |
|-----|------|--------|
| `start()` | 启动 OpenCode 进程 | `Promise<void>` |
| `initialize()` | 协议初始化 | `Promise<InitResult>` |
| `createSession()` | 创建会话 | `Promise<SessionResult>` |
| `sendPrompt(text, modelId?)` | 发送消息 | `Promise<PromptResult>` |
| `cancel()` | 取消操作 | `void` |
| `cleanup()` | 清理资源 | `void` |
| `printStats()` | 打印统计 | `void` |

### 可覆盖的处理器

```javascript
// 自定义文件写入
client.handleWriteTextFile = async (params) => {
  // params: { sessionId, path, content }
  // 返回: {}
};

// 自定义文件读取
client.handleReadTextFile = async (params) => {
  // params: { sessionId, path }
  // 返回: { text }
};

// 自定义权限请求
client.handleRequestPermission = async (params) => {
  // params: { sessionId, toolCall, options }
  // 返回: { outcome: { outcome, optionId } }
};

// 自定义会话更新
client.handleSessionUpdate = (params) => {
  // params: { sessionId, update }
};
```

## 📡 JSON-RPC 消息格式

### 请求 (Client → Agent)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { ... }
}
```

### 响应 (Agent → Client)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

### 通知 (Agent → Client)

```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "xxx",
    "update": { "type": "agent_message_chunk", ... }
  }
}
```

### 请求 (Agent → Client)

```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "method": "writeTextFile",
  "params": { "path": "...", "content": "..." }
}
```

## 🎨 会话更新类型

| 类型 | 说明 | 字段 |
|-----|------|------|
| `agent_message_chunk` | AI 输出文本 | `content.text` |
| `agent_thought_chunk` | AI 思考过程 | `content.text` |
| `tool_call` | 工具调用开始 | `toolCallId`, `tool`, `input` |
| `tool_call_update` | 工具执行更新 | `status`, `output` |
| `plan` | 计划/待办 | `todos[]` |
| `usage_update` | Token 统计 | `usage` |

## ⚙️ 配置选项

```javascript
const CONFIG = {
  OPENCODE_BIN: './packages/opencode/dist/index.js',
  WORKING_DIR: './mock_project',
  REQUEST_TIMEOUT: 30000,
  VERBOSE: true,
  TEST_PROMPT: '...'
};
```

## 🐛 常见问题速查

| 问题 | 解决方案 |
|-----|---------|
| 进程启动失败 | 检查 OpenCode 是否编译 |
| JSON 解析错误 | 启用 `VERBOSE: true` 查看日志 |
| 请求超时 | 增加 `REQUEST_TIMEOUT` |
| 文件未写入 | 检查工作目录权限 |

## 📊 日志级别

```javascript
Logger.info('普通信息');       // 蓝色
Logger.success('成功消息');    // 绿色
Logger.error('错误消息');      // 红色
Logger.warn('警告消息');       // 黄色
Logger.debug('调试信息');      // 灰色
Logger.json('Label', obj);    // JSON 美化
```

## 🔍 调试技巧

### 启用详细日志

```javascript
CONFIG.VERBOSE = true;
```

### 查看所有消息

```javascript
client.handleStdoutLine = (line) => {
  console.log('[RAW]', line);
  // ... 原始处理
};
```

### 记录所有请求/响应

```javascript
const messages = [];

client.sendRequest = async function(method, params) {
  messages.push({ type: 'request', method, params, time: Date.now() });
  return await originalSendRequest.call(this, method, params);
};
```

## 📝 使用示例

### 示例 1: 基础使用

```bash
node example_usage.js 1
```

### 示例 2: 多轮对话

```bash
node example_usage.js 2
```

### 示例 3: 自定义处理器

```bash
node example_usage.js 3
```

### 运行所有示例

```bash
node example_usage.js all
```

## 🔗 相关链接

- **使用指南**: [ACP_VERIFICATION_README.md](./ACP_VERIFICATION_README.md)
- **技术文档**: [ACP_TECHNICAL_DOC.md](./ACP_TECHNICAL_DOC.md)
- **交付清单**: [ACP_DELIVERABLES.md](./ACP_DELIVERABLES.md)
- **ACP 规范**: https://github.com/agentclientprotocol/spec
- **JSON-RPC 2.0**: https://www.jsonrpc.org/specification

## 💡 小贴士

1. ✅ 使用 `readline` 解决粘包问题
2. ✅ 使用 `Map` 管理异步请求
3. ✅ 始终在 `finally` 中清理资源
4. ✅ 为每个请求设置超时
5. ✅ 验证文件路径防止遍历攻击
6. ✅ 捕获所有异常并记录日志

## 🎯 集成检查清单

- [ ] 实现文件确认对话框
- [ ] 实现权限确认对话框
- [ ] 添加加载状态指示器
- [ ] 处理进程崩溃情况
- [ ] 实现会话持久化
- [ ] 添加用户取消按钮
- [ ] 显示 Token 使用统计
- [ ] 集成到 IDE 菜单

## 📈 性能建议

- ⚡ 使用流式处理避免内存累积
- ⚡ 及时清理 `pendingRequests` Map
- ⚡ 对于长时间运行的任务设置更长的超时
- ⚡ 使用 `Buffer.concat()` 而不是字符串拼接

## 🔒 安全建议

- 🔐 验证所有文件路径
- 🔐 敏感操作需要用户确认
- 🔐 限制文件写入的目标目录
- 🔐 过滤危险的文件扩展名(.exe, .sh, .bat)
- 🔐 使用黑名单阻止关键文件(.env, .key, .pem)

---

**版本**: 1.0.0
**最后更新**: 2024-02-11

**快速帮助**: `node verify_acp.js --help`
