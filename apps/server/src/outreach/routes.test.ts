import { XRequestQueue } from '../adapters/x/request-queue.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { openDatabase } from '../db/database.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { DEFAULT_OUTREACH_CONFIG } from './repository.ts';

test('outreach account CRUD is isolated, validates identities, and never requests X for local management', async () => {
  const database = openDatabase(':memory:');
  let requests = 0;
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), database, fetchImpl: (async () => { requests += 1; throw new Error('Unexpected X request'); }) as typeof fetch });
  try {
    const get = await app.inject({ method: 'GET', url: '/api/outreach' });
    assert.deepEqual(get.json().data.accounts, []);
    assert.equal(get.json().data.defaults.enabled, false);
    assert.equal('query' in get.json().data.defaults, false);
    const { actorId: _, id: _id, ...defaults } = DEFAULT_OUTREACH_CONFIG;
    const input = { ...defaults, name: '个人号', cookieId: 'a' };
    const create = (payload: object) => app.inject({ method: 'POST', url: '/api/outreach/accounts', payload });
    assert.equal((await create({ ...input, requestGapSeconds: 0 })).statusCode, 400);
    assert.equal((await create({ ...input, query: 'mutual' })).statusCode, 400);
    assert.equal((await create({ ...input, actorId: 'fake' })).statusCode, 400);
    new SettingsRepository(database).update({ x: { cookies: [
      { id: 'a', name: 'A', enabled: true, cookie: 'auth_token=fake; ct0=fake; twid=u%3D123' },
      { id: 'b', name: 'B', enabled: true, cookie: 'auth_token=other; ct0=fake; twid=u%3D456' },
    ] } });
    const first = await create(input);
    assert.equal(first.statusCode, 201);
    const firstId = first.json().data.config.id;
    const second = await create({ ...input, name: '产品号', cookieId: 'b', dailyLimit: 5, replyText: '一起交流～' });
    assert.equal(second.statusCode, 201);
    const secondId = second.json().data.config.id;
    assert.equal((await create(input)).statusCode, 400);
    assert.equal(first.body.includes('auth_token'), false);
    const path = `/api/outreach/accounts/${firstId}`;
    assert.equal((await app.inject({ method: 'PUT', url: path, payload: { ...input, name: '已编辑' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: path, payload: { ...input, cookieId: 'b' } })).statusCode, 400);
    const checked = await app.inject({ method: 'POST', url: `${path}/check` });
    assert.equal(checked.json().data.state.checkJob.status, 'done');
    const list = (await app.inject({ method: 'GET', url: '/api/outreach' })).json().data.accounts;
    assert.equal(list.length, 2);
    assert.equal(list[1].config.replyText, '一起交流～');
    assert.equal((await app.inject({ method: 'DELETE', url: path })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `${path}/check` })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/outreach/accounts/${secondId}` })).statusCode, 200);
    assert.equal(requests, 0);
  } finally { await app.close(); }
});
