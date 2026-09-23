import {normalizePosterView} from './poster-view.js';
import {ensureActualParts} from './actual-parts.js';
import {shopServiceColor,shopServiceTextColor} from './poster-theme.js';
export {shopServiceColor,shopServiceTextColor} from './poster-theme.js';
import {withSpecialPresets,normalizeSpecialComponent} from './special-components.js';
import {preferredSourceRows} from './source.js';
import {restoreConfigOrder} from './config-order.js';
import {selectableComponents} from './component-policy.js';
import {clone} from './core.js';
import {normalizeGallery} from './case-gallery-data.js';
import {normalizePosterDesign} from './poster-design.js';

export const SHOP_IDS={intel:'intel',gigabyte:'gigabyte',jonsbo:'jonsbo'};
export const shops=[
 {id:SHOP_IDS.intel,name:'英特尔官方旗舰店',shortName:'英特尔',brandText:'intel.',defaultTheme:'light'},
 {id:SHOP_IDS.gigabyte,name:'技嘉旗舰店',shortName:'技嘉',brandText:'AORUS',defaultTheme:'light',brandLogo:{src:'/assets/aorus-logo.png',crop:[0,0,610,165],lightColor:'#15161a',darkColor:'#ffffff'}},
 {id:SHOP_IDS.jonsbo,name:'乔思伯官方旗舰店',shortName:'乔思伯',brandText:'JONSBO',defaultTheme:'light',brandLogo:{src:'/assets/jonsbo-logo-black.png',crop:[59,96,1921,643]}}
];

export const shopById=id=>shops.find(shop=>shop.id===id)||shops[0];
export const shopIdFromName=name=>shops.find(shop=>shop.name===name)?.id||SHOP_IDS.intel;

export function shopPalette(shopId,theme='light'){
 if(shopId===SHOP_IDS.gigabyte)return theme==='dark'?{bg:'#1e1f21',text:'#f5f5f5',accent:'#ff6400',line:'#55575a',muted:'#c1c3c6',panel:'#343638'}:{bg:'#ffffff',text:'#191a20',accent:'#008d96',line:'#d8e1e3',muted:'#68777a',panel:'#eef5f6'};
 if(shopId===SHOP_IDS.jonsbo)return theme==='dark'?{bg:'#222326',text:'#f4f4f2',accent:'#d7d8da',line:'#5a5c61',muted:'#c0c1c4',panel:'#3a3c40'}:{bg:'#ffffff',text:'#202124',accent:'#4a4d52',line:'#d4d5d7',muted:'#72757a',panel:'#eff0f1'};
 return theme==='dark'?{bg:'#102d50',text:'#f0f6fd',accent:'#8fd2ff',line:'#3d6185',muted:'#b7cbe1',panel:'#244c73'}:{bg:'#ffffff',text:'#132b50',accent:'#0070dc',line:'#deebf7',muted:'#6b85a3',panel:'#eff6fd'};
}

export const shopUpgradeColor=(shopId,theme,palette=shopPalette(shopId,theme))=>shopId===SHOP_IDS.gigabyte?(theme==='dark'?'#ff6400':'#ff32af'):shopId===SHOP_IDS.jonsbo?(theme==='dark'?'#ffce88':'#97531b'):palette.accent;


export const shopAddonColors=(shopId,theme)=>theme==='dark'?(shopId===SHOP_IDS.intel?{bg:'#204467',text:'#f0f6fd',muted:'#b7cbe1',title:'#8fd2ff'}:shopId===SHOP_IDS.gigabyte?{bg:'#3d3f42',text:'#f5f5f5',muted:'#c8cacc',title:'#ff6400'}:{bg:'#4a4c51',text:'#ffffff',muted:'#d8d9db',title:'#ffce88'}):shopId===SHOP_IDS.gigabyte?{bg:'#e5f3f4',text:'#243235',muted:'#64777a',title:'#ff32af'}:shopId===SHOP_IDS.jonsbo?{bg:'#e4e6e8',text:'#25272a',muted:'#5c6065',title:'#97531b'}:null;

