#!/usr/bin/env node

/**
 * ========================================================================
 * OpenCode ACP (Agent Client Protocol) 验证脚本
 * ========================================================================
 *
 * 功能：模拟 LayaAir IDE 插件后端，通过 ACP 协议与 OpenCode 进行通信
 *
 * 核心实现：
 * 1. 进程管理：使用 child_process.spawn 启动 OpenCode ACP 模式
 * 2. 通讯层：基于 readline 的 JSON-RPC 2.0 解析器（解决粘包问题）
 * 3. 指令封装：标准 JSON-RPC 2.0 请求/响应处理
 * 4. 流式输出：实时处理 AI 返回的消息片段
 * 5. 文件操作：模拟确认文件写入请求
 *
 * @author AI Assistant
 * @date 2024
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

// ========================================================================
// 全局配置
// ========================================================================

const CONFIG = {
  // OpenCode 包目录（从此目录启动 ACP）
  OPENCODE_PKG: path.join(__dirname, 'packages', 'opencode'),

  // 工作目录（模拟 LayaAir 项目目录）
  WORKING_DIR: path.join(__dirname, 'mock_project'),

  // JSON-RPC 请求超时时间（毫秒）
  REQUEST_TIMEOUT: 120000, // 2 分钟

  // 是否启用详细日志
  VERBOSE: true,

  // 测试提示词
  // TEST_PROMPT: '帮我在当前目录生成一个 LayaAir 3.x 的 TypeScript 脚本，实现点击缩放功能，必须使用 @regClass 装饰器'
  // TEST_PROMPT: '帮我在当前目录生成一个测试文件，文件内有20个字'
  TEST_PROMPT: '输出20个汉字，关于地球的信息'
};

// ========================================================================
// 日志工具
// ========================================================================

const Logger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  success: (msg, ...args) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`, ...args),
  error: (msg, ...args) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`, ...args),
  debug: (msg, ...args) => CONFIG.VERBOSE && console.log(`\x1b[90m[DEBUG]\x1b[0m ${msg}`, ...args),

  // 分隔线
  separator: () => console.log('─'.repeat(80)),

  // JSON 美化输出
  json: (label, obj) => {
    console.log(`[JSON] ${label}:`);
    console.log(JSON.stringify(obj, null, 2));
  }
};

// ========================================================================
// JSON-RPC 2.0 消息类型
// ========================================================================

/**
 * 创建标准的 JSON-RPC 2.0 请求
 * @param {string} method - 方法名
 * @param {object} params - 参数对象
 * @param {number|string} id - 请求 ID
 * @returns {object} JSON-RPC 请求对象
 */
function createJsonRpcRequest(method, params, id) {
  return {
    jsonrpc: '2.0',
    id: id,
    method: method,
    params: params || {}
  };
}

/**
 * 创建 JSON-RPC 2.0 通知（无需响应）
 * @param {string} method - 方法名
 * @param {object} params - 参数对象
 * @returns {object} JSON-RPC 通知对象
 */
function createJsonRpcNotification(method, params) {
  return {
    jsonrpc: '2.0',
    method: method,
    params: params || {}
  };
}

/**
 * 判断消息类型
 */
function getMessageType(message) {
  if (!message.jsonrpc) return 'invalid';
  if (message.method) {
    return message.id !== undefined ? 'request' : 'notification';
  }
  if (message.result !== undefined || message.error !== undefined) {
    return 'response';
  }
  return 'unknown';
}

// ========================================================================
// ACP 客户端核心类
// ========================================================================

class ACPClient {
  constructor(options = {}) {
    // 基础配置
    this.opencodeProcess = null;
    this.rl = null;
    this.workingDir = options.workingDir || CONFIG.WORKING_DIR;

    // 请求管理
    this.requestId = 0;
    this.pendingRequests = new Map(); // 存储待响应的请求

    // 会话状态
    this.sessionId = null;
    this.initialized = false;
    this.agentInfo = null;

    // 消息缓冲区（处理流式输出）
    this.messageBuffer = '';

    // 统计信息
    this.stats = {
      requestsSent: 0,
      responsesReceived: 0,
      notificationsReceived: 0,
      errors: 0
    };
  }

  // ======================================================================
  // 进程管理
  // ======================================================================

