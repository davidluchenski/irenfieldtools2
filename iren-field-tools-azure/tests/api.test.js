const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const { JSDOM } = require('jsdom');
const { INDEX_HTML } = require('./helpers');

const API_DIR = path.join(__dirname, '..', 'api');

// Load the Function handler with @azure/storage-blob replaced by an in-memory
// container, and app.http intercepted so we get the handler without a host.
function loadHandler() {
  const store = new Map();
  const container = {
    createIfNotExists: async () => ({}),
    getBlobClient: (name) => ({
      download: async () => {
        if (!store.has(name)) { const e = new Error('nf'); e.statusCode = 404; throw e; }
        return { readableStreamBody: Readable.from([Buffer.from(store.get(name))]) };
      },
      deleteIfExists: async () => ({ succeeded: store.delete(name) })
    }),
    getBlockBlobClient: (name) => ({ upload: async (value) => { store.set(name, value); } })
  };
  const blobPath = require.resolve('@azure/storage-blob', { paths: [API_DIR] });
  require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true, exports: { BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => container }) } } };
  process.env.STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  const fnPath = path.join(API_DIR, 'src', 'functions', 'storage.js');
  delete require.cache[fnPath];
  const functions = require(require.resolve('@azure/functions', { paths: [API_DIR] }));
  let handler;
  functions.app.http = (name, opts) => { handler = opts.handler; };
  require(fnPath);
  return { handler, store };
}

const principal = (userId) => Buffer.from(JSON.stringify({ identityProvider: 'aad', userId, userDetails: 'jane@iren.com', userRoles: ['authenticated', 'qcuser'] })).toString('base64');
function req(method, { query = {}, body, user = 'user-jane' } = {}) {
  const headers = new Map(); if (user) headers.set('x-ms-client-principal', principal(user));
  return { method, headers, query: new Map(Object.entries(query)), json: async () => body };
}
const ctx = { error() {} };

test('API: rejects requests without a signed-in principal', async () => {
  const { handler } = loadHandler();
  const r = await handler(req('GET', { query: { key: 'qc-data', shared: '1' }, user: null }), ctx);
  assert.equal(r.status, 401);
});

test('API: get/put/delete round trip on shared keys, 404 when missing', async () => {
  const { handler, store } = loadHandler();
  assert.equal((await handler(req('GET', { query: { key: 'qc-data', shared: '1' } }), ctx)).status, 404);
  assert.equal((await handler(req('PUT', { body: { key: 'qc-data', value: '{"projects":[]}', shared: true } }), ctx)).status, 200);
  const got = await handler(req('GET', { query: { key: 'qc-data', shared: '1' } }), ctx);
  assert.deepEqual(got.jsonBody, { key: 'qc-data', value: '{"projects":[]}', shared: true });
  assert.ok(store.has('shared/qc-data'));
  const del = await handler(req('DELETE', { query: { key: 'qc-data', shared: '1' } }), ctx);
  assert.equal(del.jsonBody.deleted, true);
  assert.equal((await handler(req('GET', { query: { key: 'qc-data', shared: '1' } }), ctx)).status, 404);
});

test('API: personal keys are isolated per user', async () => {
  const { handler, store } = loadHandler();
  await handler(req('PUT', { body: { key: 'qc-user-name', value: 'Jane', shared: false }, user: 'user-jane' }), ctx);
  assert.equal((await handler(req('GET', { query: { key: 'qc-user-name', shared: '0' }, user: 'user-bob' }), ctx)).status, 404);
  assert.equal((await handler(req('GET', { query: { key: 'qc-user-name', shared: '0' }, user: 'user-jane' }), ctx)).jsonBody.value, 'Jane');
  assert.ok(store.has('users/user-jane/qc-user-name'));
});

