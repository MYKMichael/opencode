# AI 自动生成游戏广告 — 工作流架构设计

## 1. 概述

基于 LayaAir 引擎，利用 AI 自动生成游戏广告的多阶段工作流系统。用户通过自然语言与 AI 交互，完成从需求细化到游戏运行的全流程。

### 1.1 核心挑战

- **6 个阶段**：需求细化 → 素材分析 → 场景搭建 → 开发计划 → 代码生成 → 运行调试
- **网状交互**：任意阶段可跳转到任意其他阶段（非线性流程）
- **频繁修改**：用户可能在代码阶段修改需求，在运行阶段调整场景
- **多模型需求**：不同阶段适合不同 LLM（推理模型 vs 编码模型 vs 多模态模型）
- **上下文控制**：长工作流中上下文不能无限膨胀

### 1.2 架构选型分析

| 方案 | 优势 | 劣势 | 适用场景 |
|------|------|------|----------|
| 多 primary agent 切换 | 不同模型/权限/prompt | 切换有合成消息噪音，skill 内容持续占用上下文 | 线性流程，阶段边界清晰 |
| 单 agent + skill | 上下文连续，实现简单 | 不能换模型，skill 内容持续膨胀 | 阶段差异小，无需多模型 |
| **主 agent 交互 + subagent 执行** | **上下文轻量，多模型，网状交互** | 需拆分交互与执行 | **本项目采用** |

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    用户交互层                         │
│              CLI / Web / Desktop                     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              主 Agent (build)                        │
│                                                      │
│  职责:                                               │
│  ├── 理解用户意图，路由到对应 subagent                  │
│  ├── 和用户交互（提问、确认、展示结果）                  │
│  ├── 小修改直接执行（改参数、调节点属性）                │
│  └── 维护 workflow-state.md 工作流状态                 │
│                                                      │
│  共享工具:                                            │
│  ├── scene_read / scene_modify / scene_add / delete  │
│  ├── prefab_create / prefab_modify                   │
│  └── scene_preview                                   │
└──┬────────┬────────┬────────┬────────┬───────────────┘
   │        │        │        │        │
   ▼        ▼        ▼        ▼        ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
│ req  ││asset ││scene ││ plan ││ code │  ← subagent（独立 session）
│worker││worker││worker││worker││worker│
│      ││      ││      ││      ││      │
│opus  ││sonnet││gemini││opus  ││sonnet│  ← 各自使用最合适的模型
└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘
   │       │       │       │       │
   ▼       ▼       ▼       ▼       ▼
