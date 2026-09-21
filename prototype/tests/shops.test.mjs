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

test('技嘉默认浅色黑橙，乔思伯默认浅色，跨店身份重置品牌与默认外观',()=>{
 const gigabyte=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'gigabyte',{resetAppearance:true});
 const jonsbo=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'jonsbo',{resetAppearance:true});
 assert.equal(gigabyte.theme,'light');assert.equal(gigabyte.brandText,'GIGABYTE');
 assert.deepEqual(gigabyte.palette,shopPalette('gigabyte','light'));
 assert.equal(gigabyte.palette.bg,'#fdfbf8');assert.equal(gigabyte.palette.accent,'#d64825');
 assert.equal(jonsbo.theme,'light');assert.equal(jonsbo.brandText,'JONSBO');
 assert.deepEqual(jonsbo.palette,shopPalette('jonsbo','light'));
 assert.equal(jonsbo.palette.bg,'#f2f5f9');assert.equal(jonsbo.palette.text,'#253b50');
});

test('技嘉和乔思伯均保留浅深两套主题，来回切换恢复对应配色',()=>{
 const gigabyte=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'gigabyte',{resetAppearance:true});
 switchShopTheme(gigabyte,'dark');assert.equal(gigabyte.palette.bg,'#101010');assert.equal(gigabyte.palette.accent,'#ff7900');
 switchShopTheme(gigabyte,'light');assert.equal(gigabyte.palette.bg,'#fdfbf8');assert.equal(gigabyte.palette.accent,'#d64825');
 const jonsbo=applyShopIdentity({...structuredClone(legacyConfig),modules:[]},'jonsbo',{resetAppearance:true});
 switchShopTheme(jonsbo,'light');assert.equal(jonsbo.palette.bg,'#f2f5f9');assert.equal(jonsbo.palette.text,'#253b50');
 switchShopTheme(jonsbo,'dark');assert.equal(jonsbo.palette.bg,'#101c24');assert.equal(jonsbo.palette.text,'#edf5f7');
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
 assert.equal(next.configs[0].upgradeColor,'#ffd477');
 assert.equal(next.configs[0].modules[0].background,'#2c4353');
 for(const key of ['palette','themePalettes','upgradeColor','modules'])assert.deepEqual(next.configs[1][key],custom[key]);
 assert.deepEqual(normalizeWorkspaceState(next),next);
 switchShopTheme(next.configs[0],'light');
 assert.equal(next.configs[0].upgradeColor,'#a64116');
 assert.equal(next.configs[0].modules[0].background,'#3b5870');
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
 assert.equal(blank.modules.find(m=>m.type==='service').background,'#3a3c40');
 const custom={id:'service',type:'service',text:'自定义承诺',background:'#123456',color:'#abcdef'};
 assert.deepEqual(posterModules({shopId:'gigabyte',theme:'dark',modules:[custom]}),[custom]);
});
