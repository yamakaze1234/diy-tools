import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
// These historical suites require private business fixtures excluded from this public repository.
const privateFixtures=new Set(['core.test.mjs','erp-sync.test.mjs']);
const files=fs.readdirSync(new URL('./tests/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')&&!privateFixtures.has(name));
fs.mkdirSync(new URL('./.verification/',import.meta.url),{recursive:true});
console.log('Public fixture suites:',files.length,'; private fixture suites excluded:',[...privateFixtures].join(', '));
const result=spawnSync(process.execPath,['--test',...files.map(name=>'tests/'+name)],{cwd:root,stdio:'inherit'});
process.exit(result.status??1);
