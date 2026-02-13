# LiteLLM 代理方案

使用 [LiteLLM](https://github.com/BerriAI/litellm) 替代自建 `server.js`，通过配置文件管理多模型路由，无需编写代码。

## 为什么选 LiteLLM

- **100+ Provider 开箱即用** — Anthropic、OpenAI、DeepSeek、Gemini、通义千问等，无需自己写格式转换
- **配置驱动** — 添加模型只需在 YAML 里加 3 行，不碰代码
- **内置 Token 统计** — 支持回调、持久化到数据库
- **OpenAI 兼容接口** — 与现有 `opencode.json` 的 `@ai-sdk/openai-compatible` 完全兼容

## 快速开始

### 1. 安装

```bash
pip install 'litellm[proxy]'
```

### 2. 配置环境变量

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx
export DEEPSEEK_API_KEY=sk-xxx
```

### 3. 启动代理

```bash
cd examples/backend-proxy
litellm --config litellm_config.yaml --port 3000
```

启动后会看到类似输出：

```
LiteLLM: Proxy initialized with Config, Set models:
LiteLLM Proxy: http://0.0.0.0:3000
```

### 4. 验证

```bash
# 健康检查
curl http://localhost:3000/health

# 测试聊天
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model-a",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 5. 启动 OpenCode

现有的 `opencode.json` 无需修改，直接启动：

```bash
opencode
# Ctrl+K 选择模型，应能看到 model-a / model-b / model-c
```

## 添加更多模型

编辑 `litellm_config.yaml`，在 `model_list` 下新增条目：

```yaml
model_list:
  # ... 已有模型 ...

  # Google Gemini
  - model_name: model-d
    litellm_params:
      model: gemini/gemini-2.0-flash
      api_key: os.environ/GOOGLE_API_KEY

  # 阿里通义千问 (OpenAI 兼容接口)
  - model_name: model-e
    litellm_params:
      model: openai/qwen-plus
      api_key: os.environ/DASHSCOPE_API_KEY
      api_base: https://dashscope.aliyuncs.com/compatible-mode/v1

  # Azure OpenAI
  - model_name: model-f
    litellm_params:
      model: azure/gpt-4o
      api_key: os.environ/AZURE_API_KEY
      api_base: https://your-resource.openai.azure.com
      api_version: "2024-06-01"
```

然后在 `opencode.json` 的 `models` 中添加对应的前端模型定义（需设置 `tool_call`、`limit` 等能力字段）。

重启 LiteLLM 即可生效。

## 常用 Provider 格式

| Provider | model 格式 | 是否需要 api_base |
|----------|-----------|-------------------|
| Anthropic | `anthropic/claude-xxx` | 否 |
| OpenAI | `openai/gpt-xxx` | 否 |
| DeepSeek | `deepseek/deepseek-xxx` | 是：`https://api.deepseek.com` |
| Gemini | `gemini/gemini-xxx` | 否 |
| Azure OpenAI | `azure/gpt-xxx` | 是：你的 Azure endpoint |
| 通义千问 | `openai/qwen-xxx` | 是：`https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 月之暗面 | `openai/moonshot-xxx` | 是：`https://api.moonshot.cn/v1` |
| 智谱 AI | `openai/glm-xxx` | 是：`https://open.bigmodel.cn/api/paas/v4` |

完整列表见 [LiteLLM Providers](https://docs.litellm.ai/docs/providers)。

## 后续：迁移到 Docker 部署

验证通过后，可迁移到 Docker Compose 以获得生产级稳定性：

```bash
# 拉取镜像
docker pull ghcr.io/berriai/litellm:main-latest

# 启动 (挂载配置文件)
docker run -d \
  --name litellm \
  -p 3000:4000 \
  -v $(pwd)/litellm_config.yaml:/app/config.yaml \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -e DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY \
  ghcr.io/berriai/litellm:main-latest \
  --config /app/config.yaml
```

Docker Compose 方案可同时编排 LiteLLM + PostgreSQL + Redis，实现持久化 Token 统计和用户管理。