  /**
   * 启动 OpenCode ACP 进程
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      Logger.info('启动 OpenCode ACP 进程...');
      Logger.debug(`OpenCode 目录: ${CONFIG.OPENCODE_PKG}`);
      Logger.debug(`工作目录: ${this.workingDir}`);

      // 确保工作目录存在
      if (!fs.existsSync(this.workingDir)) {
        fs.mkdirSync(this.workingDir, { recursive: true });
        Logger.info(`创建工作目录: ${this.workingDir}`);
      }

      // 优先使用本地编译版本，其次全局安装版，最后 bun 运行源码
      const localBuild = path.join(__dirname, 'packages', 'opencode', 'dist', 'opencode-windows-x64', 'bin', 'opencode.exe');
      const globalOpencode = process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd')
        : 'opencode';
      const opencodeEntry = path.join(__dirname, 'packages', 'opencode', 'src', 'index.ts');

      let command, args, useShell = false;
      if (fs.existsSync(localBuild)) {
        command = localBuild;
        args = [
          'acp',
          '--cwd', this.workingDir,
          '--print-logs',
          '--log-level', 'DEBUG'
        ];
        Logger.debug(`使用本地编译版本: ${localBuild}`);
      } else if (fs.existsSync(globalOpencode)) {
        command = globalOpencode;
        args = [
          'acp',
          '--cwd', this.workingDir,
          '--print-logs',
          '--log-level', 'DEBUG'
        ];
        useShell = true;
        Logger.debug(`使用全局 opencode: ${globalOpencode}`);
      } else {
        const bunPath = process.platform === 'win32'
          ? path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe')
          : 'bun';
        command = bunPath;
        args = [
          '--cwd', path.join(__dirname, 'packages', 'opencode'),
          opencodeEntry,
          'acp',
          '--cwd', this.workingDir,
          '--print-logs',
          '--log-level', 'DEBUG'
        ];
        Logger.debug(`使用 bun 运行源码: ${bunPath}`);
      }

      this.opencodeProcess = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname,
        shell: useShell,
        env: {
          ...process.env,
          OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        }
      });

      // 处理进程启动错误
      this.opencodeProcess.on('error', (err) => {
        Logger.error('进程启动失败:', err.message);
        reject(err);
      });

      let started = false;

      // 监听进程退出
      this.opencodeProcess.on('exit', (code, signal) => {
        Logger.warn(`OpenCode 进程已退出 (code: ${code}, signal: ${signal})`);
        if (!started) {
          reject(new Error(`OpenCode 进程启动失败，退出码: ${code}`));
        }
        this.cleanup();
      });

      // ================================================================
      // 处理 STDERR（错误和调试信息）
      // ================================================================
      const stderrChunks = [];
      this.opencodeProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString();
        stderrChunks.push(errorMsg);
        // 临时：显示所有 stderr 输出以便调试
        Logger.warn(`[STDERR] ${errorMsg.trim()}`);
      });

      // ================================================================
      // 处理 STDOUT（JSON-RPC 消息流）
      // ================================================================
      // 使用 readline 逐行读取，解决 JSON 粘包问题
      this.rl = readline.createInterface({
        input: this.opencodeProcess.stdout,
        crlfDelay: Infinity // 统一处理 \r\n 和 \n
      });

      this.rl.on('line', (line) => {
        this.handleStdoutLine(line);
      });

      // 等待进程启动: 3秒内如果进程没退出就认为启动成功
      setTimeout(() => {
        if (this.opencodeProcess && !this.opencodeProcess.killed) {
          started = true;
          Logger.success('OpenCode ACP 进程已启动');
          resolve();
        }
      }, 3000);
    });
  }

  /**
   * 处理 stdout 的每一行数据
   * 核心功能：解析 JSON-RPC 消息并分发处理
   * @param {string} line - 一行文本数据
   */
  handleStdoutLine(line) {
    // 跳过空行
    if (!line.trim()) return;

    try {
      // 解析 JSON-RPC 消息
      const message = JSON.parse(line);

      // 根据消息类型分发处理
      const msgType = getMessageType(message);

      if (CONFIG.VERBOSE) {
        Logger.debug(`收到 ${msgType} 消息:`);
        Logger.json('Message', message);
      }

      switch (msgType) {
        case 'response':
          this.handleResponse(message);
          break;
        case 'notification':
          this.handleNotification(message);
          break;
        case 'request':
          this.handleRequest(message);
          break;
        default:
          Logger.warn('未知消息类型:', message);
      }
    } catch (err) {
      // JSON 解析失败（可能是非 JSON 输出）
      Logger.debug(`非 JSON 输出: ${line}`);
    }
  }

