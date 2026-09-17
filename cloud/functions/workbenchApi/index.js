'use strict';
// accessToken is an explicit transport field, never an identity supplied by the caller.
// PostgreSQL validates the token and derives auth.uid(); no admin key is used.
exports.main = async function(event) {
  const requestId = typeof event?.requestId === 'string' ? event.requestId.slice(0,100) : undefined;
  if (!event || typeof event.accessToken !== 'string' || !event.accessToken || event.accessToken.length>16000) return {ok:false,code:'UNAUTHENTICATED',message:'请登录成员账号',requestId};
  const envId=process.env.WORKBENCH_ENV_ID;
  if (!envId || !/^[a-z0-9-]+$/.test(envId)) return {ok:false,code:'SERVER_CONFIG',message:'云端环境未配置',requestId};
  const request={protocolVersion:event.protocolVersion,action:event.action,requestId,payload:event.payload||{}};
  if (JSON.stringify(request).length>600000) return {ok:false,code:'TOO_LARGE',message:'单条记录过大',requestId};
  try {
    const response=await fetch(`https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/${event.protocolVersion===2?'wa_api':'wb_api'}`,{
      method:'POST',headers:{Authorization:`Bearer ${event.accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({request}),signal:AbortSignal.timeout(15000)
    });
    if(!response.ok) return {ok:false,code:response.status===401?'UNAUTHENTICATED':response.status===403?'FORBIDDEN':'DATABASE_UNAVAILABLE',message:'云端数据库请求失败',requestId};
    return await response.json();
  } catch { return {ok:false,code:'RETRYABLE',message:'暂时无法确认提交结果，请使用原提交 ID 重试',requestId}; }
};
