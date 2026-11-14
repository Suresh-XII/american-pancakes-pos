#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const testChain = packageJson.scripts['test:all-sequential'];

if (!testChain) {
  console.error('Missing package script: test:all-sequential');
  process.exit(2);
}

const commands = testChain.split(/\s*&&\s*/).filter(Boolean);

const startIndex = parseInt(process.env.START_INDEX || '0', 10);
let passed = 0;
let failed = 0;
const failures = [];

console.log(`\nFloCafe Full Regression Suite`);
console.log(`Total commands: ${commands.length}`);
if (startIndex > 0) {
  console.log(`Starting from command: ${startIndex + 1}\n`);
} else {
  console.log('');
}

for (let i = startIndex; i < commands.length; i++) {
  const command = commands[i];

  const wrapped = command.match(
    /^node scripts\/run-test\.cjs npm run (test:[\w:-]+)$/
  );

  const direct = command.match(/^npm run (test:[\w:-]+)$/);

  if (!wrapped && !direct) {
    console.error(`Invalid command at position ${i + 1}:`);
    console.error(command);
    process.exit(2);
  }

  const scriptName = (wrapped || direct)[1];

  console.log(`\n[${i + 1}/${commands.length}] Running ${scriptName}`);

  const result = wrapped
    ? spawnSync(
        process.execPath,
        [
          path.join(__dirname, 'run-test.cjs'),
          'npm',
          'run',
          scriptName
        ],
        { stdio: 'inherit', windowsHide: true }
      )
    : spawnSync(
        'npm',
        ['run', scriptName],
        {
          stdio: 'inherit',
          shell: process.platform === 'win32',
          windowsHide: true
        }
      );

  if (result.error || result.status !== 0) {
    failed++;
    failures.push(scriptName);

    console.error(`\nFAILED: ${scriptName}`);
    if (result.error) console.error(result.error.message);

    break;
  }

  passed++;
  console.log(`PASSED: ${scriptName}`);
}

console.log('\n========================================');
console.log('FULL REGRESSION SUMMARY');
console.log('========================================');
console.log(`Total:  ${commands.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length) {
  console.error('Failed test:', failures.join(', '));
  process.exit(1);
}

console.log('\nAll regression commands passed!');