  /**
   * 停止进程并清理资源
   */
  cleanup() {
    Logger.info('清理资源...');

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.opencodeProcess) {
      this.opencodeProcess.kill();
      this.opencodeProcess = null;
    }

    // 拒绝所有待响应的请求
    for (const [id, request] of this.pendingRequests) {
      request.reject(new Error('进程已终止'));
    }
    this.pendingRequests.clear();
  }

  // ======================================================================
  // JSON-RPC 通信层
  // ======================================================================

  /**
   * 发送 JSON-RPC 请求并等待响应
   * @param {string} method - 方法名
   * @param {object} params - 参数
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<object>} 响应结果
   */
  sendRequest(method, params = {}, timeout = CONFIG.REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = createJsonRpcRequest(method, params, id);

      Logger.info(`发送请求 [${id}]: ${method}`);
      if (CONFIG.VERBOSE) {
        Logger.json('Request', request);
      }

      // 存储待响应的请求
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, timeout);

      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timer
      });

      // 写入 stdin（每条消息后跟换行符）
      this.opencodeProcess.stdin.write(JSON.stringify(request) + '\n');
      this.stats.requestsSent++;
    });
  }

  /**
   * 发送 JSON-RPC 通知（不等待响应）
   * @param {string} method - 方法名
   * @param {object} params - 参数
   */
  sendNotification(method, params = {}) {
    const notification = createJsonRpcNotification(method, params);

    Logger.info(`发送通知: ${method}`);
    if (CONFIG.VERBOSE) {
      Logger.json('Notification', notification);
    }

    this.opencodeProcess.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * 处理 JSON-RPC 响应
   * @param {object} message - 响应消息
   */
  handleResponse(message) {
    const { id, result, error } = message;

    const pending = this.pendingRequests.get(id);
    if (!pending) {
      Logger.warn(`收到未知请求的响应: ${id}`);
      return;
    }

    // 清除超时定时器
    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);

    this.stats.responsesReceived++;

    if (error) {
      Logger.error(`请求失败 [${id}]: ${error.message}`);
      Logger.json('Error', error);
      this.stats.errors++;
      pending.reject(new Error(error.message));
    } else {
      Logger.success(`请求成功 [${id}]: ${pending.method}`);
      pending.resolve(result);
    }
  }

  /**
   * 处理来自 Agent 的通知（如会话更新）
   * @param {object} message - 通知消息
   */
  handleNotification(message) {
    const { method, params } = message;
    this.stats.notificationsReceived++;

    Logger.info(`收到通知: ${method}`);

    // 根据不同的通知类型进行处理
    switch (method) {
      case 'session/update':
        this.handleSessionUpdate(params);
        break;
      default:
        Logger.debug('未处理的通知类型:', method);
    }
  }

  /**
   * 处理来自 Agent 的请求（如文件操作）
   * @param {object} message - 请求消息
   */
  async handleRequest(message) {
    const { id, method, params } = message;

    Logger.info(`收到 Agent 请求 [${id}]: ${method}`);
    Logger.json('Request from Agent', { method, params });

    try {
      let result = {};

      // 根据方法类型处理
      switch (method) {
        case 'fs/read_text_file':
          result = await this.handleReadTextFile(params);
          break;
        case 'fs/write_text_file':
          result = await this.handleWriteTextFile(params);
          break;
        case 'session/request_permission':
          result = await this.handleRequestPermission(params);
          break;
        default:
          throw new Error(`不支持的方法: ${method}`);
      }

      // 发送成功响应
      this.sendResponse(id, result);
    } catch (err) {
      // 发送错误响应
      this.sendErrorResponse(id, -32603, err.message);
    }
  }

  /**
   * 发送响应给 Agent
   * @param {number|string} id - 请求 ID
   * @param {object} result - 结果对象
   */
  sendResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id: id,
      result: result
    };

    Logger.info(`发送响应 [${id}]`);
    this.opencodeProcess.stdin.write(JSON.stringify(response) + '\n');
  }

  /**
   * 发送错误响应给 Agent
   * @param {number|string} id - 请求 ID
   * @param {number} code - 错误码
   * @param {string} message - 错误消息
   */
  sendErrorResponse(id, code, message) {
    const response = {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: code,
        message: message
      }
    };

    Logger.error(`发送错误响应 [${id}]: ${message}`);
    this.opencodeProcess.stdin.write(JSON.stringify(response) + '\n');
  }

  // ======================================================================
  // 会话更新处理
  // ======================================================================

  /**
   * 处理会话更新通知
   * @param {object} params - 更新参数
   */
  handleSessionUpdate(params) {
    const { sessionId, update } = params;

    if (!update) {
      return;
    }

    // 实际协议中更新类型的字段名为 sessionUpdate（非 type）
    const updateType = update.sessionUpdate || update.type;

    if (!updateType) {
      Logger.debug('收到无类型的 session/update:', JSON.stringify(update).substring(0, 200));
      return;
    }

    // 根据不同的更新类型进行处理
    switch (updateType) {
      case 'agent_message_chunk':
        this.handleAgentMessageChunk(update);
        break;
      case 'agent_thought_chunk':
        this.handleAgentThoughtChunk(update);
        break;
      case 'tool_call':
        this.handleToolCall(update);
        break;
      case 'tool_call_update':
        this.handleToolCallUpdate(update);
        break;
      case 'plan':
        this.handlePlan(update);
        break;
      case 'usage_update':
        this.handleUsageUpdate(update);
        break;
      default:
        Logger.debug(`未处理的更新类型: ${updateType}`);
    }
  }

  /**
   * 处理 AI 消息片段（流式输出）
   * @param {object} update - 更新对象
   */
  handleAgentMessageChunk(update) {
    const { content } = update;

    if (content && content.text) {
      // 累积到消息缓冲区
      this.messageBuffer += content.text;
      // 实时打印 AI 输出（不换行）
      process.stdout.write(content.text);
    }
  }

  /**
   * 处理 AI 思考片段
   * @param {object} update - 更新对象
   */
  handleAgentThoughtChunk(update) {
    const { content } = update;

    if (content && content.text) {
      Logger.debug(`[THOUGHT] ${content.text}`);
    }
  }

  /**
   * 处理工具调用
   * @param {object} update - 更新对象
   */
  handleToolCall(update) {
    const { toolCallId, tool, input } = update;

    Logger.info(`工具调用: ${tool}`);
    Logger.json('Tool Input', input);
  }

  /**
   * 处理工具调用更新
   * @param {object} update - 更新对象
   */
  handleToolCallUpdate(update) {
    const { toolCallId, status, output } = update;

    Logger.info(`工具状态: ${status}`);

    if (status === 'completed' && output) {
      Logger.debug('工具输出:');
      Logger.json('Tool Output', output);
    }
  }

  /**
   * 处理计划/待办事项
   * @param {object} update - 更新对象
   */
  handlePlan(update) {
    const { todos } = update;

    if (todos && todos.length > 0) {
      Logger.info('AI 计划:');
      todos.forEach((todo, index) => {
        Logger.info(`  ${index + 1}. [${todo.status}] ${todo.content}`);
      });
    }
  }

  /**
   * 处理使用统计更新
   * @param {object} update - 更新对象
   */
  handleUsageUpdate(update) {
    const { usage } = update;

    if (usage) {
      Logger.info('Token 使用统计:');
      Logger.json('Usage', usage);
    }
  }

  // ======================================================================
  // 文件操作处理
  // ======================================================================

  /**
   * 处理读取文件请求
   * @param {object} params - { sessionId, path }
   * @returns {Promise<object>} { text }
   */
  async handleReadTextFile(params) {
    const { path: filePath } = params;
    const fullPath = path.resolve(this.workingDir, filePath);

    Logger.info(`读取文件: ${filePath}`);

    try {
      const text = fs.readFileSync(fullPath, 'utf-8');
      Logger.success(`文件读取成功 (${text.length} 字符)`);
      return { text };
    } catch (err) {
      Logger.error(`文件读取失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 处理写入文件请求
   * @param {object} params - { sessionId, path, content }
   * @returns {Promise<object>} {}
   */
  async handleWriteTextFile(params) {
    const { path: filePath, content } = params;
    const fullPath = path.resolve(this.workingDir, filePath);

    Logger.separator();
    Logger.info(`📝 收到文件写入请求:`);
    Logger.info(`   路径: ${filePath}`);
    Logger.info(`   大小: ${content.length} 字符`);
    Logger.separator();

    // 显示文件内容预览
    Logger.info('文件内容预览:');
    console.log('\x1b[36m' + content.substring(0, 500) + (content.length > 500 ? '...' : '') + '\x1b[0m');
    Logger.separator();

    // 模拟用户确认（实际应用中应该弹出确认对话框）
    Logger.success('✅ 自动确认写入（实际应用中应由用户确认）');

    try {
      // 确保目录存在
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(fullPath, content, 'utf-8');
      Logger.success(`文件已写入: ${fullPath}`);

      return {};
    } catch (err) {
      Logger.error(`文件写入失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 处理权限请求
   * @param {object} params - { sessionId, toolCall, options }
   * @returns {Promise<object>} { outcome: { outcome, optionId } }
   */
  async handleRequestPermission(params) {
    const { sessionId, toolCall, options } = params;

    Logger.separator();
    Logger.warn('🔐 收到权限请求:');
    Logger.info(`   工具: ${toolCall.kind}`);
    Logger.info(`   标题: ${toolCall.title}`);
    Logger.separator();

    // 显示可选操作
    if (options && options.length > 0) {
      Logger.info('可选操作:');
      options.forEach((opt, index) => {
        Logger.info(`   ${index + 1}. [${opt.id}] ${opt.label}`);
      });
    }

    // 模拟自动批准（实际应用中应由用户选择）
    Logger.success('✅ 自动批准（实际应用中应由用户选择）');

    return {
      outcome: {
        outcome: 'approved',
        optionId: options && options.length > 0 ? options[0].id : 'approve'
      }
    };
  }

  // ======================================================================
  // ACP 协议方法
  // ======================================================================

  /**
   * 初始化协议（握手）
   * @returns {Promise<object>} 初始化响应
   */
  async initialize() {
    Logger.separator();
    Logger.info('🤝 开始协议初始化...');

    const result = await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientInfo: {
        name: 'LayaAir IDE Plugin',
        version: '1.0.0'
      }
    });

    this.initialized = true;
    this.agentInfo = result.agentInfo;

    Logger.success('协议初始化成功!');
    Logger.json('Agent Info', this.agentInfo);
    Logger.json('Capabilities', result.agentCapabilities);
    Logger.separator();

    return result;
  }

  /**
   * 创建新会话
   * @returns {Promise<object>} 会话信息
   */
  async createSession() {
    Logger.separator();
    Logger.info('🎯 创建新会话...');

    const result = await this.sendRequest('session/new', {
      cwd: this.workingDir,
      mcpServers: [] // 可选：添加 MCP 服务器配置
    });

    this.sessionId = result.sessionId;

    Logger.success('会话创建成功!');
    Logger.info(`会话 ID: ${this.sessionId}`);
    Logger.json('Available Models', result.models);
    Logger.separator();

    return result;
  }

  /**
   * 发送 Prompt（用户消息）
   * @param {string} text - 提示文本
   * @param {string} modelId - 可选的模型 ID
   * @returns {Promise<object>} Prompt 响应
   */
  async sendPrompt(text) {
    if (!this.sessionId) {
      throw new Error('未创建会话，请先调用 createSession()');
    }

    Logger.separator();
    Logger.info('💬 发送 Prompt:');
    Logger.info(`   内容: ${text}`);
    Logger.separator();

    const params = {
      sessionId: this.sessionId,
      prompt: [
        {
          type: 'text',
          text: text
        }
      ]
    };

    Logger.info('AI 正在思考...\n');

    // 清空消息缓冲区，准备收集本次 prompt 的输出
    this.messageBuffer = '';

    const result = await this.sendRequest('session/prompt', params, 120000); // 2分钟超时

    console.log('\n');
    Logger.separator();
    Logger.success('Prompt 处理完成!');

    // 将累积的完整文本附加到结果中
    const fullText = this.messageBuffer.trim();
    result.text = fullText;
    Logger.json('Result', result);
    Logger.separator();

    return result;
  }

  /**
   * 设置会话模型（必须在 sendPrompt 之前调用）
   * @param {string} modelId - 模型 ID，如 "opencode/gpt-5-nano"
   * @returns {Promise<object>} 设置结果
   */
  async setModel(modelId) {
    if (!this.sessionId) {
      throw new Error('未创建会话，请先调用 createSession()');
    }

    Logger.info(`设置会话模型: ${modelId}`);

    const result = await this.sendRequest('session/set_model', {
      sessionId: this.sessionId,
      modelId: modelId
    });

    Logger.success(`模型已设置: ${modelId}`);
    return result;
  }

  /**
   * 取消当前操作
   */
  async cancel() {
    if (!this.sessionId) {
      return;
    }

    Logger.warn('取消当前操作...');
    this.sendNotification('session/cancel', {
      sessionId: this.sessionId
    });
  }

  /**
   * 打印统计信息
   */
  printStats() {
    Logger.separator();
    Logger.info('📊 通信统计:');
    Logger.info(`   发送请求: ${this.stats.requestsSent}`);
    Logger.info(`   收到响应: ${this.stats.responsesReceived}`);
    Logger.info(`   收到通知: ${this.stats.notificationsReceived}`);
    Logger.info(`   错误次数: ${this.stats.errors}`);
    Logger.separator();
  }
}

