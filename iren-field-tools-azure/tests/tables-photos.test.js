const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, openQcRegister, createProject, createRecord } = require('./helpers');

test('fixed-row tables: locked labels, editable cells, edits do not re-render', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'lv-power-cable-inspection');
  const tables = doc.querySelectorAll('.data-table');
  assert.ok(tables.length >= 7, 'LV cable form has its structured tables');
  const irt = tables[5]; // ratings, routing, continuity, shield, resistance, irt
  const rows = irt.querySelectorAll('tbody tr');
  assert.equal(rows.length, 8);
  assert.equal(rows[0].querySelector('td.lockcell').textContent, 'A to B');
  assert.equal(rows[0].querySelector('td.lockcell input'), null);
  const input = rows[0].querySelector('input');
  input.value = '500V';
  app.fire(input, 'input');
  assert.strictEqual(irt.querySelectorAll('tbody tr')[0].querySelector('input'), input, 'same node: no re-render on typing');
  assert.equal(input.value, '500V');
});

test('dynamic tables: add and remove rows, never below one blank row, values persist', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'lv-power-cable-inspection');
  const routing = () => doc.querySelectorAll('.data-table')[1];
  const routingAddBtn = () => doc.querySelectorAll('.data-table-wrap')[1].nextElementSibling; // "+ Add row" follows its table
  assert.equal(routing().querySelectorAll('tbody tr').length, 1);
  const cable = routing().querySelector('input');
  cable.value = 'C-101'; app.fire(cable, 'input');
  routingAddBtn().dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(routing().querySelectorAll('tbody tr').length, 2);
  assert.equal(routing().querySelector('input').value, 'C-101', 'first row survives add-row render');
  routing().querySelectorAll('.table-rm')[1].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(routing().querySelectorAll('tbody tr').length, 1);
  routing().querySelector('.table-rm').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(routing().querySelectorAll('tbody tr').length, 1, 'removing the last row leaves one blank row');
  assert.equal(routing().querySelector('input').value, '');
  app.click('[data-act="close-panel"]');
  app.click('[data-act="open-record"]');
  await app.wait(20);
  assert.equal(doc.querySelectorAll('.data-table').length >= 7, true);
});

test('every record type renders its tables and round-trips a value', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  const types = [...doc.querySelectorAll('[data-act="open-new-record"]') ? [] : []];
  app.click('[data-act="open-new-record"]');
  const ids = [...doc.querySelectorAll('[data-act="pick-type"]')].map((b) => b.getAttribute('data-id'));
  app.click('[data-act="close-panel"]');
  assert.equal(ids.length, 17);
  for (const t of ids) {
    await createRecord(app, t, { location: 'x' });
    const inputs = doc.querySelectorAll('.data-table input');
    assert.ok(inputs.length > 0, `type ${t} should have at least one table input`);
    inputs[0].value = 'val-' + t;
    app.fire(inputs[0], 'input');
    app.click('[data-act="close-panel"]');
  }
  app.click('[data-act="open-record"]'); // most recent = non-conformance
  await app.wait(20);
  assert.equal(doc.querySelector('.data-table input').value, 'val-non-conformance');
  assert.deepEqual(app.errors, []);
});

test('photos: upload (compressed), separate storage keys, lightbox, remove, reload', async () => {
  const app = await bootApp({ mockMedia: true });
  const { doc, api, window } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  const input = doc.querySelector('[data-act="photo-input"]');
  assert.equal(input.getAttribute('capture'), 'environment');
  const f1 = new window.File(['a'], 'panel-front.jpg', { type: 'image/jpeg' });
  const f2 = new window.File(['b'], 'panel-label.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [f1, f2], configurable: true });
  app.fire(input, 'change');
  await app.wait(250);
  assert.equal(doc.querySelectorAll('.photo-thumb').length, 2);
  assert.equal(doc.querySelectorAll('.photo-thumb.loading').length, 0);
  assert.ok(doc.querySelector('.photo-thumb img').src.startsWith('data:image/jpeg;base64,FAKECOMPRESSED_'));
  assert.equal([...api.store.keys()].filter((k) => k.includes('photo:')).length, 2, 'each photo under its own key');
  await app.wait(300);
  const chunk = JSON.parse(api.store.get('shared/qc-records-chunk-0'));
  assert.equal(chunk[0].photos.length, 2);
  assert.ok(!JSON.stringify(chunk[0].photos).includes('FAKECOMPRESSED'), 'record holds metadata, not bytes');

  doc.querySelector('.photo-thumb').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(doc.querySelector('.lightbox'));
  app.click('.lightbox-close');
  assert.equal(doc.querySelector('.lightbox'), null);
  assert.ok(doc.querySelector('#record-detail-panel'), 'closing lightbox keeps the panel open');

  const rm = doc.querySelector('.photo-rm');
  const removedId = rm.getAttribute('data-photo');
  rm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await app.wait(20);
  assert.equal(doc.querySelectorAll('.photo-thumb').length, 1);
  assert.ok(!api.store.has('shared/photo:' + removedId), 'photo key deleted from storage');

  app.click('[data-act="close-panel"]');
  app.click('[data-act="open-record"]');
  await app.wait(50);
  assert.equal(doc.querySelectorAll('.photo-thumb:not(.loading)').length, 1);
  assert.deepEqual(app.errors, []);
});
