import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const stateCode = source.slice(source.indexOf('function taskItems()'), source.indexOf('var nav='));
const syncCode = source.slice(source.indexOf('var TASKFLIGHT='), source.indexOf('function roomPayload()'));

function setup() {
  const writes = [];
  const context = {
    ST: {
      chk: { bk_pass: true }, tasks: {}, taskPending: {}, room: 'trip123',
      members: ['Amy', 'Bo', 'Cy', 'Di', 'Ed'],
    },
    BOOK: [['10/13（二）', '買周遊券', '', 'pass']],
    CHECK: [['確認行李', '出發前確認']],
    FB_DB: 'https://example.firebaseio.com',
    save() {},
    mem(i) { return context.ST.members[i]; },
    fetch(url, options) {
      writes.push({ url, options });
      return Promise.resolve({ ok: true });
    },
  };
  vm.createContext(context);
  vm.runInContext('function fbReady(){return !!ST.room}\n' + stateCode + syncCode, context);
  return { context, writes };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('remote completion replaces an older local checkbox', () => {
  const { context } = setup();
  assert.equal(context.taskState('bk_pass').done, true);
  context.mergeTasks({ bk_pass: { done: false, owner: 1 } });
  assert.equal(context.taskState('bk_pass').done, false);
  assert.equal(context.taskState('bk_pass').owner, 1);
  assert.equal(context.ST.chk.bk_pass, false);
});

test('each change writes its own task and keeps a pending local edit', async () => {
  const { context, writes } = setup();
  context.ST.taskPending.bk_pass = true;
  context.ST.tasks.bk_pass = { done: true, owner: 2 };
  context.mergeTasks({ bk_pass: { done: false, owner: 1 } });
  assert.equal(context.taskState('bk_pass').owner, 2);
  context.flushTasks();
  await settle();
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /\/rooms\/trip123\/tasks\/bk_pass\.json$/);
  assert.equal(JSON.parse(writes[0].options.body).owner, 2);
  assert.equal(context.ST.taskPending.bk_pass, undefined);
});

test('failed offline write remains queued until the next sync', async () => {
  const { context, writes } = setup();
  context.fetch = () => Promise.reject(new Error('offline'));
  context.setTask('c0', { done: true, owner: 3 });
  await settle();
  assert.equal(context.ST.taskPending.c0, true);
  context.fetch = (url, options) => {
    writes.push({ url, options });
    return Promise.resolve({ ok: true });
  };
  context.flushTasks();
  await settle();
  assert.equal(context.ST.taskPending.c0, undefined);
  assert.equal(writes.length, 1);
});
