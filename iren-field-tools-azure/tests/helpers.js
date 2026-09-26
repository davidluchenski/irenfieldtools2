// Shared harness for the browser-side tests.
//
// Loads index.html into jsdom and provides an in-memory implementation of
// the /api/storage endpoint (and /.auth/me) behind window.fetch. The app's
// own storage shim then runs unmodified against it, so every test exercises
// the real code path from UI event -> app logic -> shim -> "API" and back.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function createMockApi(initialStore = {}) {
  const store = new Map(Object.entries(initialStore));
  const calls = [];
  const principal = { identityProvider: 'aad', userId: 'test-user', userDetails: 'jane@iren.com', userRoles: ['authenticated', 'qcuser'] };
  const nameFor = (shared, key) => (shared ? 'shared/' : 'users/test-user/') + key;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, path: url.pathname, key: url.searchParams.get('key') });

    if (url.pathname === '/.auth/me') return json(200, { clientPrincipal: principal });

    if (url.pathname === '/api/storage') {
      if (method === 'GET') {
        const key = url.searchParams.get('key'), shared = url.searchParams.get('shared') === '1';
        const n = nameFor(shared, key);
        if (!store.has(n)) return json(404, { error: 'Key not found', key });
        return json(200, { key, value: store.get(n), shared });
      }
      if (method === 'PUT') {
        const b = JSON.parse(init.body);
        store.set(nameFor(!!b.shared, b.key), b.value);
        calls[calls.length - 1].key = b.key;
        return json(200, { key: b.key, value: b.value, shared: !!b.shared });
      }
      if (method === 'DELETE') {
        const key = url.searchParams.get('key'), shared = url.searchParams.get('shared') === '1';
        return json(200, { key, deleted: store.delete(nameFor(shared, key)), shared });
      }
    }
    return json(404, { error: 'not found' });
  }

  return { store, calls, fetch: fetchImpl, principal };
}

/**
 * Boot the app. Returns { window, doc, api, click, setVal, wait, errors, alerts }.
 * Options:
 *   store     - initial key/value pairs, keyed like 'shared/qc-data' or 'users/test-user/qc-user-name'
 *   xlsx      - if provided, exposed as window.XLSX (to test Excel export)
 *   mockMedia - install Image/Canvas fakes so photo upload can run without a real decoder
 */
async function bootApp(options = {}) {
  const api = createMockApi(options.store || {});
  const errors = [];
  const alerts = [];

  const dom = new JSDOM(INDEX_HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = api.fetch;
      window.alert = (m) => alerts.push(String(m));
      window.print = () => {};
      window.scrollTo = () => {};
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      if (options.xlsx) window.XLSX = options.xlsx;
      if (options.mockMedia) installMediaMocks(window);
    }
  });

  const { window } = dom;
  window.onerror = (msg, src, line, col, err) => errors.push(`${msg}\n${err && err.stack}`);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(200); // let loadState() and the auth slot resolve

  const doc = window.document;
  const click = (sel) => {
    const el = doc.querySelector(sel);
    if (!el) throw new Error('click: no element matches ' + sel);
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  const setVal = (id, value) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error('setVal: no element with id ' + id);
    el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

  return { window, doc, api, click, setVal, fire, wait, errors, alerts };
}

function installMediaMocks(window) {
  window.Image = function () {
    const img = { width: 0, height: 0 };
    Object.defineProperty(img, 'src', {
      set() { img.width = 4000; img.height = 3000; setTimeout(() => img.onload && img.onload(), 0); }
    });
    return img;
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = function () {
    return 'data:image/jpeg;base64,FAKECOMPRESSED_' + this.width + 'x' + this.height;
  };
}

// Common flows reused across test files.
async function openQcRegister(app) {
  app.click('[data-tool="qc-register"]');
  await app.wait(30);
}
async function createProject(app, name = 'Westview Tower', code = 'WTC') {
  app.click('[data-act="open-new-project"]');
  app.setVal('np-name', name);
  app.setVal('np-code', code);
  app.click('[data-act="save-new-project"]');
  await app.wait(20);
}
async function createRecord(app, type = 'junction-box-inspection', fields = {}) {
  app.click('[data-act="open-new-record"]');
  app.click(`[data-act="pick-type"][data-id="${type}"]`);
  app.setVal('nr-location', fields.location || 'JB-1');
  for (const [id, v] of Object.entries(fields.inputs || {})) app.setVal(id, v);
  app.click('[data-act="save-new-record"]');
  await app.wait(20);
}
// The debounced persist() flushes 150ms after the last change.
async function settle(app) { await app.wait(300); }

module.exports = { bootApp, createMockApi, openQcRegister, createProject, createRecord, settle, INDEX_HTML };