// ========================================================================
// 主测试流程
// ========================================================================

async function main() {
  console.log('\x1b[1m\x1b[36m');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         OpenCode ACP Protocol Verification Script             ║');
  console.log('║         LayaAir IDE Plugin Backend Simulation                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m\n');

  const client = new ACPClient({
    workingDir: CONFIG.WORKING_DIR
  });

  try {
    // ================================================================
    // 步骤 1: 启动 OpenCode ACP 进程
    // ================================================================
    await client.start();

    // ================================================================
    // 步骤 2: 初始化协议
    // ================================================================
    await client.initialize();

    // ================================================================
    // 步骤 3: 创建会话
    // ================================================================
    const sessionResult = await client.createSession();

    // ================================================================
    // 步骤 3.5: 设置模型（使用已认证的 provider）
    // ================================================================
    // 从 session/new 返回的 availableModels 中选择已认证的模型
    const models = sessionResult.models && sessionResult.models.availableModels || [];
    // 优先使用 opencode 免费模型（流式传输已验证可用），再尝试 deepseek
    // 使用 DeepSeek 避免 OpenCode Zen 免费层限流
    // (title 生成用 opencode 免费层，主请求用 DeepSeek 避免并发限流)
    const preferredModels = [
      'deepseek/deepseek-chat',
      'opencode/gpt-5-nano',
      'opencode/big-pickle',
    ];
    let modelToUse = sessionResult.models && sessionResult.models.currentModelId;
    for (const preferred of preferredModels) {
      if (models.find(m => m.modelId === preferred)) {
        modelToUse = preferred;
        break;
      }
    }
    if (modelToUse) {
      await client.setModel(modelToUse);
    } else {
      Logger.warn('没有可用模型，跳过 setModel');
    }

    // ================================================================
    // 步骤 4: 发送测试 Prompt（可选步骤，LLM API 限流时允许超时）
    // ================================================================
    const promptResult = await client.sendPrompt(CONFIG.TEST_PROMPT);
    Logger.success('Prompt 返回结果:');
    Logger.json('Prompt Result', promptResult);

    // ================================================================
    // 步骤 5: 打印统计信息
    // ================================================================
    client.printStats();

    // ================================================================
    // 步骤 6: 清理资源
    // ================================================================
    Logger.info('测试完成，准备退出...');
    client.cleanup();

    process.exit(0);
  } catch (err) {
    Logger.error('测试失败:', err.message);
    if (err.stack) {
      Logger.debug(err.stack);
    }
    client.cleanup();
    process.exit(1);
  }
}

// ========================================================================
// 错误处理
// ========================================================================

process.on('uncaughtException', (err) => {
  Logger.error('未捕获的异常:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('未处理的 Promise 拒绝:', reason);
  process.exit(1);
});

// 优雅退出
process.on('SIGINT', () => {
  Logger.info('\n收到退出信号，正在清理...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  Logger.info('收到终止信号，正在清理...');
  process.exit(0);
});

// ========================================================================
// 启动主流程
// ========================================================================

if (require.main === module) {
  main();
}

module.exports = { ACPClient, createJsonRpcRequest, createJsonRpcNotification };
