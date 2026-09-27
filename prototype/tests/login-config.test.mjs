import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLoginConfig,loginErrorMessage} from '../login-config.js';
const config={envId:'real-env',region:'ap-shanghai',functionName:'workbenchApi',accessKey:'public-key'};
test('占位登录配置在发网络请求前被拒绝',()=>{assert.equal(validateLoginConfig(config),config);for(const key of Object.keys(config))for(const value of ['',null,'your-cloudbase-value'])assert.throws(()=>validateLoginConfig({...config,[key]:value}),/登录配置/);});
test('Failed to fetch 明确说明登录服务连接问题，保留其他业务错误',()=>{assert.match(loginErrorMessage(Error('Failed to fetch')),/无法连接登录服务/);assert.equal(loginErrorMessage(Error('账号密码错误')),'账号密码错误');});
