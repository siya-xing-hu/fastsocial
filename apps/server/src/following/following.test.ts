import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { openDatabase } from '../db/database.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { FollowingRepository } from './repository.ts';
import { FollowingService } from './service.ts';
import { registerFollowingRoutes } from './routes.ts';
import type { OutreachIdentity } from '../outreach/types.ts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';

function fixture(failSummary = false) {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const a=settings.configuration.saveAccount({name:'EN',username:'actor_a',cookie:'auth_token=a; ct0=a; twid=u%3D1'});
  const b=settings.configuration.saveAccount({name:'CN',username:'actor_b',cookie:'auth_token=b; ct0=b; twid=u%3D2'});
  const state=new Map<string,boolean>(), calls:string[]=[];
  let failFollow=false;
  const x={identity:(id:string)=>({cookieId:id,actorId:settings.configuration.accounts().find(a=>a.id===id)!.actorId}),
    async profile(identity:OutreachIdentity,username:string,expected?:string){assert.ok(!expected || expected==='9');return {account:{id:'9',username:username.replace(/^@/,''),name:'Target',bio:'Builds tools',fetchedAt:new Date().toISOString()},following:state.get(identity.actorId)??false,followedBy:false};},
    async follow(identity:OutreachIdentity){calls.push('follow:'+identity.actorId);state.set(identity.actorId,true);if(failFollow)throw new Error('connection lost');return {following:true,followedBy:false};},
    async unfollow(identity:OutreachIdentity){calls.push('unfollow:'+identity.actorId);state.set(identity.actorId,false);return {following:false,followedBy:false};},
  };
  const repo=new FollowingRepository(db), service=new FollowingService(repo,settings,x,async()=>{if(failSummary)throw new Error('AI unavailable');return { summary: '主题：开源工具\n近况：发布了新的效率工具', summaryEvidence: [] };});
  return {db,settings,a,b,state,calls,x,repo,service,fail:()=>{failFollow=true;}};
}
test('a deferred portrait does not overwrite a manual update completed before the workflow finishes', async () => {
  const f = fixture();
  try {
    await f.service.deferPortraits(async () => {
      await f.service.follow(f.x.identity(f.a.id), '9', 'target');
      const entry = f.service.list(f.a.id)[0]!;
      assert.equal(entry.summaryStatus, 'pending');
      f.repo.save({ ...entry, summaryStatus: 'done', summary: '手动更新的画像' });
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.service.list(f.a.id)[0]?.summary, '手动更新的画像');
  } finally { await f.service.stop(); f.db.close(); }
});
test('manual and workflow follows are deduplicated per actor; search and unfollow stay in the selected account',async()=>{
  const f=fixture();
  try {
    await Promise.all([f.service.add(f.a.id,'target'),f.service.add(f.a.id,'target')]);
    await f.service.follow(f.x.identity(f.b.id),'9','target');
    assert.deepEqual(f.calls,['follow:1','follow:2']);
    const one=f.service.list(f.a.id)[0]!,two=f.service.list(f.b.id)[0]!;
    assert.notEqual(one.id,two.id);assert.equal(f.service.list(f.a.id).length,1);
    await assert.rejects(f.service.unfollow(f.b.id,one.id),/当前账号/);
    await f.service.unfollow(f.a.id,one.id);
    assert.equal(f.service.list(f.a.id)[0]?.status,'not_following');assert.equal(f.service.list(f.b.id)[0]?.status,'following');
    await f.service.unfollow(f.a.id,one.id);assert.equal(f.calls.filter(c=>c==='unfollow:1').length,1);
    // Wait for the serial portrait queue without starting any new work.
    for(let i=0;i<30 && f.service.list(f.b.id)[0]?.summaryStatus!=='done';i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.service.list(f.b.id,'开源')[0]?.id,two.id);assert.deepEqual(f.service.list(f.a.id,'absent'),[]);
    assert.equal(f.service.list(f.a.id)[0]?.status,'not_following');
  }finally{await f.service.stop();f.db.close();}
});
test('a portrait failure preserves confirmed follows; an uncertain mutation is resolved by reading, never resent',async()=>{
  const f=fixture(true);
  try {
    f.fail();await assert.rejects(f.service.add(f.a.id,'target'),/connection lost/);
    const uncertain=f.service.list(f.a.id)[0]!;assert.equal(uncertain.status,'uncertain');
    const confirmed=await f.service.refresh(f.a.id,uncertain.id);assert.equal(confirmed.status,'following');
    f.service.enqueue(f.a.id,confirmed.id);
    for(let i=0;i<30 && f.service.list(f.a.id)[0]?.summaryStatus!=='failed';i++)await new Promise(resolve=>setImmediate(resolve));
    const after=f.service.list(f.a.id)[0]!;assert.equal(after.status,'following');assert.equal(after.summaryStatus,'failed');assert.match(after.summaryError!,/AI unavailable/);
    assert.deepEqual(f.calls,['follow:1']);
    const other=await f.service.add(f.a.id,'target');assert.equal(other.id,confirmed.id);assert.deepEqual(f.calls,['follow:1']);
  }finally{await f.service.stop();f.db.close();}
});
test('following endpoints isolate accounts, validate usernames and expose no cookies',async()=>{
  const f=fixture(),app=Fastify();registerFollowingRoutes(app,f.service);
  try {
    assert.equal((await app.inject({method:'POST',url:`/api/accounts/${f.a.id}/following`,payload:{username:'invalid/name'}})).statusCode,500);
    const added=await app.inject({method:'POST',url:`/api/accounts/${f.a.id}/following`,payload:{username:'target'}});
    assert.equal(added.statusCode,200);assert.ok(!added.body.includes('auth_token'));
    assert.equal((await app.inject(`/api/accounts/${f.b.id}/following`)).json().data.length,0);
    const before=f.calls.length;
    assert.equal((await app.inject({method:'POST',url:`/api/accounts/${f.b.id}/following/${added.json().data.id}/unfollow`})).statusCode,500);
    assert.equal(f.calls.length,before);
  }finally{await app.close();await f.service.stop();f.db.close();}
});
test('history is imported once and interrupted writes recover as uncertain without losing summaries',()=>{
  const f=fixture();
  try {
    f.db.prepare("DELETE FROM settings WHERE key='following_history_v1'").run();
    f.db.prepare('INSERT INTO workflows VALUES (?,?)').run('w',JSON.stringify({id:'w'}));
    f.db.prepare('INSERT INTO workflow_records VALUES (?,?,?)').run('r','w',JSON.stringify({id:'r',accountId:f.a.id,createdAt:'2026-01-01',post:{author:'target'},actions:[{type:'follow',status:'done',result:'已关注'}]}));
    const repo=new FollowingRepository(f.db),row=repo.list('1')[0]!;
    assert.equal(row.source,'history');assert.equal(row.status,'uncertain');assert.equal(row.user.id,'');
    repo.save({...row,status:'pending',summary:'保留画像',summaryStatus:'running'});
    const restarted=new FollowingRepository(f.db);assert.equal(restarted.list('1').length,1);
    assert.equal(restarted.list('1')[0]?.status,'uncertain');assert.equal(restarted.list('1')[0]?.summary,'保留画像');assert.equal(restarted.list('1')[0]?.summaryStatus,'pending');
  }finally{f.db.close();}
});
test('a reassigned username cannot overwrite a different target identity',()=>{
  const f=fixture();
  try {
    const user={id:'9',username:'target',name:'Original',bio:'',fetchedAt:''};
    const first=f.repo.create('1',user,'manual');f.repo.save(first);
    assert.equal(f.repo.find('1',{id:'10',username:'target'}),undefined);
    const second=f.repo.create('1',{...user,id:'10'},'manual');f.repo.save(second);
    assert.equal(f.repo.list('1').length,2);assert.equal(f.repo.find('1',{id:'9',username:'newhandle'})?.id,first.id);
  } finally {f.db.close();}
});

test('automatic follow skips existing relations and manual opt-outs across restarts, with actor isolation', async () => {
  const f = fixture();
  try {
    const user = (await f.x.profile(f.x.identity(f.a.id), 'target')).account;
    f.repo.save({ ...f.repo.create('1', user, 'manual'), status: 'not_following' });
    const restarted = new FollowingRepository(f.db);
    const service = new FollowingService(restarted, f.settings, f.x, async () => ({ summary: 'summary', summaryEvidence: [] }));
    const original = f.x.profile;
    let reads = 0;
    f.x.profile = async (...args) => { reads++; return original(...args); };
    try {
      const skipped = await service.follow(f.x.identity(f.a.id), '9', 'target');
      assert.equal(skipped.created, false); assert.match(skipped.skipReason!, /已取消关注/);
      assert.equal(reads, 0); assert.deepEqual(f.calls, []);
      const [first, second] = await Promise.all([
        service.follow(f.x.identity(f.b.id), '9', 'target'), service.follow(f.x.identity(f.b.id), '9', 'target'),
      ]);
      assert.equal(first.created, true); assert.equal(second.created, false);
      assert.deepEqual(f.calls, ['follow:2']);
      // Only an explicit manual add can override the opt-out.
      await service.add(f.a.id, 'target');
      assert.equal(service.list(f.a.id)[0]?.status, 'following');
      assert.deepEqual(f.calls, ['follow:2', 'follow:1']);
    } finally { await service.stop(); }
  } finally { await f.service.stop(); f.db.close(); }
});

test('a fresh Profile catches an untracked existing follow without a write or portrait request', async () => {
  const f = fixture(); f.state.set('1', true);
  try {
    const result = await f.service.follow(f.x.identity(f.a.id), '9', 'target');
    assert.equal(result.created, false); assert.equal(result.following, true);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.service.list(f.a.id), []);
  } finally { await f.service.stop(); f.db.close(); }
});

