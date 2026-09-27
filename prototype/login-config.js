export function validateLoginConfig(config){
 if(!config||['envId','region','accessKey','functionName'].some(key=>typeof config[key]!=='string'||!config[key].trim()||/your[-_]|placeholder|<set_/i.test(config[key]))||config.functionName!=='workbenchApi')throw Error('登录配置缺失或仍为示例配置，请使用已配置正式登录的程序包');
 return config;
}
export function loginErrorMessage(error){return /failed to fetch|networkerror|load failed/i.test(error?.message||'')?'无法连接登录服务，请检查网络或代理后重试；若持续失败，请核对程序的登录配置。':error?.message||'登录失败，请重试';}
