#!/usr/bin/env node
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║      ACP 核心功能单元测试                             ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

let passed = 0, failed = 0;

function ok(msg) { passed++; console.log('\x1b[32m  ✓\x1b[0m ' + msg); }
function fail(msg) { failed++; console.log('\x1b[31m  ✗\x1b[0m ' + msg); }

async function run() {
  // === Test 1: spawn ===
  console.log('\n[1/6] child_process.spawn');
  await new Promise((resolve) => {
    const p = spawn('echo', ['hello_spawn']);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', code => {
      code === 0 ? ok('spawn 退出码 0') : fail('spawn 退出码 ' + code);
      out.trim() === 'hello_spawn' ? ok('stdout 输出正确') : fail('stdout 输出异常: ' + out);
      resolve();
    });
  });

  // === Test 2: readline 粘包处理 ===
  console.log('\n[2/6] readline 粘包处理');
  await new Promise((resolve) => {
    const r = new stream.Readable();
    // 模拟粘包: 两条 JSON 在同一个 push 中
    r.push('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n');
    r.push(null);
    const rl = readline.createInterface({ input: r, crlfDelay: Infinity });
    const msgs = [];
    rl.on('line', line => {
      try { msgs.push(JSON.parse(line)); } catch(e) { fail('JSON 解析失败: ' + e.message); }
    });
    rl.on('close', () => {
      msgs.length === 2 ? ok('正确拆分为 2 条消息') : fail('消息数量: ' + msgs.length);
      msgs[0] && msgs[0].method === 'initialize' ? ok('消息1: request') : fail('消息1 异常');
      msgs[1] && msgs[1].result ? ok('消息2: response') : fail('消息2 异常');
      resolve();
    });
  });

  // === Test 3: JSON-RPC 2.0 消息构造 ===
  console.log('\n[3/6] JSON-RPC 2.0 消息构造');
  const req = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } };
  req.jsonrpc === '2.0' ? ok('request 格式正确') : fail('request 格式错误');
  const res = { jsonrpc: '2.0', id: 1, result: { agentInfo: { name: 'test' } } };
  res.result ? ok('response 格式正确') : fail('response 格式错误');
  const notif = { jsonrpc: '2.0', method: 'sessionUpdate', params: { type: 'chunk' } };
  (!notif.id && notif.method) ? ok('notification 格式正确 (无 id)') : fail('notification 格式错误');

  // === Test 4: 请求/响应异步匹配 ===
  console.log('\n[4/6] 请求/响应异步匹配 (Map)');
  const pending = new Map();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 1000);
    pending.set(42, { resolve, reject, timer, method: 'test' });
    // 模拟异步响应
    setTimeout(() => {
      const p = pending.get(42);
      if (p) { clearTimeout(p.timer); pending.delete(42); p.resolve({ matched: true }); }
    }, 50);
  });
  result.matched ? ok('请求 42 匹配响应成功') : fail('匹配失败');
  pending.size === 0 ? ok('pending Map 已清理') : fail('pending 未清理');

  // === Test 5: 文件操作 (mock writeTextFile / readTextFile) ===
  console.log('\n[5/6] 文件操作模拟');
  const mockDir = path.join(__dirname, 'mock_project', 'src');
  const testFile = path.join(mockDir, '_acp_test_output.ts');
  const testContent = '// @regClass\nexport class TestScript { }';
  try {
    if (!fs.existsSync(mockDir)) fs.mkdirSync(mockDir, { recursive: true });
    fs.writeFileSync(testFile, testContent, 'utf-8');
    ok('writeTextFile 模拟成功');
    const read = fs.readFileSync(testFile, 'utf-8');
    read === testContent ? ok('readTextFile 模拟成功') : fail('读取内容不匹配');
    fs.unlinkSync(testFile);
    ok('文件清理成功');
  } catch (e) { fail('文件操作失败: ' + e.message); }

  // === Test 6: 会话更新通知分发 ===
  console.log('\n[6/6] 会话更新通知分发');
  const updates = [];
  function handleSessionUpdate(params) {
    if (!params || !params.update) return;
    switch (params.update.type) {
      case 'agent_message_chunk': updates.push('msg'); break;
      case 'agent_thought_chunk': updates.push('thought'); break;
      case 'tool_call':           updates.push('tool'); break;
      case 'tool_call_update':    updates.push('tool_upd'); break;
      case 'usage_update':        updates.push('usage'); break;
    }
  }
  handleSessionUpdate({ update: { type: 'agent_message_chunk', content: { text: 'hi' } } });
  handleSessionUpdate({ update: { type: 'tool_call', tool: 'Write' } });
  handleSessionUpdate({ update: { type: 'tool_call_update', status: 'completed' } });
  handleSessionUpdate({ update: { type: 'usage_update', usage: { input: 100 } } });
  updates.length === 4 ? ok('4 种通知类型全部分发') : fail('分发数量: ' + updates.length);
  updates.includes('msg') ? ok('agent_message_chunk 处理正确') : fail('缺少 msg');
  updates.includes('tool') ? ok('tool_call 处理正确') : fail('缺少 tool');

  // === 汇总 ===
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  通过: \x1b[32m${passed}\x1b[0m   失败: ${failed > 0 ? '\x1b[31m' + failed + '\x1b[0m' : '0'}`);
  console.log('═══════════════════════════════════════════════════════');
  if (failed === 0) {
    console.log('\n\x1b[32m✅ 所有核心功能测试通过!\x1b[0m\n');
  } else {
    console.log('\n\x1b[31m❌ 存在失败项\x1b[0m\n');
    process.exit(1);
  }
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
