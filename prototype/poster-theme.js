// Shared service-strip defaults for new configurations, theme switching and rendering.
export const shopServiceColor=(shopId,theme)=>shopId==='jonsbo'?(theme==='dark'?'#484a50':'#35383d'):shopId==='gigabyte'?(theme==='dark'?'#2b2d30':'#383a3e'):theme==='dark'?'#194779':'#173e76';
export const shopServiceTextColor=(shopId,theme)=>shopId==='gigabyte'?'#ff6400':'#ffffff';
