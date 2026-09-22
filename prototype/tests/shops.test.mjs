import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspaceState,sourcesFor,shopPalette,switchShopTheme,applyShopIdentity} from '../shops.js';
import {bindSources,syncSource} from '../source.js';
import {costRows,applyManualCosts} from '../erp-sync.js';

const legacyConfig={
 id:'intel-config',shop:'英特尔官方旗舰店',product:'测试链接',name:'配置1',theme:'light',
 parts:[{slot:'CPU',goodsId:'10001',name:'英特尔展示名',qty:1,erp:800,tax:900,upgrade:'英特尔升级',sourceId:'catalog-0'}],
 addons:[{text:'英特尔加购',note:'仅英特尔'}],benefits:[],modules:[]
};
const base=[{sourceId:'catalog-0',goodsId:'10001',name:'基础名称',erp:800,tax:900,warranty:'质保',upgrade:'',addonText:'',addonNote:''}];

test('旧单店数据迁移为三店输出源，现有配置与优惠券归入英特尔',()=>{
 const state=normalizeWorkspaceState({configs:[legacyConfig],templates:[],sourceCatalog:base,shopSettings:{coupon:400}},base);
 assert.equal(state.dataVersion,3);
 assert.equal(state.configs[0].shopId,'intel');
 assert.equal(state.configs[0].shop,'英特尔官方旗舰店');
 assert.deepEqual(state.shopSettings,{intel:{coupon:400},gigabyte:{coupon:0},jonsbo:{coupon:0}});
 for(const id of ['intel','gigabyte','jonsbo'])assert.equal(sourcesFor(state,id).filter(r=>!r.specialComponent).length,1);
 assert.equal(sourcesFor(state,'gigabyte')[0].sourceId,'gigabyte:catalog-0');
 assert.equal(sourcesFor(state,'jonsbo')[0].sourceId,'jonsbo:catalog-0');
});

test('三店显示名称与加购隔离，核算价按 goodsId 同步共享',()=>{
 const state=normalizeWorkspaceState({configs:[legacyConfig],templates:[],sourceCatalog:base,shopSettings:{coupon:400}},base);
 const intel=state.configs[0],gigabyte=structuredClone(intel),jonsbo=structuredClone(intel);
 Object.assign(gigabyte,{id:'gigabyte-config',shopId:'gigabyte',shop:'技嘉旗舰店',addons:[]});
 Object.assign(jonsbo,{id:'jonsbo-config',shopId:'jonsbo',shop:'乔思伯官方旗舰店',addons:[]});
 delete gigabyte.parts[0].sourceId;delete jonsbo.parts[0].sourceId;
 state.configs.push(gigabyte,jonsbo);bindSources(state.configs,state.sourceCatalog);
 const gigabyteSource=sourcesFor(state,'gigabyte')[0];Object.assign(gigabyteSource,{name:'技嘉展示名',addonText:'技嘉加购',addonNote:'仅技嘉'});
 syncSource([gigabyte],gigabyteSource,['name','addon']);
 assert.equal(gigabyte.parts[0].name,'技嘉展示名');
 assert.equal(gigabyte.addons[0].text,'技嘉加购');
 assert.equal(intel.parts[0].name,'英特尔展示名');
 assert.equal(intel.addons[0].text,'英特尔加购');
 state.costSource=costRows(state.sourceCatalog);
 const changed=applyManualCosts(state,[{goodsId:'10001',tax:975}],'2026-09-16T00:00:00Z');
 assert.deepEqual(new Set(changed),new Set(['intel-config','gigabyte-config','jonsbo-config']));
 assert.ok(state.configs.every(config=>config.parts[0].tax===975));
 assert.ok(state.sourceCatalog.every(row=>row.tax===975));
 assert.equal(gigabyte.parts[0].name,'技嘉展示名');
 assert.equal(intel.parts[0].name,'英特尔展示名');
});

test('技嘉默认浅色青色，乔思伯默认浅色，跨店身份重置品牌与默认外观',()=>{
 const gigabyte=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'gigabyte',{resetAppearance:true});
 const jonsbo=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'jonsbo',{resetAppearance:true});
 assert.equal(gigabyte.theme,'light');assert.equal(gigabyte.brandText,'AORUS');
 assert.deepEqual(gigabyte.palette,shopPalette('gigabyte','light'));
 assert.equal(gigabyte.palette.bg,'#ffffff');assert.equal(gigabyte.palette.accent,'#008d96');
 assert.equal(jonsbo.theme,'light');assert.equal(jonsbo.brandText,'JONSBO');
 assert.deepEqual(jonsbo.palette,shopPalette('jonsbo','light'));
 assert.equal(jonsbo.palette.bg,'#ffffff');assert.equal(jonsbo.palette.text,'#202124');
});

test('技嘉和乔思伯均保留浅深两套主题，来回切换恢复对应配色',()=>{
 const gigabyte=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'gigabyte',{resetAppearance:true});
 switchShopTheme(gigabyte,'dark');assert.equal(gigabyte.palette.bg,'#1e1f21');assert.equal(gigabyte.palette.accent,'#ff6400');
 switchShopTheme(gigabyte,'light');assert.equal(gigabyte.palette.bg,'#ffffff');assert.equal(gigabyte.palette.accent,'#008d96');
 const jonsbo=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'jonsbo',{resetAppearance:true});
 switchShopTheme(jonsbo,'light');assert.equal(jonsbo.palette.bg,'#ffffff');assert.equal(jonsbo.palette.text,'#202124');
 switchShopTheme(jonsbo,'dark');assert.equal(jonsbo.palette.bg,'#222326');assert.equal(jonsbo.palette.text,'#f4f4f2');
});

