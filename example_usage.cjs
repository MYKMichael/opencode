#!/usr/bin/env node

/**
 * ========================================================================
 * OpenCode ACP 使用示例
 * ========================================================================
 *
 * 本文件展示了如何使用 ACPClient 类的各种功能
 */

const { ACPClient } = require('./verify_acp');
const path = require('path');

// ========================================================================
// 示例 1: 基础使用 - 发送单个 Prompt
// ========================================================================

async function example1_BasicUsage() {
  console.log('\n=== 示例 1: 基础使用 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  try {
    // 启动
    await client.start();

    // 初始化
    await client.initialize();

    // 创建会话
    await client.createSession();

    // 发送消息
    await client.sendPrompt('生成一个简单的 Hello World 脚本');

    // 打印统计
    client.printStats();

    // 清理
    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 2: 多轮对话
// ========================================================================

async function example2_MultiTurnConversation() {
  console.log('\n=== 示例 2: 多轮对话 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  try {
    await client.start();
    await client.initialize();
    await client.createSession();

    // 第一轮
    console.log('\n--- 第 1 轮 ---');
    await client.sendPrompt('创建一个点击缩放脚本');

    // 第二轮(基于上下文)
    console.log('\n--- 第 2 轮 ---');
    await client.sendPrompt('给这个脚本添加旋转功能');

    // 第三轮
    console.log('\n--- 第 3 轮 ---');
    await client.sendPrompt('优化代码性能');

    client.printStats();
    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 3: 自定义文件操作处理
// ========================================================================

async function example3_CustomFileHandler() {
  console.log('\n=== 示例 3: 自定义文件操作处理 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  // 覆盖文件写入处理器
  const originalHandler = client.handleWriteTextFile.bind(client);
  client.handleWriteTextFile = async function (params) {
    console.log('\n[自定义处理器] 拦截文件写入请求:');
    console.log(`  路径: ${params.path}`);
    console.log(`  大小: ${params.content.length} 字符`);

    // 自定义逻辑: 只允许写入 .ts 文件
    if (!params.path.endsWith('.ts')) {
      console.log('  ❌ 拒绝: 只允许写入 TypeScript 文件');
      throw new Error('Only .ts files allowed');
    }

    console.log('  ✅ 允许写入');
    return await originalHandler(params);
  };

  try {
    await client.start();
    await client.initialize();
    await client.createSession();
    await client.sendPrompt('创建一个脚本文件');

    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 4: 监听会话更新事件
// ========================================================================

async function example4_SessionUpdateListener() {
  console.log('\n=== 示例 4: 监听会话更新事件 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  // 统计各类更新的数量
  const stats = {
    messageChunks: 0,
    thoughtChunks: 0,
    toolCalls: 0,
    plans: 0
  };

  // 覆盖会话更新处理器
  const originalHandler = client.handleSessionUpdate.bind(client);
  client.handleSessionUpdate = function (params) {
    const { update } = params;

    // 统计
    switch (update.type) {
      case 'agent_message_chunk':
        stats.messageChunks++;
        break;
      case 'agent_thought_chunk':
        stats.thoughtChunks++;
        break;
      case 'tool_call':
        stats.toolCalls++;
        console.log(`\n[工具调用] ${update.tool}`);
        break;
      case 'plan':
        stats.plans++;
        console.log('\n[计划更新]');
        break;
    }

    // 调用原始处理器
    return originalHandler(params);
  };

  try {
    await client.start();
    await client.initialize();
    await client.createSession();
    await client.sendPrompt('创建一个复杂的多文件项目');

    console.log('\n--- 会话更新统计 ---');
    console.log(`消息片段: ${stats.messageChunks}`);
    console.log(`思考片段: ${stats.thoughtChunks}`);
    console.log(`工具调用: ${stats.toolCalls}`);
    console.log(`计划更新: ${stats.plans}`);

    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 5: 取消操作
// ========================================================================

async function example5_CancelOperation() {
  console.log('\n=== 示例 5: 取消操作 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  try {
    await client.start();
    await client.initialize();
    await client.createSession();

    // 发送一个长时间运行的任务
    const promptPromise = client.sendPrompt(
      '生成 100 个不同的脚本文件,每个都要详细注释'
    );

    // 2 秒后取消
    setTimeout(() => {
      console.log('\n⚠️  取消操作...');
      client.cancel();
    }, 2000);

    try {
      await promptPromise;
    } catch (err) {
      console.log('✓ 操作已取消');
    }

    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 6: 错误处理
// ========================================================================

async function example6_ErrorHandling() {
  console.log('\n=== 示例 6: 错误处理 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  try {
    await client.start();
    await client.initialize();
    await client.createSession();

    // 尝试发送一个可能失败的请求
    try {
      await client.sendPrompt(''); // 空 prompt
    } catch (err) {
      console.log('✓ 捕获到错误:', err.message);
    }

    // 继续正常使用
    await client.sendPrompt('创建一个脚本');

    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 7: 使用不同的模型
// ========================================================================

async function example7_DifferentModels() {
  console.log('\n=== 示例 7: 使用不同的模型 ===\n');

  const client = new ACPClient({
    workingDir: path.join(__dirname, 'mock_project')
  });

  try {
    await client.start();
    await client.initialize();

    // 创建会话并获取可用模型
    const sessionResult = await client.createSession();
    console.log('\n可用模型:');
    sessionResult.models.forEach((model, index) => {
      console.log(`  ${index + 1}. ${model.name} (${model.id})`);
    });

    // 使用第一个模型
    if (sessionResult.models.length > 0) {
      const modelId = sessionResult.models[0].id;
      console.log(`\n使用模型: ${modelId}`);
      await client.sendPrompt('Hello', modelId);
    }

    client.cleanup();
  } catch (err) {
    console.error('错误:', err.message);
    client.cleanup();
  }
}

// ========================================================================
// 示例 8: 集成到 IDE 插件(伪代码)
// ========================================================================

class LayaAirIDEPlugin {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.acpClient = null;
  }

  /**
   * 插件初始化
   */
  async initialize() {
    console.log('\n=== 示例 8: IDE 插件集成 ===\n');

    // 创建 ACP 客户端
    this.acpClient = new ACPClient({
      workingDir: this.projectPath
    });

    // 自定义文件写入处理器
    this.acpClient.handleWriteTextFile = async (params) => {
      // 调用 IDE 的 UI 确认对话框
      const confirmed = await this.showConfirmDialog({
        title: '文件写入确认',
        message: `是否写入文件: ${params.path}`,
        detail: params.content,
        buttons: ['确认', '取消']
      });

      if (!confirmed) {
        throw new Error('用户取消写入');
      }

      // 写入文件并刷新编辑器
      await this.writeFileAndRefresh(params.path, params.content);
      return {};
    };

    // 自定义权限处理器
    this.acpClient.handleRequestPermission = async (params) => {
      const { toolCall } = params;

      // 危险操作需要用户确认
      if (toolCall.kind === 'execute') {
        const confirmed = await this.showWarningDialog({
          title: '执行命令确认',
          message: `即将执行命令,请确认:`,
          detail: toolCall.title
        });

        return {
          outcome: {
            outcome: confirmed ? 'approved' : 'rejected',
            optionId: confirmed ? 'approve' : 'reject'
          }
        };
      }

      // 其他操作自动批准
      return {
        outcome: {
          outcome: 'approved',
          optionId: 'approve'
        }
      };
    };

    // 启动 ACP
    await this.acpClient.start();
    await this.acpClient.initialize();
    await this.acpClient.createSession();

    console.log('✓ IDE 插件初始化完成');
  }

  /**
   * 处理用户输入
   */
  async handleUserInput(text) {
    if (!this.acpClient) {
      throw new Error('插件未初始化');
    }

    // 在 UI 中显示加载状态
    this.showLoadingIndicator();

    try {
      // 发送到 OpenCode
      const result = await this.acpClient.sendPrompt(text);

      // 隐藏加载状态
      this.hideLoadingIndicator();

      // 显示完成提示
      this.showNotification('操作完成', 'success');

      return result;
    } catch (err) {
      this.hideLoadingIndicator();
      this.showNotification(err.message, 'error');
      throw err;
    }
  }

  /**
   * 插件清理
   */
  async dispose() {
    if (this.acpClient) {
      this.acpClient.cleanup();
      this.acpClient = null;
    }
    console.log('✓ IDE 插件已清理');
  }

  // ====== 以下是 IDE API 的模拟方法 ======

  async showConfirmDialog(options) {
    // 实际应调用 IDE 的对话框 API
    console.log(`[对话框] ${options.title}: ${options.message}`);
    return true; // 模拟用户点击"确认"
  }

  async showWarningDialog(options) {
    console.log(`[警告对话框] ${options.title}: ${options.message}`);
    return true;
  }

  async writeFileAndRefresh(path, content) {
    // 实际应调用 IDE 的文件 API
    console.log(`[IDE] 写入文件: ${path}`);
  }

  showLoadingIndicator() {
    console.log('[IDE] 显示加载动画');
  }

  hideLoadingIndicator() {
    console.log('[IDE] 隐藏加载动画');
  }

  showNotification(message, type) {
    console.log(`[IDE] 通知 [${type}]: ${message}`);
  }
}

// 使用 IDE 插件
async function example8_IDEIntegration() {
  const plugin = new LayaAirIDEPlugin(path.join(__dirname, 'mock_project'));

  try {
    await plugin.initialize();
    await plugin.handleUserInput('创建一个脚本');
    await plugin.dispose();
  } catch (err) {
    console.error('错误:', err.message);
  }
}

// ========================================================================
// 主菜单
// ========================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║              OpenCode ACP 使用示例集合                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // 从命令行参数获取示例编号
  const exampleNum = process.argv[2] || '1';

  const examples = {
    '1': { name: '基础使用', fn: example1_BasicUsage },
    '2': { name: '多轮对话', fn: example2_MultiTurnConversation },
    '3': { name: '自定义文件操作处理', fn: example3_CustomFileHandler },
    '4': { name: '监听会话更新事件', fn: example4_SessionUpdateListener },
    '5': { name: '取消操作', fn: example5_CancelOperation },
    '6': { name: '错误处理', fn: example6_ErrorHandling },
    '7': { name: '使用不同的模型', fn: example7_DifferentModels },
    '8': { name: 'IDE 插件集成', fn: example8_IDEIntegration }
  };

  if (exampleNum === 'all') {
    // 运行所有示例
    for (const [num, example] of Object.entries(examples)) {
      console.log(`\n▶ 运行示例 ${num}: ${example.name}`);
      await example.fn();
      console.log('\n' + '─'.repeat(70));
    }
  } else if (examples[exampleNum]) {
    // 运行指定示例
    const example = examples[exampleNum];
    console.log(`▶ 运行示例 ${exampleNum}: ${example.name}\n`);
    await example.fn();
  } else {
    // 显示菜单
    console.log('使用方法:');
    console.log('  node example_usage.js <示例编号>\n');
    console.log('可用示例:');
    for (const [num, example] of Object.entries(examples)) {
      console.log(`  ${num}. ${example.name}`);
    }
    console.log('\n  all - 运行所有示例\n');
  }
}

// 运行
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { LayaAirIDEPlugin };