┌─────────────────────────────────────────────────────┐
│                   文件系统（共享）                     │
│                                                      │
│  docs/requirements.md      ← 需求文档                │
│  docs/assets-analysis.md   ← 素材分析                │
│  docs/dev-plan.md          ← 开发计划                │
│  scenes/*.scene            ← 场景文件                │
│  prefabs/*.prefab          ← 预制体文件              │
│  src/*.ts                  ← 代码文件                │
│  .opencode/workflow-state.md ← 工作流状态             │
└─────────────────────────────────────────────────────┘
```

## 3. 核心组件

### 3.1 主 Agent (build)

统一的用户交互入口，始终不切换。职责是"聊"而不是"干"。

**上下文内容：** 只包含用户消息和 subagent 返回的 `<task_result>` 摘要，始终轻量。

**路由逻辑：** 通过 system prompt 指导 LLM 根据用户意图选择对应 subagent：

```
用户说"细化需求"  → task(subagent="requirements-worker", ...)
用户说"分析素材"  → task(subagent="asset-worker", ...)
用户说"搭建场景"  → task(subagent="scene-worker", ...)
用户说"制定计划"  → task(subagent="plan-worker", ...)
用户说"写代码"    → task(subagent="code-worker", ...)
用户说"改个参数"  → 主 agent 直接改文件（不需要 subagent）
用户说"按钮太大"  → 主 agent 调用 scene_modify 工具直接改
```

**判断标准 — 何时用 subagent vs 直接处理：**

| 操作 | 处理方式 | 原因 |
|------|---------|------|
| 修改一个参数值 | 主 agent 直接改 | 单文件单行，不需要专业模型 |
| 调整一个节点属性 | 主 agent 调用场景工具 | 单次工具调用 |
| 细化整个需求文档 | subagent | 需要深度推理，适合用 opus |
| 批量生成多个代码文件 | subagent | 需要大量编码，适合用 sonnet |
| 从零搭建场景 | subagent | 需要多模态理解，适合用 gemini |

### 3.2 Subagent 定义

```jsonc
// opencode.json
{
  "agent": {
    "requirements-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-opus-4",
      "description": "需求细化与深度分析。输入项目文档和用户反馈，输出结构化需求文档到 docs/requirements.md",
      "prompt": "你是游戏广告需求分析专家。基于提供的项目信息，输出完整的结构化需求文档。必须覆盖：玩法机制、角色系统、UI系统、关卡逻辑、动画效果、音效需求。输出到 docs/requirements.md"
    },
    "asset-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4",
      "description": "美术素材分析。扫描素材目录，分析尺寸/格式/用途，输出素材清单到 docs/assets-analysis.md",
      "prompt": "你是美术素材分析专家。扫描 assets/ 目录下所有素材文件，分析每个素材的用途、尺寸、格式，与需求文档对照，找出缺失素材。输出到 docs/assets-analysis.md"
    },
    "scene-worker": {
      "mode": "subagent",
      "model": "google/gemini-2.5-pro",
      "description": "场景搭建与预制体生成。根据需求文档和素材，创建场景文件和预制体",
      "prompt": "你是 LayaAir 场景搭建专家。根据需求文档和素材分析，创建场景文件和预制体。使用 scene_add/scene_modify 等工具操作场景节点。"
    },
    "plan-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-opus-4",
      "description": "开发计划生成。分析需求、场景、素材，输出模块化开发计划到 docs/dev-plan.md",
      "prompt": "你是游戏开发架构师。根据需求文档、场景文件、素材清单，制定模块化的开发计划。每个模块包含：职责、输入输出、依赖关系、对应文件路径。输出到 docs/dev-plan.md"
    },
    "code-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4",
      "description": "代码生成。根据开发计划和场景文件，批量生成 TypeScript 代码",
      "prompt": "你是 LayaAir TypeScript 开发专家。严格按照 docs/dev-plan.md 的模块划分生成代码。每个模块一个文件，代码必须与场景文件中的节点名称对应。"
    }
  }
}
```

### 3.3 共享场景工具

注册给主 agent，用于小规模场景调整（不需要启动 subagent）：

| 工具 | 功能 | 使用场景 |
|------|------|---------|
| `scene_read` | 读取场景/预制体的节点树 | 查看当前场景结构 |
| `scene_modify` | 修改节点属性（位置、大小、组件参数） | 用户说"按钮往下移50px" |
| `scene_add` | 添加节点 | 用户说"加一个背景图" |
| `scene_delete` | 删除节点 | 用户说"去掉那个粒子效果" |
| `scene_preview` | 截图/预览当前场景 | 用户说"让我看看现在的样子" |

这些工具同时也提供给 `scene-worker` subagent 使用。

### 3.4 工作流状态文件

`.opencode/workflow-state.md` 是整个系统的持久化记忆，解决以下问题：

- **compaction 丢信息**：对话被压缩后，关键决策记录在文件中不会丢失
- **跨 subagent 传递上下文**：每个 subagent 是独立 session，通过读取此文件了解全局进度
- **用户进度可视化**：用户随时可以查看项目状态

```markdown
# 工作流状态

## 当前阶段: 代码生成

## 需求细化 ✅
- 游戏类型: 三消游戏
- 目标平台: iOS
- 广告时长: 30秒
- 角色移动速度: 500px/s
- 通关条件: 计时30秒内消除所有方块
- [变更记录] 2024-01-15: 速度从300改为500

## 素材分析 ✅
- 背景: assets/bg_001.png (1080x1920)
- 角色: assets/hero_sprite.png (8帧, 128x128)
- 方块: assets/blocks/ (6种颜色)
- 缺失: 胜利/失败弹窗素材

## 场景搭建 ✅
- 主场景: scenes/main.scene
  - GameRoot / Background
  - GameRoot / Board (8x8 网格)
  - GameRoot / UI / ScoreLabel
  - GameRoot / UI / TimerLabel
  - GameRoot / UI / StartButton
- 预制体: prefabs/block.prefab
- [待修改] StartButton 位置需要下移 50px

## 开发计划 ✅
- 模块1: 游戏管理器 → src/GameManager.ts
- 模块2: 方块控制 → src/BlockController.ts
- 模块3: 消除逻辑 → src/MatchEngine.ts
- 模块4: 计分系统 → src/ScoreSystem.ts
- 模块5: 计时器 → src/TimerSystem.ts

## 代码生成 🔄
- [完成] src/GameManager.ts
- [完成] src/BlockController.ts
- [进行中] src/MatchEngine.ts
- [待开始] src/ScoreSystem.ts
- [待开始] src/TimerSystem.ts

## 运行调试 ⏳
- 未开始
```

**更新规则（写入主 agent 的 system prompt）：**

> 当执行任何修改操作后，同步更新 .opencode/workflow-state.md 中对应的章节。
> 如果用户修改了需求相关的内容，同时更新 docs/requirements.md 和 workflow-state.md。
> 变更记录格式：[变更记录] 日期: 变更内容

## 4. 数据流

### 4.1 阶段间数据传递

阶段之间**不通过对话上下文传递数据**，而是通过文件：

```
需求细化 ──输出──→ docs/requirements.md
                        │
素材分析 ──读取──→──────┘──输出──→ docs/assets-analysis.md
                                         │
场景搭建 ──读取──→───────────────────────┘──输出──→ scenes/*.scene
                                                        │
开发计划 ──读取──→──────────────────────────────────────┘──输出──→ docs/dev-plan.md
                                                                       │
代码生成 ──读取──→────────────────────────────────────────────────────┘──输出──→ src/*.ts
                                                                                    │
运行调试 ──读取──→─────────────────────────────────────────────────────────────────┘
```

### 4.2 典型交互流程

```
用户: "帮我做一个消除游戏广告，文档在 docs/brief.md"

主 agent: 读取 docs/brief.md
主 agent: "我看了文档，有几个问题需要确认：
          1. 目标平台？
          2. 广告时长？
          3. 竖屏还是横屏？"

用户: "iOS，30秒，竖屏"

主 agent: → task(requirements-worker,
               "基于 docs/brief.md 细化需求，目标平台 iOS，30秒竖屏，
                输出到 docs/requirements.md，
                更新 .opencode/workflow-state.md")
        ← <task_result>
            已输出 docs/requirements.md，包含 5 个模块：
            玩法机制、角色系统、UI、关卡逻辑、动画效果
          </task_result>

主 agent: "需求文档已生成，包含 5 个模块。需要调整吗？"

用户: "角色速度改成 500"

主 agent: 直接 edit docs/requirements.md（速度 300→500）
         直接 edit .opencode/workflow-state.md（更新记录）
主 agent: "已更新，继续分析素材？"

用户: "好的"

主 agent: → task(asset-worker,
               "根据 docs/requirements.md 分析 assets/ 目录，
                输出到 docs/assets-analysis.md")
        ← <task_result>已分析 23 个素材文件，缺失 2 个...</task_result>

用户: "先不管缺失的，直接搭建场景"

主 agent: → task(scene-worker,
               "根据 docs/requirements.md 和 docs/assets-analysis.md 搭建场景")
        ← <task_result>已创建 scenes/main.scene 和 3 个预制体</task_result>

用户: "开始按钮太靠上了"

主 agent: 调用 scene_modify(node="StartButton", y="+50")
主 agent: "已调整，要预览吗？"

用户: "制定开发计划然后直接写代码"

主 agent: → task(plan-worker, "...")
        ← <task_result>已输出 docs/dev-plan.md，5 个模块</task_result>

主 agent: → task(code-worker, "...")
        ← <task_result>已生成 5 个文件</task_result>

用户: "等等，通关条件要改成收集星星，不是计时"

主 agent: edit docs/requirements.md（通关条件重写）
         edit .opencode/workflow-state.md（记录变更）
主 agent: "需求已更新。这个改动影响开发计划和代码，需要重新生成吗？"

用户: "是的"

主 agent: → task(plan-worker, "通关条件已变更，重新规划 MatchEngine 和 TimerSystem 模块")
        ← <task_result>已更新 docs/dev-plan.md</task_result>

主 agent: → task(code-worker, "根据更新后的计划，重新生成 src/MatchEngine.ts 和 src/TimerSystem.ts")
        ← <task_result>已重新生成 2 个文件</task_result>
```

### 4.3 上下文占用分析

上述完整交互后，主 agent 的上下文内容：

```
用户消息 × 8 条                          ≈ 1K token
主 agent 回复 × 8 条                     ≈ 2K token
task_result × 6 个                       ≈ 3K token
scene_modify 工具输出 × 1 个             ≈ 0.2K token
edit 工具输出 × 4 个                     ≈ 0.8K token
────────────────────────────────────────
总计                                     ≈ 7K token
```

相比之下，如果所有 skill 内容都在主对话中，仅 skill 就可能占 15K+ token，加上工具输出总计超过 100K token。

## 5. 上下文管理策略

### 5.1 三层回收机制

| 层级 | 触发条件 | 效果 |
|------|---------|------|
| **Subagent 隔离** | 每次 task 调用 | 重活在独立 session 执行，主对话只收摘要 |
| **Prune（修剪）** | 工具输出累积超过 40K token | 早期工具输出被清空为 `[Old tool result content cleared]` |
| **Compaction（压缩）** | token 用量接近模型上限 | 整个历史压缩为 ~2K 摘要 |

### 5.2 Subagent 可恢复

task 工具返回 `task_id`，后续可通过同一 `task_id` 恢复之前的 subagent session，继续未完成的工作：

```
第一次: task(code-worker, "生成所有代码")
       → task_id: session_abc123
       ← 生成了 3/5 个文件后中断

第二次: task(code-worker, "继续生成剩余文件", task_id="session_abc123")
       → 恢复之前的 session，继续执行
```

### 5.3 Compaction 后恢复

主对话被 compaction 压缩后，关键信息可能丢失。恢复策略：

1. 主 agent 的 system prompt 中写明：**每次开始新一轮对话前，先读取 `.opencode/workflow-state.md` 了解当前进度**
2. 各阶段的详细产出在独立文件中（docs/*.md, scenes/*, src/*），不受 compaction 影响
3. Subagent 的 session 独立存储，compaction 只影响主对话

## 6. 配置参考

### 6.1 opencode.json

```jsonc
{
  "agent": {
    "requirements-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-opus-4",
      "description": "需求细化与深度分析"
    },
    "asset-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4",
      "description": "美术素材扫描与分析"
    },
    "scene-worker": {
      "mode": "subagent",
      "model": "google/gemini-2.5-pro",
      "description": "LayaAir 场景搭建与预制体生成"
    },
    "plan-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-opus-4",
      "description": "模块化开发计划制定"
    },
    "code-worker": {
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4",
      "description": "TypeScript 代码批量生成"
    }
  },
  "skills": {
    "paths": [".opencode/skills"]
  }
}
```

### 6.2 Skill 目录结构（可选，供 subagent 加载）

```
.opencode/skills/
├── refine-requirements/
│   └── SKILL.md          # 需求细化方法论、模板
├── asset-analysis/
│   └── SKILL.md          # 素材分析规范
├── scene-building/
│   ├── SKILL.md          # LayaAir 场景 API 参考
│   └── reference/
│       └── node-types.md # 节点类型速查
├── dev-planning/
│   └── SKILL.md          # 开发计划模板
├── code-generation/
│   ├── SKILL.md          # LayaAir 编码规范
│   └── reference/
│       └── api-cheat-sheet.md
└── game-runner/
    └── SKILL.md          # 构建与调试流程
```

### 6.3 文件产出约定

| 文件 | 产出阶段 | 消费阶段 |
|------|---------|---------|
| `docs/requirements.md` | 需求细化 | 素材分析、场景搭建、开发计划、代码生成 |
| `docs/assets-analysis.md` | 素材分析 | 场景搭建、开发计划 |
| `docs/dev-plan.md` | 开发计划 | 代码生成 |
| `scenes/*.scene` | 场景搭建 | 开发计划、代码生成、运行调试 |
| `prefabs/*.prefab` | 场景搭建 | 代码生成 |
| `src/*.ts` | 代码生成 | 运行调试 |
| `.opencode/workflow-state.md` | 所有阶段 | 所有阶段 |

## 7. 设计决策记录

### 7.1 为什么不用多 primary agent 切换？

- 网状交互下频繁切换产生大量合成消息
- Skill 内容在主对话中持续膨胀且被保护不会被 prune
- 切换后 system prompt 变化导致 LLM 行为不稳定

### 7.2 为什么不用纯 skill 方案？

- Skill 只是知识注入，不能切换模型
- Skill 内容加载后永久占用上下文（受 prune 保护）
- 6 个 skill 全加载 ≈ 15K+ token 持续占用

### 7.3 为什么 subagent 不直接和用户交互？

- Subagent 默认 `question: "deny"`，设计上不支持用户交互
- 即使开放权限，subagent 的交互体验不如主 agent（无 Tab 切换、无 agent 标识）
- 拆分"交互"和"执行"是更清晰的职责划分

### 7.4 为什么用文件而不是对话上下文传递数据？

- 文件不受 compaction 影响，是持久化的
- Subagent 有独立 session，无法访问主对话的上下文
- 文件可以被多个 subagent 共享读取
- 用户可以直接查看和手动编辑文件
