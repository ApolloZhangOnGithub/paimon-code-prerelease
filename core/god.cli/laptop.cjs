#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const PAIMON_HOME = process.env.PAIMON_HOME || (os.homedir() + '/.paimon');
const id = process.argv[2], name = process.argv[3] || '';
if (!id) { console.error('用法: paimon-laptop <id> [name]'); process.exit(1); }
const f = PAIMON_HOME + '/RuntimeCache/' + id + '/laptop-screen.txt';

function show() {
  if (!fs.existsSync(f)) {
    process.stdout.write((name||id) + ' 还没用过笔记本。\n');
    return false;
  }
  process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
  process.stdout.write(fs.readFileSync(f, 'utf8') + '\n');
  return true;
}

if (!show()) process.exit(1);
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (d) => {
  if (d[0] === 0x03 || d[0] === 0x1b) { fs.unwatchFile(f); process.exit(0); }
});
fs.watchFile(f, { interval: 200 }, () => { show(); });