export const shopPosterOuterColor=(shopId,theme)=>theme!=='dark'?'#e7ecef':shopId===SHOP_IDS.gigabyte?'#dcdfe2':shopId===SHOP_IDS.jonsbo?'#dedfe1':'#dce6f0';

const oldDarkPalettes={
 intel:{bg:'#07172e',text:'#eef5ff',accent:'#57bdff',line:'#213a59',muted:'#a3b7d0',panel:'#0e2643'},
 gigabyte:{bg:'#101010',text:'#ffffff',accent:'#ff7900',line:'#353535',muted:'#b8b8b8',panel:'#1d1d1d'},
 jonsbo:{bg:'#101c24',text:'#edf5f7',accent:'#b0c9df',line:'#344651',muted:'#a6b5c3',panel:'#1c2b37'}
};
const paletteMatches=(palette,candidate)=>palette&&Object.keys(candidate).every(key=>palette[key]?.toLowerCase()===candidate[key]);

const previousCardPalettes={
 gigabyte:{light:{bg:'#fdfbf8',text:'#1e1d24',accent:'#d64825',line:'#eee0d6',muted:'#7c6d63',panel:'#fcf3ed'},dark:{bg:'#292b31',text:'#f8f5f1',accent:'#ffbb80',line:'#5c5c62',muted:'#c9c2bb',panel:'#45464d'}},
 jonsbo:{light:{bg:'#f2f5f9',text:'#253b50',accent:'#3b6180',line:'#c5d2de',muted:'#566a7d',panel:'#e5ecf3'},dark:{bg:'#1c1d20',text:'#f1f0ed',accent:'#c9b990',line:'#505155',muted:'#aaa9a6',panel:'#34363a'}}
};
function refreshCardPalette(config){
 const previous=previousCardPalettes[config.shopId];if(!previous)return;
 const theme=config.theme==='dark'?'dark':'light',old=previous[theme];
 if(paletteMatches(config.palette,old)){
  config.palette=shopPalette(config.shopId,theme);
  if(!config.upgradeColor||[old.accent,'#a64116'].includes(config.upgradeColor.toLowerCase()))config.upgradeColor=shopUpgradeColor(config.shopId,theme);
  for(const m of config.modules||[])if(m.type==='service'){
   const oldBackground=config.shopId==='gigabyte'?(theme==='dark'?'#65422e':'#3a3c40'):(theme==='dark'?'#414145':'#3b5870');
   if(!m.background||m.background.toLowerCase()===oldBackground){m.background=shopServiceColor(config.shopId,theme);if(!m.color||['#ffffff','#ffa45c'].includes(m.color.toLowerCase()))m.color=shopServiceTextColor(config.shopId,theme);}
  }
 }
 for(const mode of ['light','dark'])if(paletteMatches(config.themePalettes?.[mode],previous[mode]))config.themePalettes[mode]=shopPalette(config.shopId,mode);
}

// Upgrade only former built-in dark themes. User-authored palettes remain intact.
function refreshPreviousDarkPalette(config){
 const previous=oldDarkPalettes[config.shopId];if(!previous)return;
 const oldUpgrade={intel:'#57bdff',gigabyte:'#ff7900',jonsbo:'#ffd477'}[config.shopId];
 if(config.theme==='dark'&&paletteMatches(config.palette,previous)){
  config.palette=shopPalette(config.shopId,'dark');
  if(!config.upgradeColor||config.upgradeColor.toLowerCase()===oldUpgrade)config.upgradeColor=shopUpgradeColor(config.shopId,'dark');
  const oldService={intel:'#173e76',gigabyte:'#6b361b',jonsbo:'#2c4353'}[config.shopId];
  for(const module of config.modules||[])if(module.type==='service'&&(!module.background||module.background.toLowerCase()===oldService)){module.background=shopServiceColor(config.shopId,'dark');module.color=shopServiceTextColor(config.shopId,'dark');}
 }
 if(paletteMatches(config.themePalettes?.dark,previous))config.themePalettes.dark=shopPalette(config.shopId,'dark');
}

