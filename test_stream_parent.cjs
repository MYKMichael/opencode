const {spawn} = require('child_process');
const path = require('path');
const bunPath = path.join(process.env.USERPROFILE, '.bun', 'bin', 'bun.exe');

// Spawn bun with piped stdio (same as ACP test)
const child = spawn(bunPath, [path.join(__dirname, 'test_stream.mjs')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.on('data', d => { stderr += d.toString(); });
child.stdout.on('data', d => { /* consume stdout */ });
child.on('exit', (code) => {
  console.log('exit:', code);
  console.log(stderr);
  process.exit(code || 0);
});

setTimeout(() => {
  console.log('TIMEOUT after 20s');
  console.log(stderr);
  child.kill();
  process.exit(1);
}, 20000);