test('an unsent quota-limited first follow cannot create a false manual opt-out', async () => {
  const f = fixture(), original = f.x.follow;
  f.x.follow = async () => { throw new AccountRequestLimitError('test', 'follow', 1, 1, '2099-01-01'); };
  try {
    await assert.rejects(f.service.follow(f.x.identity(f.a.id), '9', 'target'), AccountRequestLimitError);
    assert.deepEqual(f.service.list(f.a.id), []);
    f.x.follow = original;
    assert.equal((await f.service.follow(f.x.identity(f.a.id), '9', 'target')).created, true);
    assert.deepEqual(f.calls, ['follow:1']);
  } finally { await f.service.stop(); f.db.close(); }
});


test('manual following portrait saves are local, actor-scoped and preserve sources without a length cap', async () => {
  const f = fixture(), app = Fastify(); registerFollowingRoutes(app, f.service);
  try {
    const user = (await f.x.profile(f.x.identity(f.a.id), 'target')).account;
    const evidence = [{id: '100', platform: 'x' as const, author: 'target', text: 'Source post', type: 'post' as const, createdAt: '2026-10-13T00:00:00Z', url: 'https://x.com/target/status/100'}];
    const row = f.repo.save({...f.repo.create('1', user, 'manual'), summaryStatus: 'done', summary: 'Old portrait', summaryEvidence: evidence});
    f.x.profile = async () => { throw new Error('Must not fetch profile for a local edit'); };
    const text = Array.from({length: 8}, (_, i) => `第 ${i} 段：${'开发工具。'.repeat(20)}`).join('\n\n');
    const url = `/api/accounts/${f.a.id}/following/${row.id}/summary`;
    assert.equal((await app.inject({method: 'PUT', url, payload: {text: 123}})).statusCode, 500);
    assert.equal((await app.inject({method: 'PUT', url: `/api/accounts/${f.b.id}/following/${row.id}/summary`, payload: {text}})).statusCode, 500);
    const saved = await app.inject({method: 'PUT', url, payload: {text}});
    assert.equal(saved.statusCode, 200); assert.equal(saved.json().data.summary, text);
    assert.deepEqual(saved.json().data.summaryEvidence, evidence);
    assert.equal(new FollowingRepository(f.db).get('1', row.id)?.summary, text);
    const cleared = f.service.editSummary(f.a.id, row.id, '');
    assert.equal(cleared.summary, ''); assert.deepEqual(cleared.summaryEvidence, evidence);
    for (const status of ['pending', 'running'] as const) {
      f.repo.save({...cleared, summaryStatus: status});
      assert.throws(() => f.service.editSummary(f.a.id, row.id, text), /正在更新/);
      assert.equal(f.repo.get('1', row.id)?.summary, '');
    }
    assert.deepEqual(f.calls, []);
  } finally { await app.close(); await f.service.stop(); f.db.close(); }
});

