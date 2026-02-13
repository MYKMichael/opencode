// Test full streaming fetch content from DeepSeek
const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-1802cb6d4041457bbc9e51d9589e47ea'
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [{role: 'user', content: '输出20个汉字'}],
    max_tokens: 50,
    stream: true,
    // Include tools like opencode does
    tools: [{type: 'function', function: {name: 'test_tool', description: 'A test tool', parameters: {type: 'object', properties: {}}}}]
  })
});
console.error('status:' + res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let fullBody = '';
while(true) {
  const {done, value} = await reader.read();
  if(done) break;
  const text = decoder.decode(value);
  fullBody += text;
}
console.error('FULL BODY:');
console.error(fullBody);
process.exit(0);