// Replace only the former built-in palettes; keep user-authored color schemes intact.
function refreshJonsboPalette(config){
 if(config.shopId!==SHOP_IDS.jonsbo)return;
 const legacy={dark:{bg:'#101010',text:'#ffffff',accent:'#ffffff',line:'#353535',muted:'#b8b8b8',panel:'#1d1d1d'},light:{bg:'#ffffff',text:'#161616',accent:'#161616',line:'#d9d9d9',muted:'#707070',panel:'#f2f2f2'}};
 const previousBlue={dark:{bg:'#101c24',text:'#edf5f7',accent:'#68d5c5',line:'#354c59',muted:'#a5b8c2',panel:'#1b2d38'},light:{bg:'#f2f8fc',text:'#193b52',accent:'#086c9f',line:'#bfd8e9',muted:'#506e82',panel:'#e3f0f8'}};
 const previousLight={bg:'#f3f7f6',text:'#20383e',accent:'#14746a',line:'#c4d8d5',muted:'#526c69',panel:'#e3eeed'};
 const matches=(palette,theme)=>palette&&Object.keys(palette).length===6&&[legacy[theme],previousBlue[theme],...(theme==='light'?[previousLight]:[])].some(candidate=>Object.entries(candidate).every(([key,value])=>palette[key]?.toLowerCase()===value));
 const theme=config.theme==='light'?'light':'dark';
 if(config.upgradeColor?.toLowerCase()===(theme==='dark'?'#e7b681':'#995b2c'))config.upgradeColor=shopUpgradeColor(config.shopId,theme);
 if(matches(config.palette,theme)){
  config.palette=shopPalette(config.shopId,theme);
  if(!config.upgradeColor||[legacy[theme].accent,'#d0d0d0'].includes(config.upgradeColor.toLowerCase()))config.upgradeColor=shopUpgradeColor(config.shopId,theme);
  for(const module of config.modules||[])if(module.type==='service'&&(!module.background||['#1d1d1d','#f2f2f2','#246a64','#245d63','#086c9f'].includes(module.background.toLowerCase())))module.background=shopServiceColor(config.shopId,theme);
 }
 for(const theme of ['dark','light'])if(matches(config.themePalettes?.[theme],theme))config.themePalettes[theme]=shopPalette(config.shopId,theme);
}

export function switchShopTheme(config,theme){
 if(!['light','dark'].includes(theme))throw Error('未知图片主题');
 const previous=config.theme||shopById(config.shopId).defaultTheme;
 config.themePalettes??={};
 config.themePalettes[previous]=clone(config.palette||shopPalette(config.shopId,previous));
 config.theme=theme;config.palette=clone(config.themePalettes[theme]||shopPalette(config.shopId,theme));config.upgradeColor=shopUpgradeColor(config.shopId,theme,config.palette);
 for(const module of config.modules||[])if(module.type==='service'){module.background=shopServiceColor(config.shopId,theme);module.color=shopServiceTextColor(config.shopId,theme);}
 return config;
}

export function applyPosterTheme(configs,theme){
 if(!['light','dark'].includes(theme))return [];
 const ids=[];
 for(const config of configs){if(config.deletedAt||config.theme===theme)continue;switchShopTheme(config,theme);ids.push(config.id);}
 return ids;
}

export function applyShopIdentity(config,shopId,{resetAppearance=false}={}){
 const shop=shopById(shopId);config.shopId=shop.id;config.shop=shop.name;config.brandText=shop.brandText;
 if(resetAppearance){
  config.theme=shop.defaultTheme;config.palette=shopPalette(shop.id,config.theme);
  config.upgradeColor=shopUpgradeColor(shop.id,config.theme);config.textStyles={};config.themePalettes={};
  for(const module of config.modules||[]){module.color='';if(module.type==='service'){module.background=shopServiceColor(shop.id,config.theme);module.color=shopServiceTextColor(shop.id,config.theme);}}
 }
 return config;
}