test('following AI portraits persist cited posts and a failed refresh retains both text and evidence', async () => {
  const f = fixture();
  let fail = false;
  const evidence = [{id: '100', platform: 'x' as const, author: 'target', text: 'Source', type: 'post' as const, createdAt: '', url: 'https://x.com/target/status/100'}];
  const service = new FollowingService(f.repo, f.settings, f.x, async () => {
    if (fail) throw new Error('AI unavailable');
    return {summary: '长画像'.repeat(200), summaryEvidence: evidence};
  });
  try {
    const entry = await service.add(f.a.id, 'target');
    for (let i = 0; i < 30 && service.list(f.a.id)[0]?.summaryStatus !== 'done'; i++) await new Promise(resolve => setImmediate(resolve));
    const saved = service.list(f.a.id)[0]!;
    assert.equal(saved.summary, '长画像'.repeat(200)); assert.deepEqual(saved.summaryEvidence, evidence);
    fail = true; service.enqueue(f.a.id, entry.id, {manual: true});
    for (let i = 0; i < 30 && service.list(f.a.id)[0]?.summaryStatus !== 'failed'; i++) await new Promise(resolve => setImmediate(resolve));
    const after = service.list(f.a.id)[0]!;
    assert.equal(after.summaryStatus, 'failed'); assert.equal(after.summary, saved.summary); assert.deepEqual(after.summaryEvidence, evidence);
  } finally { await service.stop(); await f.service.stop(); f.db.close(); }
});