test('API: round-trips a 525KB chunk and validates keys', async () => {
  const { handler } = loadHandler();
  const big = 'x'.repeat(525 * 1024);
  await handler(req('PUT', { body: { key: 'qc-records-chunk-0', value: big, shared: true } }), ctx);
  const got = await handler(req('GET', { query: { key: 'qc-records-chunk-0', shared: '1' } }), ctx);
  assert.equal(got.jsonBody.value.length, big.length);
  assert.equal((await handler(req('GET', { query: { key: '../../etc/passwd', shared: '1' } }), ctx)).status, 400);
  assert.equal((await handler(req('PUT', { body: { key: 'qc-data', value: { not: 'a string' }, shared: true } }), ctx)).status, 400);
  assert.equal((await handler(req('GET', { query: { key: 'photo:abc123', shared: '1' } }), ctx)).status, 404, 'valid key shape, simply absent');
});

test('end-to-end over real HTTP: shim -> API -> reload in a fresh session', async () => {
  // A minimal server implementing the same contract as the Function, so the
  // app's shim is exercised with genuine network requests rather than a mock.
  const store = new Map();
  const nameFor = (s, k) => (s ? 'shared/' : 'users/test/') + k;
  const server = http.createServer((rq, rs) => {
    const url = new URL(rq.url, 'http://localhost');
    const send = (code, body) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(body)); };
    if (url.pathname === '/.auth/me') return send(200, { clientPrincipal: { userId: 'test', userDetails: 'jane@iren.com', userRoles: ['authenticated', 'qcuser'] } });
    if (url.pathname !== '/api/storage') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(INDEX_HTML); }
    const key = url.searchParams.get('key'), shared = url.searchParams.get('shared') === '1';
    if (rq.method === 'GET') return store.has(nameFor(shared, key)) ? send(200, { key, value: store.get(nameFor(shared, key)), shared }) : send(404, { error: 'nf' });
    if (rq.method === 'DELETE') return send(200, { key, deleted: store.delete(nameFor(shared, key)), shared });
    let body = ''; rq.on('data', (c) => body += c); rq.on('end', () => { const b = JSON.parse(body); store.set(nameFor(!!b.shared, b.key), b.value); send(200, b); });
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port;
  const boot = () => new JSDOM(INDEX_HTML, { runScripts: 'dangerously', url: base + '/', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (i, init) => fetch(new URL(i, base).toString(), init); w.alert = () => {}; w.scrollTo = () => {}; } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const dom = boot(); const errors = [];
    dom.window.onerror = (m) => errors.push(m);
    await wait(400);
    const doc = dom.window.document;
    const click = (sel) => doc.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const setVal = (id, v) => { const el = doc.getElementById(id); el.value = v; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
    assert.equal(doc.querySelector('.auth-user').textContent, 'jane@iren.com');
    click('[data-tool="qc-register"]'); await wait(50);
    click('[data-act="open-new-project"]'); setVal('np-name', 'Westview Tower'); setVal('np-code', 'WTC'); click('[data-act="save-new-project"]');
    click('[data-act="open-new-record"]'); click('[data-act="pick-type"][data-id="junction-box-inspection"]'); setVal('nr-location', 'JB-1'); click('[data-act="save-new-record"]');
    click('[data-act="close-panel"]');
    setVal('user-name-input', 'Jane Smith');
    await wait(400);
    assert.ok(store.has('shared/qc-data') && store.has('shared/qc-records-chunk-0'));
    assert.ok(store.has('users/test/qc-user-name') && !store.has('shared/qc-user-name'));
    assert.deepEqual(errors, []);

    const dom2 = boot(); await wait(400);
    const d2 = dom2.window.document;
    d2.querySelector('[data-tool="qc-register"]').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true })); await wait(50);
    assert.equal(d2.querySelector('.p-name').textContent, 'Westview Tower');
    assert.equal(d2.querySelectorAll('.rec-row.body').length, 1);
    assert.equal(d2.getElementById('user-name-input').value, 'Jane Smith');
  } finally {
    server.close();
  }
});
