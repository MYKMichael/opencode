# OpenCode Backend Proxy

将 OpenCode 封装为第三方工具，后端统一管理 API Key 和 Token 统计。

## 架构

```
用户 → OpenCode → 后端代理 (本服务) → Anthropic / OpenAI / DeepSeek
                     │
                     ├── API Key 注入 (前端无需填写)
                     ├── 模型映射 (model-a → claude-sonnet-4-5)
                     └── Token 统计
```

## 快速开始

### 1. 启动后端

```bash
cd examples/backend-proxy
cp .env.example .env
# 编辑 .env，填入真实 API Key

npm install
npm run dev
```

### 2. 配置 OpenCode 前端

将 `opencode.json` 复制到你的项目根目录，修改 `baseURL` 指向后端地址：

```json
{
  "provider": {
    "my-backend": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:3000/v1"
      }
    }
  }
}
```

### 3. 启动 OpenCode

```bash
opencode
# 按 Ctrl+K 选择模型，应该能看到 model-a / model-b / model-c
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | OpenAI Compatible 聊天接口 |
| GET | `/api/usage` | Token 用量统计 |
| GET | `/health` | 健康检查 |

## 自定义模型

编辑 `server.js` 中的 `MODEL_MAP`：

```js
const MODEL_MAP = {
  "my-model": {
    provider: "openai",          // "openai" | "anthropic" | "deepseek" 等
    realModel: "gpt-4o",         // 真实模型 ID
    apiKey: process.env.MY_KEY,  // API Key
    baseURL: "https://api.openai.com",
  },
}
```

同时在 `opencode.json` 的 `models` 中添加对应条目。

## 生产部署建议

- 使用 HTTPS
- 添加请求身份验证 (JWT / API Key)
- 将 `usageLog` 替换为真实数据库 (PostgreSQL / MongoDB)
- 添加请求速率限制
- 考虑使用 [LiteLLM](https://github.com/BerriAI/litellm) 替代本服务，它提供了更完善的代理功能

## LiteLLM 方案（推荐多模型场景）

如果你需要接入较多模型，推荐使用 LiteLLM 替代 `server.js`，只需配置文件即可管理所有模型路由，无需编写代码。

详见 **[LITELLM.md](./LITELLM.md)**。
