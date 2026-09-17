// Visible values transcribed from the user's two-configuration screenshot.
export function screenshotBlock(index=0,format=3){
 const parts=[
  [index%2?'325766':'47538',1,'CPU',index%2?'英特尔 酷睿 Ultra 7 270K Plus 24核24线程':'英特尔 酷睿 I5 14600KF 14核20线程'],
  ['358678',1,'散热','乔思伯 TH-360 黑色 ARGB 数显屏幕 一体式水冷'],
  [index%2?'320988':'101771',1,'主板',index%2?'技嘉 Z890M FORCE DUO X WIFI7 战鹰':'技嘉 B760M AORUS ELITE WIFI6 小雕 DDR4'],
  [index%2?'387699':'419200',index%2?1:2,'内存',index%2?'威刚 威龙 D300 6000 高挑 黑色马甲镁光颗粒 24G':'金泰克 速虎 朱砂痣 黑色马甲3600 C18 三星颗粒16G'],
  ['97065',1,'硬盘','致态 Ti600 1T NVME PCIe4.0 7000MB/s'],
  ['0',1,'显卡',index%2?'全新 Intel ARC Xe 核显 支持8K 60HZ视频输出':'不含显卡，可咨询客服加装显卡使用'],
  [index%2?'93717':'95560',1,'电源',index%2?'技嘉 P750GS PG5 ATX3.1 额定750W 金牌':'技嘉 P650SS 电源 ATX3.1 额定650W 银牌'],
  ['397047',1,'机箱','乔思伯 X400CG 灰 曲面玻璃骨骼框架海景房'],
  null,['375659',11,'风扇','乔思伯 ZE 连体风扇 神光同步 无极点光影面 黑色'],
  ['44360',1,'风扇','定制电源延长模组线 黑色24+8'],
  ['0',1,'配件',''],['0',1,'配件','0'],['0',1,'配件',''],['0',1,'配件','0'],null,null
 ];
 const rows=[['EXCEL利润','ERP利润','','定价',''],[index%2?'46':'-30',index%2?'-35':'107','',index%2?'8099':'6499',''],...parts.map(p=>p?[p[0],String(p[1]),'',p[2],p[3]]:['','','','',''])];
 if(format===3)return rows.map(r=>[r[0],r[1],r[4]]);
 if(format===14)return rows.map((r,i)=>{const full=['','','',...r,'','','','','',''];if(i===0){full[0]='ERP总价';full[10]=`配置${index+1}`;full[11]='进阶版';}return full;});
 return rows;
}
export const screenshotText=(count=2,format=3)=>Array.from({length:count},(_,i)=>screenshotBlock(i,format)).flat().map(r=>r.join('\t')).join('\n');
