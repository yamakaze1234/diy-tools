// Shared service-strip defaults for new configurations, theme switching and rendering.
export const shopServiceColor=(shopId,theme)=>shopId==='jonsbo'?(theme==='dark'?'#2c4353':'#3b5870'):shopId==='gigabyte'?(theme==='dark'?'#6b361b':'#3a3c40'):'#173e76';
export const shopServiceTextColor=(shopId,theme)=>shopId==='gigabyte'?(theme==='dark'?'#fff1e5':'#ffa45c'):'#ffffff';
