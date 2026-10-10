import test from 'node:test';
import assert from 'node:assert/strict';
import { reauthenticateCurrentOwner, type ReauthenticationIdentity, type ReauthenticationPort } from '../src/domain/ownerReauthentication';
function fixture() {
  let identity:ReauthenticationIdentity|null={uid:'owner',email:'owner@example.test',emailVerified:true,providers:['password','google.com']};
  const calls:string[]=[],port:ReauthenticationPort={currentIdentity:()=>identity,password:async(uid,email,secret)=>{assert.equal(uid,'owner');assert.equal(email,'owner@example.test');assert.equal(secret,'transient-secret');calls.push('password');},google:async()=>{calls.push('google');},refreshToken:async()=>{calls.push('token');}};
  return {port,calls,set:(value:ReauthenticationIdentity|null)=>{identity=value;}};
}
test('C1.2 reauthentication proves the current linked identity before refreshing the token; unsupported and unverified identities cannot authenticate',async()=>{
  for(const method of ['password','google.com'] as const){const f=fixture();await reauthenticateCurrentOwner(f.port,'owner',method,'transient-secret');assert.deepEqual(f.calls,[method==='password'?'password':'google','token']);}
  for(const identity of [null,{uid:'other',email:'owner@example.test',emailVerified:true,providers:['password']},{uid:'owner',email:'owner@example.test',emailVerified:false,providers:['password']},{uid:'owner',email:'owner@example.test',emailVerified:true,providers:['phone']}]){const f=fixture();f.set(identity);await assert.rejects(reauthenticateCurrentOwner(f.port,'owner','password','transient-secret'));assert.deepEqual(f.calls,[]);}
  const f=fixture();await assert.rejects(reauthenticateCurrentOwner(f.port,'owner','password',''));assert.deepEqual(f.calls,[]);
});
test('C1.2 failed proof or identity changes during authentication/token refresh prevent the protected callback and token refresh cannot substitute for proof',async()=>{
  const f=fixture();f.port.google=async()=>{throw new Error('provider rejected');};await assert.rejects(reauthenticateCurrentOwner(f.port,'owner','google.com'));assert.deepEqual(f.calls,[]);
  for(const phase of ['auth','token']){const f=fixture(),other={uid:'other',email:'other@example.test',emailVerified:true,providers:['google.com']};f.port.google=async()=>{f.calls.push('google');if(phase==='auth')f.set(other);};f.port.refreshToken=async()=>{f.calls.push('token');f.set(other);};let protectedOperation=false;await assert.rejects(reauthenticateCurrentOwner(f.port,'owner','google.com').then(()=>{protectedOperation=true;}),/تغير الحساب/);assert.equal(protectedOperation,false);assert.deepEqual(f.calls,phase==='auth'?['google']:['google','token']);}
});
