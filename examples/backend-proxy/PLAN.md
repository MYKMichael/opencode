# OpenCode 后端代理 LLM 服务 — 总结与规划

## 一、背景与目标

将 OpenCode 封装为第三方前端工具，实现以下目标：

- **前端无需填写 API Key**，用户只需选择模型名（如 model-a / model-b / model-c）
- **后端统一管理** API Key、baseURL，接管所有 LLM 访问流量
- **后端统计 Token 消耗**，支持用量审计和成本控制

## 二、技术方案

### 核心结论

**无需修改 OpenCode 任何代码。** OpenCode 已内置 `@ai-sdk/openai-compatible` provider，支持自定义 baseURL 指向任意后端服务。

### 架构图

```
┌──────────┐        ┌─────────────────┐        ┌──────────────────┐
│          │        │                 │        │                  │
│  用户    │──────▶│  OpenCode 前端   │──────▶│  后端代理服务     │
│          │        │                 │        │  (你的服务)      │
└──────────┘        └─────────────────┘        └────────┬─────────┘
                           │                            │
                     opencode.json                      │ 模型映射 + API Key 注入
                     配置 baseURL                        │ + Token 统计
                     指向后端                            │
                                                        ▼
                                          ┌──────────────────────────┐
                                          │   真实 LLM Provider       │
                                          │                          │
                                          │  ┌────────────────────┐  │
                                          │  │ Anthropic (Claude) │  │
                                          │  ├────────────────────┤  │
                                          │  │ OpenAI (GPT)       │  │
                                          │  ├────────────────────┤  │
                                          │  │ DeepSeek           │  │
                                          │  └────────────────────┘  │
                                          └──────────────────────────┘
```

### 工作原理

1. 前端通过 `opencode.json` 配置一个名为 `my-backend` 的自定义 provider
2. `baseURL` 指向后端代理服务地址（如 `http://backend:3000/v1`）
3. 前端发送标准 OpenAI 格式请求，model 字段为 `model-a` / `model-b` / `model-c`
4. 后端收到请求后：
   - 根据 model 名称映射到真实 LLM Provider 和模型
   - 注入对应的 API Key
   - 转换请求格式（如 Anthropic 格式转换）
   - 转发到真实 Provider
   - 从响应中提取 token 用量并记录
   - 将响应以 OpenAI 格式返回给前端

## 三、已完成的交付物

```
examples/backend-proxy/
├── opencode.json      # 前端配置文件（复制到项目根目录使用）
├── server.js          # 后端代理服务参考实现
├── package.json       # Node.js 项目配置
├── .env.example       # 环境变量模板（API Key 配置）
├── README.md          # 使用说明
└── PLAN.md            # 本文档
```

### 各文件说明

| 文件 | 说明 |
|------|------|
| `opencode.json` | 定义 3 个模型（model-a/b/c），baseURL 指向后端，`enabled_providers` 限制只显示自定义 provider |
| `server.js` | 完整的后端代理，支持 Anthropic 和 OpenAI Compatible 两类 Provider 的格式转换，含流式/非流式响应处理和 Token 统计 |
| `.env.example` | 需填入真实的 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY` |

## 四、实施路线

### 阶段 1：MVP 验证（1-2 天）

**目标**：跑通核心链路，验证可行性。

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 部署后端代理服务 | 启动 `server.js` 或部署 LiteLLM | P0 |
| 配置前端 | 将 `opencode.json` 放到项目根目录，修改 `baseURL` | P0 |
| 验证基本聊天 | 选择 model-a 发送消息，确认响应正常 | P0 |
| 验证工具调用 | 让 AI 读取文件、执行命令，确认 tool_call 正常 | P0 |
| 验证流式响应 | 确认逐字输出正常，无卡顿或乱码 | P0 |
| 检查 Token 统计 | 访问 `/api/usage` 确认统计数据正确 | P1 |

### 阶段 2：生产加固（3-5 天）

**目标**：达到可上线的生产标准。

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 用户身份验证 | 后端添加 JWT 或 API Key 验证，区分不同用户 | P0 |
| Token 统计持久化 | 将内存中的 `usageLog` 替换为 PostgreSQL / MongoDB | P0 |
| HTTPS 部署 | 生产环境必须使用 HTTPS，建议 Nginx 反向代理 | P0 |
| 速率限制 | 防止滥用，如每用户每分钟 30 请求 | P1 |
| 错误处理完善 | 上游超时、限流等异常的友好处理 | P1 |
| 日志与监控 | 接入日志系统，关键指标告警 | P1 |

### 阶段 3：企业级功能（可选，1-2 周）

**目标**：支持大规模多租户部署。

| 任务 | 说明 | 优先级 |
|------|------|--------|
| Well-Known 动态配置 | 实现 `GET /.well-known/opencode` 端点，动态下发模型列表 | P1 |
| 多租户支持 | 不同用户/团队看到不同的模型列表和配额 | P2 |
| 用量限额 | 每用户 Token 用量上限，超额自动拒绝 | P2 |
| 管理后台 | Web 界面管理模型配置、查看用量报表 | P2 |
| 模型负载均衡 | 同一模型多个 API Key 轮询，提高可用性 | P3 |

## 五、关键注意事项

### 必须正确配置的字段

在 `opencode.json` 中定义模型时，以下字段**配错会导致功能异常**：

| 字段 | 必须值 | 配错后果 |
|------|--------|----------|
| `tool_call` | `true` | 设为 false 则 OpenCode 的 Bash、Read、Edit 等所有工具不可用，AI 只能聊天 |
| `attachment` | 按实际能力 | 设为 false 则无法上传文件/图片 |
| `reasoning` | 按实际能力 | 影响 thinking/推理链功能 |
| `limit.context` | 按实际值 | 过小导致长对话被截断 |
| `limit.output` | 按实际值 | 过小导致 AI 输出被截断 |

### 后端 API 格式要求

后端**必须严格遵循 OpenAI API 格式**，包括：

- 非流式响应必须包含 `usage` 字段（`prompt_tokens` / `completion_tokens`）
- 流式响应使用 SSE 格式（`data: {...}\n\n`），以 `data: [DONE]\n\n` 结尾
- 工具调用响应必须包含 `tool_calls` 数组，格式与 OpenAI 一致

### 替代方案：LiteLLM

如果不想自己实现后端代理，可以直接部署 [LiteLLM](https://github.com/BerriAI/litellm)：

```bash
pip install litellm[proxy]
litellm --model anthropic/claude-sonnet-4-5 --port 3000
```

LiteLLM 已内置：
- 100+ LLM Provider 支持和格式转换
- Token 统计和用量追踪
- 用户管理和 API Key 分发
- Web 管理界面

## 六、验证清单

部署完成后，按以下步骤验证：

- [ ] 启动后端代理服务，访问 `/health` 确认模型可用
- [ ] 启动 OpenCode，按 `Ctrl+K` 确认看到 model-a / model-b / model-c
- [ ] 选择 model-a 发送一条普通消息，确认响应正常
- [ ] 让 AI 执行 `ls` 命令，确认工具调用正常
- [ ] 让 AI 读取一个文件，确认文件操作正常
- [ ] 切换到 model-b，确认模型切换正常
- [ ] 访问 `/api/usage`，确认 Token 统计数据已记录
- [ ] 检查后端日志，确认无异常错误
