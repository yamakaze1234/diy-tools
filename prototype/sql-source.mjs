// Fixed, read-only queries mirror the inventory monitor's verified source views.
export const MAX_SQL_ROWS=100000;
export const SQL_QUERIES=[
 'SELECT TOP (100001) CONVERT(varchar(20), [goods_id]) AS [goods_id], [库房], [商品编码], [商品名称], [分库数], [分库可销数], [分库待入], [库存成本] FROM [库存].[分库库存]',
 'SELECT TOP (100001) CONVERT(varchar(20), [goods_id]) AS [goods_id], [商品编码], [商品名称], [总数量], [可销数], [待入] FROM [库存].[库存查询]'
];
export function sqlSettings(input={}){
 const result={};for(const key of ['server','database','user']){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>200)throw Error('请填写服务器、数据库和账号');result[key]=input[key].trim();}
 result.port=Number(input.port||1433);if(!Number.isInteger(result.port)||result.port<1||result.port>65535)throw Error('数据库端口无效');
 result.encrypt=input.encrypt!==false;result.trustServerCertificate=input.trustServerCertificate===true;return result;
}
function numeric(value){if(value===null)return null;if(typeof value==='boolean'||value===undefined||typeof value==='string'&&!value.trim()||!Number.isFinite(Number(value)))throw Error('数据库库存数值无效，已保留原数据');return Number(value);}
function decoded(value,legacy){if(typeof value!=='string')throw Error('数据库文本字段无效');if(!legacy||[...value].some(c=>c.charCodeAt(0)>255))return value;try{return new TextDecoder('gb18030',{fatal:true}).decode(Buffer.from(value,'latin1'));}catch{throw Error('数据库文本编码不一致，已保留原数据');}}
export function normalizeSqlBundle(bundle){
 if(!bundle||!Array.isArray(bundle.warehouses)||!Array.isArray(bundle.catalog)||!bundle.catalog.length||bundle.catalog.length>MAX_SQL_ROWS||bundle.warehouses.length>MAX_SQL_ROWS)throw Error('数据库目录为空、不完整或超过 100000 行，已保留原数据');
 const marker=Buffer.from('b9abcbbeb4f3bfe2','hex').toString('latin1'),legacy=bundle.warehouses.some(r=>r['库房']===marker);
 const byId=new Map(),codes=new Map(),warehouseKeys=new Set(),catalogIds=new Set();
 const identity=r=>{const goodsId=String(r.goods_id??'');if(!/^[1-9]\d{0,19}$/.test(goodsId)||typeof r.goods_id==='number'&&!Number.isSafeInteger(r.goods_id))throw Error('数据库 goods_id 缺失或不精确');const name=decoded(r['商品名称'],legacy).trim(),sku=decoded(r['商品编码'],legacy).trim();if(!name||!sku||sku==='0')throw Error('数据库商品身份不完整');if(codes.has(sku)&&codes.get(sku)!==goodsId||byId.has(goodsId)&&byId.get(goodsId).sku!==sku)throw Error('数据库商品编号与编码不一致');codes.set(sku,goodsId);return{goodsId,name,sku};};
 for(const raw of bundle.warehouses){const id=identity(raw),warehouse=decoded(raw['库房'],legacy).trim();if(!warehouse||warehouse.length>100)throw Error('数据库库房身份无效');const key=id.goodsId+'|'+warehouse;if(warehouseKeys.has(key))throw Error('同一商品和库房出现重复记录');warehouseKeys.add(key);numeric(raw['分库数']);numeric(raw['分库待入']??null);const able=numeric(raw['分库可销数']);const row=byId.get(id.goodsId)||{...id,stockAvailable:null,erp:null};if(warehouse==='公司大库'){const erp=numeric(raw['库存成本']);if(erp!==null&&erp<0)throw Error('SQL 库存成本必须是非负单件成本');row.stockAvailable=able;row.erp=erp;}byId.set(id.goodsId,row);}
 for(const raw of bundle.catalog){const id=identity(raw);if(catalogIds.has(id.goodsId))throw Error('完整目录商品编号重复');catalogIds.add(id.goodsId);byId.set(id.goodsId,{...(byId.get(id.goodsId)||{stockAvailable:null,erp:null}),...id});}
 return [...byId.values()];
}
export function sqlFailure(error,stage){
 const chain=[],seen=new Set();const visit=e=>{if(!e||typeof e!=='object'||seen.has(e))return;seen.add(e);chain.push(e);for(const key of ['cause','originalError','info'])visit(e[key]);for(const item of e.precedingErrors||[])visit(item);};visit(error);
 const codes=chain.map(e=>String(e.code||'')),numbers=chain.map(e=>Number(e.number)),messages=chain.map(e=>String(e.message||'')).join(' ');
 let code='SQL_UNKNOWN',detail='未能完成请求，请联系维护人员核对驱动与服务端设置';
 if(stage==='driver'){code='SQL_DRIVER';detail='数据库驱动加载失败，请使用完整的新版桌面程序';}
 else if(codes.some(c=>['ENOTFOUND','EAI_AGAIN'].includes(c))){code='SQL_DNS';detail='服务器地址解析失败，请核对服务器名称及网络';}
 else if(codes.includes('ECONNREFUSED')){code='SQL_REFUSED';detail='服务器拒绝连接，请核对端口及 SQL Server 服务';}
 else if(codes.some(c=>/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c))||/certificate|self.signed|证书/i.test(messages)){code='SQL_CERTIFICATE';detail='服务器证书校验失败；若这是公司确认的自签证书，请勾选“信任服务器证书”后重试';}
 else if(numbers.includes(4060)||numbers.includes(911)){code='SQL_DATABASE';detail='数据库不存在或当前账号无权打开，请核对实际数据库名（不要填写连接名称）';}
 else if(codes.includes('ELOGIN')||numbers.includes(18456)){code='SQL_LOGIN';detail='SQL Server 拒绝登录，请核对实际用户名、密码和数据库访问权限';}
 else if(numbers.includes(229)||numbers.includes(916)){code='SQL_PERMISSION';detail='账号没有读取库存视图的权限，请由数据库管理员开通只读权限';}
 else if(numbers.includes(208)||numbers.includes(207)){code='SQL_SCHEMA';detail='数据库中缺少所需库存视图或字段，请核对数据库及库存视图版本';}
 else if(/ssl|tls|protocol version|handshake/i.test(messages)){code='SQL_TLS';detail='加密握手失败，请由管理员核对 SQL Server 的 TLS 支持与连接设置';}
 else if(codes.some(c=>['ETIMEOUT','ETIMEDOUT'].includes(c))){code='SQL_TIMEOUT';detail=stage==='query'?'库存查询超时，原数据保留；请稍后重试或检查数据库负载':'连接超时，请核对公司网络、端口及防火墙';}
 else if(codes.includes('ESOCKET')){code='SQL_SOCKET';detail='数据库连接被中断，请核对网络及服务器连接设置';}
 else if(codes.includes('SQL_ROW_LIMIT')){code='SQL_ROW_LIMIT';detail='查询超过 100000 行或返回格式不完整，已拒收截断数据';}
 const label={driver:'驱动加载',connect:'连接数据库',query:'读取库存'}[stage]||'数据库操作';
 return Object.assign(Error(`${label}失败 [${code}]：${detail}。本机原数据未改动。`),{code});
}
export async function readSqlBundle(settings,password,{driver}={}){
 const config=sqlSettings(settings);if(typeof password!=='string'||!password||password.length>1024)throw Error('请输入数据库密码');let pool,stage='driver';
 try{const sql=driver||(await import('mssql')).default;stage='connect';pool=new sql.ConnectionPool({...config,password,connectionTimeout:10000,requestTimeout:30000,pool:{max:1,min:0,idleTimeoutMillis:1000},options:{encrypt:config.encrypt,trustServerCertificate:config.trustServerCertificate,appName:'DIYWorkbenchReadonly',readOnlyIntent:true}});await pool.connect();stage='query';const results=[];for(const query of SQL_QUERIES){const data=await pool.request().query(query);if(!Array.isArray(data.recordset)||data.recordset.length>MAX_SQL_ROWS)throw Object.assign(Error('invalid rows'),{code:'SQL_ROW_LIMIT'});results.push(data.recordset);}return{warehouses:results[0],catalog:results[1]};}
 catch(error){throw sqlFailure(error,stage);}
 finally{if(pool)await pool.close().catch(()=>{});}
}
