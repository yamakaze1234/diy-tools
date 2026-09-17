export function cloudTransport(config, getToken, fetchImpl=(...args)=>fetch(...args)) {
  if(!/^[a-z0-9-]+$/.test(config.envId)||config.functionName!=='workbenchApi')throw Error('云端配置无效');
  return async request=>{
    const accessToken=getToken();if(!accessToken)throw Error('请先登录成员账号');
    const response=await fetchImpl(`https://${config.envId}.api.tcloudbasegateway.com/v1/functions/${config.functionName}`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},
      body:JSON.stringify({...request,accessToken}),signal:AbortSignal.timeout(30000)
    });
    const result=await response.json();
    if(!response.ok){const error=Error(response.status===401?'登录已过期，请重新登录':`云端请求失败（${response.status}，${result.code||'NETWORK'}）`);error.code=response.status===401?'UNAUTHENTICATED':result.code;throw error;}
    if(result.code==='UNAUTHENTICATED'){const error=Error('登录已过期，请重新登录');error.code=result.code;throw error;}
    return result;
  };
}