// ERP internal shop IDs confirmed by the user on 2026-09-21.
export const DEFAULT_ERP_SHOP_IDS={intel:'76',gigabyte:'32',jonsbo:'33'};
function normalizeShopSettings(value){
 const legacyCoupon=Number(value?.coupon);
 const result={};for(const shop of shops){const entry=value?.[shop.id];result[shop.id]={coupon:Number.isFinite(Number(entry?.coupon))&&Number(entry.coupon)>=0?Number(entry.coupon):shop.id===SHOP_IDS.intel&&Number.isFinite(legacyCoupon)&&legacyCoupon>=0?legacyCoupon:0};if(["light","dark"].includes(entry?.posterTheme))result[shop.id].posterTheme=entry.posterTheme;const view=normalizePosterView(entry?.posterView);if(view)result[shop.id].posterView=view;if(typeof entry?.serviceText==='string')result[shop.id].serviceText=entry.serviceText;for(const key of ['erpShopId','erpShopName'])if(typeof entry?.[key]==='string')result[shop.id][key]=entry[key];}
 return result;
}

function normalizeSources(rows){
 const original=clone(rows||[]);
 if(!original.length)return original;
 if(original.every(row=>row.shopId))return original;
 const intel=original.map((row,index)=>({...row,sourceId:row.sourceId||`catalog-${index}`,shopId:SHOP_IDS.intel,originalName:row.originalName||row.name,addonText:row.addonText||'',addonNote:row.addonNote||''}));
 const clones=shops.filter(shop=>shop.id!==SHOP_IDS.intel).flatMap(shop=>intel.map(row=>({...clone(row),sourceId:`${shop.id}:${row.sourceId}`,shopId:shop.id})));
 return [...intel,...clones];
}

export function normalizeWorkspaceState(input,baseCatalog=[]){
 const state=clone(input),previousVersion=Number(state.dataVersion||1);state.dataVersion=3;state.shops=clone(shops);state.shopSettings=normalizeShopSettings(state.shopSettings);
 state.configs=restoreConfigOrder(state.configs||[]);for(const config of state.configs){const shopId=config.shopId||shopIdFromName(config.shop);applyShopIdentity(config,shopId);if(previousVersion<3&&[SHOP_IDS.gigabyte,SHOP_IDS.jonsbo].includes(shopId))applyShopIdentity(config,shopId,{resetAppearance:true});refreshPreviousDarkPalette(config);refreshJonsboPalette(config);refreshCardPalette(config);normalizePosterDesign(config);}
 state.templates??=[];for(const template of state.templates){template.shopId??=template.configs?.[0]?.shopId||template.config?.shopId||SHOP_IDS.intel;}
 state.sourceCatalog=normalizeSources(state.sourceCatalog?.length?state.sourceCatalog:baseCatalog).map(normalizeSpecialComponent);
 for(const c of [...state.configs,...state.templates.flatMap(t=>t.configs||[t.config].filter(Boolean))]){c.parts=(c.parts||[]).map(normalizeSpecialComponent);c.actualParts=ensureActualParts(c).map(normalizeSpecialComponent);}
 const erpNames=new Map((state.costSource||[]).map(r=>[r.goodsId,r.name]));for(const row of state.sourceCatalog)if(erpNames.has(row.goodsId))row.erpName=erpNames.get(row.goodsId);
 state.caseGallery=normalizeGallery(state.caseGallery,state.configs,state.templates);
 return state;
}

export const settingsFor=(state,shopId)=>state.shopSettings?.[shopId]||{coupon:0};
export const sourcesFor=(state,shopId)=>preferredSourceRows(selectableComponents(withSpecialPresets(state.sourceCatalog.filter(row=>row.shopId===shopId),shopId),state.costSource||[]),state.costSource||[]);
