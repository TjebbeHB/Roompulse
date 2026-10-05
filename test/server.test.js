import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

async function fixture(t, options = {}) {
  const instance = createApp({ dataFile: ':memory:', ...options });
  const server = instance.app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { instance.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  async function call(path, { method = 'GET', data, admin, participant, host = false, headers = {} } = {}) {
    const res = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(admin ? {'x-admin-key':admin} : {}),...(participant ? {'x-participant-id':participant} : {}),...(host ? {'x-host-key':instance.hostKey} : {}),...headers},...(data ? {body:JSON.stringify(data)} : {})});
    return { status:res.status, body:res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  }
  const created = await call('/api/host/sessions',{method:'POST',host:true,data:{title:'Hub workshop'}});
  assert.equal(created.status,201);
  const { code, adminKey } = created.body;
  return {instance,base,call,code,adminKey,path:`/api/sessions/${code}`};
}

test('host/admin protection, private results, updates, pause and reveal',async t => {
  const {call,path,adminKey} = await fixture(t);
  assert.equal((await call('/api/host/sessions')).status,403);
  assert.equal((await call(path+'/questions',{method:'POST',data:{prompt:'Hello',type:'rating'}})).status,403);
  assert.equal((await call(path,{method:'PATCH',admin:'é'.repeat(48),data:{revealed:true}})).status,403);
  assert.equal((await call(path+'/questions',{method:'POST',admin:adminKey,data:{prompt:'We should collaborate more.',type:'rating'}})).status,200);
  let s = (await call(path,{admin:adminKey})).body;
  const id = s.questions[0].id;
  assert.equal((await call(path,{method:'PATCH',admin:adminKey,data:{activeId:id}})).status,200);
  const submit = answer => call(path+'/responses',{method:'POST',participant:'a'.repeat(48),data:{questionId:id,answer}});
  assert.equal((await submit(0)).status,400);
  assert.equal((await submit(5)).status,200);
  assert.equal((await submit(3)).status,200);
  s = (await call(path)).body;
  assert.equal(s.results,null); assert.equal(s.questions,undefined); assert.equal(s.admin_key,undefined); assert.equal(s.myAnswer,null);
  assert.equal((await call(path,{participant:'a'.repeat(48)})).body.myAnswer,3);
  s = (await call(path,{admin:adminKey})).body;
  assert.equal(s.results.count,1); assert.equal(s.results.average,3); assert.equal(s.participants,1);
  await call(path,{method:'PATCH',admin:adminKey,data:{revealed:true,accepting:false}});
  assert.equal((await call(path)).body.results.average,3);
  assert.equal((await submit(4)).status,409);
  assert.equal((await call(path+'/export')).status,403);
  assert.match((await call(path+'/export',{admin:adminKey})).body,/We should collaborate more/);
});

test('question types, stale answers, safe CSV, QR and browser origin checks',async t => {
  const {call,path,adminKey} = await fixture(t);
  assert.equal((await call(path+'/questions',{method:'POST',admin:adminKey,data:{prompt:'Pick',type:'choice',options:['A','A']}})).status,400);
  for (const q of [{prompt:'Pick one',type:'choice',options:['A','B']},{prompt:'Ideas?',type:'text'}]) assert.equal((await call(path+'/questions',{method:'POST',admin:adminKey,data:q})).status,200);
  const [choice,text] = (await call(path,{admin:adminKey})).body.questions;
  await call(path,{method:'PATCH',admin:adminKey,data:{activeId:choice.id}});
  assert.equal((await call(path+'/responses',{method:'POST',participant:'b'.repeat(48),data:{questionId:choice.id,answer:2}})).status,400);
  assert.equal((await call(path+'/responses',{method:'POST',participant:'b'.repeat(48),data:{questionId:choice.id,answer:0}})).status,200);
  await call(path,{method:'PATCH',admin:adminKey,data:{revealed:true}});
  assert.deepEqual((await call(path)).body.results.counts,[1,0]);
  await call(path,{method:'PATCH',admin:adminKey,data:{activeId:text.id}});
  assert.equal((await call(path)).body.revealed,false);
  assert.equal((await call(path+'/responses',{method:'POST',participant:'b'.repeat(48),data:{questionId:choice.id,answer:0}})).status,409);
  const value = '=HYPERLINK("https://example.com")';
  await call(path+'/responses',{method:'POST',participant:'b'.repeat(48),data:{questionId:text.id,answer:value}});
  assert.deepEqual((await call(path,{admin:adminKey})).body.results.ideas,[value]);
  assert.match((await call(path+'/export',{admin:adminKey})).body,/"'=HYPERLINK/);
  assert.equal((await call(path,{method:'PATCH',admin:adminKey,headers:{Origin:'https://elsewhere.example'},data:{accepting:false}})).status,403);
  assert.match((await call('/api/qr',{method:'POST',data:{value:'http://192.168.1.5:3000/join/ABCDEF'}})).body.image,/^data:image\/png;base64,/);
  assert.equal((await call('/api/sessions/ZZZZZZ')).status,404);
});

test('live events arrive and a burst of independent voters is counted once each',async t => {
  const {call,path,base,adminKey} = await fixture(t);
  await call(path+'/questions',{method:'POST',admin:adminKey,data:{prompt:'Ready?',type:'rating'}});
  const id = (await call(path,{admin:adminKey})).body.questions[0].id;
  await call(path,{method:'PATCH',admin:adminKey,data:{activeId:id}});
  const abort = new AbortController();
  const res = await fetch(base+path+'/events',{signal:abort.signal});
  const reader = res.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
  const responses = await Promise.all(Array.from({length:60},(_,i) => call(path+'/responses',{method:'POST',participant:i.toString(16).padStart(48,'0'),data:{questionId:id,answer:5}})));
  assert.ok(responses.every(r => r.status === 200));
  assert.match(new TextDecoder().decode((await reader.read()).value),/changed/);
  abort.abort();
  assert.equal((await call(path,{admin:adminKey})).body.results.count,60);
});

test('database retains sessions, credentials and answers across restart', async t => {
  const dir = mkdtempSync(join(tmpdir(),'roompulse-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const file = join(dir,'session.sqlite');
  const first = createApp({dataFile:file});
  first.db.prepare('INSERT INTO sessions(code,title,admin_key) VALUES(?,?,?)').run('ABCDEF','Persistent room','private-key');
  first.db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?)').run('q1','ABCDEF','Hello?','text','[]',0);
  first.db.prepare('INSERT INTO responses(question_id,participant,answer) VALUES(?,?,?)').run('q1','person','"Still here"');
  const key = first.hostKey; first.close();
  const second = createApp({dataFile:file});
  assert.equal(second.hostKey,key);
  assert.equal(second.db.prepare('SELECT title FROM sessions').get().title,'Persistent room');
  assert.equal(second.db.prepare('SELECT answer FROM responses').get().answer,'"Still here"');
  second.close();
});
