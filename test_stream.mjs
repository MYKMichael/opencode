// Test streaming fetch in bun subprocess
const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-1802cb6d4041457bbc9e51d9589e47ea'
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [{role: 'user', content: 'say hi'}],
    max_tokens: 5,
    stream: true
  })
});
console.error('status:' + res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let chunks = 0;
while(true) {
  const {done, value} = await reader.read();
  if(done) break;
  chunks++;
  console.error('chunk:' + chunks + ' ' + decoder.decode(value).substring(0, 80));
}
console.error('done chunks:' + chunks);
process.exit(0);
