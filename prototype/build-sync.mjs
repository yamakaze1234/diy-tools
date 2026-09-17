import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('./cloudbase-browser.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,outfile:fileURLToPath(new URL('./vendor/cloudbase.js',import.meta.url))});