test('乔思伯旧默认主题更新保留业务数据、文字格式和手工配色，重复载入稳定',()=>{
 const old={bg:'#101010',text:'#ffffff',accent:'#ffffff',line:'#353535',muted:'#b8b8b8',panel:'#1d1d1d'};
 const config={...structuredClone(legacyConfig),shopId:'jonsbo',theme:'dark',palette:old,upgradeColor:'#ffffff',themePalettes:{dark:old},modules:[{type:'service',background:'#1d1d1d'}],textStyles:{'header.brand':{size:30}}};
 const custom=structuredClone(config);custom.id='custom';custom.palette.accent='#abcdef';custom.modules[0].background='#112233';custom.upgradeColor='#fedcba';custom.themePalettes.dark.accent='#abcdef';
 const input={dataVersion:3,configs:[config,custom],templates:[],sourceCatalog:[]};
 const next=normalizeWorkspaceState(input);
 assert.deepEqual(input.configs[0].palette,old);
 assert.deepEqual(next.configs[0].parts,config.parts);
 assert.deepEqual(next.configs[0].textStyles,config.textStyles);
 assert.deepEqual(next.configs[0].palette,shopPalette('jonsbo','dark'));
 assert.deepEqual(next.configs[0].themePalettes.dark,shopPalette('jonsbo','dark'));
 assert.equal(next.configs[0].upgradeColor,'#ffce88');
 assert.equal(next.configs[0].modules[0].background,'#484a50');
 for(const key of ['palette','themePalettes','upgradeColor','modules'])assert.deepEqual(next.configs[1][key],custom[key]);
 assert.deepEqual(normalizeWorkspaceState(next),next);
 switchShopTheme(next.configs[0],'light');
 assert.equal(next.configs[0].upgradeColor,'#97531b');
 assert.equal(next.configs[0].modules[0].background,'#35383d');
});

test('三店旧内置深色主题迁移到新版卡片色，手工配色保持不变',()=>{
 const old={
  intel:{bg:'#07172e',text:'#eef5ff',accent:'#57bdff',line:'#213a59',muted:'#a3b7d0',panel:'#0e2643'},
  gigabyte:{bg:'#292b31',text:'#f8f5f1',accent:'#ffbb80',line:'#5c5c62',muted:'#c9c2bb',panel:'#45464d'},
  jonsbo:{bg:'#1c1d20',text:'#f1f0ed',accent:'#c9b990',line:'#505155',muted:'#aaa9a6',panel:'#34363a'}
 };
 const service={intel:'#173e76',gigabyte:'#65422e',jonsbo:'#414145'};
 const configs=Object.keys(old).flatMap(shopId=>{
  const base={...structuredClone(legacyConfig),id:shopId,shopId,theme:'dark',palette:old[shopId],themePalettes:{dark:old[shopId]},upgradeColor:old[shopId].accent,modules:[{type:'service',background:service[shopId]}]};
  const custom=structuredClone(base);custom.id=shopId+'-custom';custom.palette.accent='#abcdef';custom.themePalettes.dark.accent='#abcdef';custom.modules[0].background='#123456';return[base,custom];
 });
 const next=normalizeWorkspaceState({dataVersion:3,configs,templates:[],sourceCatalog:[]});
 for(const shopId of Object.keys(old)){
  const migrated=next.configs.find(c=>c.id===shopId),custom=next.configs.find(c=>c.id===shopId+'-custom');
  assert.deepEqual(migrated.palette,shopPalette(shopId,'dark'));
  assert.deepEqual(migrated.themePalettes.dark,shopPalette(shopId,'dark'));
  assert.notEqual(migrated.modules[0].background,service[shopId]);
  assert.equal(custom.palette.accent,'#abcdef');assert.equal(custom.modules[0].background,'#123456');
 }
 assert.deepEqual(normalizeWorkspaceState(next),next);
});


test('三店两套主题的新配置与补入服务条使用确认后的同一配色',async()=>{
 const {modulesDefault,posterModules,blankConfig}=await import('../core.js');
 const {shopServiceColor,shopServiceTextColor}=await import('../poster-theme.js');
 for(const shopId of ['intel','gigabyte','jonsbo'])for(const theme of ['light','dark']){
  const direct=modulesDefault(shopId,theme).find(m=>m.type==='service');
  const inserted=posterModules({shopId,theme,modules:[]}).find(m=>m.type==='service');
  for(const m of [direct,inserted]){assert.equal(m.background,shopServiceColor(shopId,theme));assert.equal(m.color,shopServiceTextColor(shopId,theme));assert.match(m.text,/保价双11/);}
 }
 const blank=blankConfig(null,{id:'test',name:'测试',shopId:'gigabyte'});
 assert.equal(blank.modules.find(m=>m.type==='service').background,'#383a3e');
 const custom={id:'service',type:'service',text:'自定义承诺',background:'#123456',color:'#abcdef'};
 assert.deepEqual(posterModules({shopId:'gigabyte',theme:'dark',modules:[custom]}),[custom]);
});
