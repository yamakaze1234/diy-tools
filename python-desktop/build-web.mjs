import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(root,'../prototype');
const {build}=createRequire(path.join(source,'package.json'))('esbuild');
await fs.mkdir(path.join(root,'web'),{recursive:true});
for(const e of await fs.readdir(source,{withFileTypes:true}))if(e.isFile()&&/\.(js|html|css)$/.test(e.name))await fs.copyFile(path.join(source,e.name),path.join(root,'web',e.name));
for(const dir of ['assets','vendor'])await fs.cp(path.join(source,dir),path.join(root,'web',dir),{recursive:true});
// Public builds must never embed the maintainer's local/team CloudBase settings.
await fs.copyFile(path.join(source,'.env.example'),path.join(root,'web','.env.local'));
await fs.writeFile(path.join(root,'web','seed.json'),JSON.stringify({revision:0,configs:[],templates:[],sourceCatalog:[],costSource:[],caseGallery:[],logs:[],dataVersion:3}));
await fs.writeFile(path.join(root,'web','catalog.json'),'[]');
await build({entryPoints:[path.join(root,'domain-entry.js')],bundle:true,platform:'neutral',format:'iife',globalName:'Domain',target:'es2022',outfile:path.join(root,'domain-bundle.js'),alias:{'node:crypto':path.join(root,'crypto-shim.js')},external:['mssql']});
console.log('UI copied; pure rules bundled for the Python embedded engine');
