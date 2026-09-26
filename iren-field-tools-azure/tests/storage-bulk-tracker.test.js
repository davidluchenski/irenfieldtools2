const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, openQcRegister, createProject, createRecord, settle } = require('./helpers');

async function runBulkGenerate(app) {
  app.click('[data-act="open-bulk-generate"]');
  await app.wait(20);
  app.click('[data-act="confirm-bulk-generate"]');
  let waited = 0;
  while (app.doc.querySelector('.modal-head') && app.doc.querySelector('.modal-head').textContent.includes('Generating') && waited < 30000) {
    await app.wait(100); waited += 100;
  }
  await settle(app);
}

test('baseline generation: 28 projects x 214 records, correct XY substitution and types', async () => {
  const app = await bootApp();
  const { doc, api } = app;
  await openQcRegister(app);
  await runBulkGenerate(app);

  const index = JSON.parse(api.store.get('shared/qc-data'));
  assert.equal(index.projects.length, 28);
  assert.equal(index.projects[0].code, 'DC11');
  assert.equal(index.projects[27].code, 'DC48');

  let all = [];
  for (let i = 0; i < index.chunkCount; i++) all = all.concat(JSON.parse(api.store.get('shared/qc-records-chunk-' + i)));
  assert.equal(all.length, 5992);
  const perProject = {};
  all.forEach((r) => { perProject[r.projectId] = (perProject[r.projectId] || 0) + 1; });
  assert.ok(Object.values(perProject).every((c) => c === 214));

  const dc31 = index.projects.find((p) => p.code === 'DC31').id;
  const tags = all.filter((r) => r.projectId === dc31).map((r) => r.meta.tagDescription);
  for (const t of ['G-31', 'UPS-31-A1', 'DCRP-31-A1', 'CB-DC31-4U-R1-R1', 'DCFPT-31-1']) assert.ok(tags.includes(t), 'missing tag ' + t);
  assert.equal(all.filter((r) => r.meta.tagDescription.includes('XY') || r.notes.includes('XY')).length, 0, 'no leftover XY');

  const byType = {};
  all.filter((r) => r.projectId === dc31).forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
  assert.deepEqual(byType, { 'lv-power-cable-inspection': 193, 'battery-ups-checklist': 6, 'lv-panelboard-checklist': 9, 'dry-type-transformer-inspection': 6 });
  assert.ok(all.every((r) => r.status === 'not-started'));

  assert.equal(doc.querySelectorAll('.proj-item').length, 28);
  assert.equal(doc.querySelectorAll('.rec-row.body').length, 214);
  assert.deepEqual(app.errors, []);
});

test('chunked storage: 150-record boundaries, only the touched chunk is rewritten, full reload', async () => {
  const app = await bootApp();
  const { doc, api } = app;
  await openQcRegister(app);
  await runBulkGenerate(app);

  const index = JSON.parse(api.store.get('shared/qc-data'));
  assert.equal(index.chunkCount, 40);
  assert.equal(JSON.parse(api.store.get('shared/qc-records-chunk-0')).length, 150);
  assert.equal(JSON.parse(api.store.get('shared/qc-records-chunk-39')).length, 5992 - 39 * 150);
  assert.ok(!('records' in index), 'index stays lightweight');

  // Active project is DC11 = the first 214 records created -> chunks 0 and 1.
  // The table is newest-first, so the first row is record #214, which lives in chunk 1.
  api.calls.length = 0;
  app.click('.rec-row.body');
  await app.wait(20);
  const notes = doc.getElementById('rd-notes');
  notes.value = 'edited'; app.fire(notes, 'input');
  await settle(app);
  const written = api.calls.filter((c) => c.method === 'PUT').map((c) => c.key);
  assert.deepEqual(written.sort(), ['qc-data', 'qc-records-chunk-1'].sort(), 'only chunk-1 + index rewritten');

  // Fresh session reloads everything from the same store
  const app2 = await bootApp({ store: Object.fromEntries(api.store) });
  await openQcRegister(app2);
  assert.equal(app2.doc.querySelectorAll('.proj-item').length, 28);
  assert.ok(app2.doc.querySelector('.p-meta').textContent.includes('214 records'));
  assert.deepEqual(app2.errors, []);
});

test('bulk generate is idempotent for projects but duplicates records (as the dialog states)', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await runBulkGenerate(app);
  app.click('[data-act="close-overlay"]');
  await runBulkGenerate(app);
  assert.equal(doc.querySelectorAll('.proj-item').length, 28);
  assert.equal(doc.querySelectorAll('.rec-row.body').length, 428);
});

test('Construction Tracker: projects, milestones, status, percent, notes, isolation from QC', async () => {
  const app = await bootApp();
  const { doc, api } = app;
  app.click('[data-tool="construction-tracker"]');
  await app.wait(30);
  assert.ok(doc.querySelector('#tracker-app .empty-state'));
  app.click('#tracker-app [data-act="open-new-project"]');
  app.setVal('ctnp-name', 'Westview Tower'); app.setVal('ctnp-code', 'WTC');
  app.click('[data-act="save-new-project"]');
  app.click('#tracker-app [data-act="open-new-milestone"]');
  app.setVal('nm-name', 'Substation foundation complete');
  doc.getElementById('nm-category').value = 'Civil';
  app.setVal('nm-date', '2026-12-01');
  app.click('[data-act="save-new-milestone"]');
  await app.wait(20);
  assert.ok(doc.querySelector('#milestone-detail-panel').textContent.includes('Substation foundation complete'));

  const pct = doc.querySelector('[data-act="milestone-percent"]'); pct.value = '45'; app.fire(pct, 'input');
  app.click('.status-choices button[data-status="in-progress"]');
  assert.equal(doc.querySelector('.status-choices button.cur').textContent, 'In progress');
  const notes = doc.querySelector('[data-act="milestone-notes"]'); notes.value = 'Waiting on rebar'; app.fire(notes, 'input');
  app.click('[data-act="close-panel"]');
  const row = doc.querySelector('.rec-row.body.ct');
  assert.equal(row.querySelector('.progress-fill').style.width, '45%');
  row.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  await app.wait(20);
  assert.equal(doc.querySelector('[data-act="milestone-notes"]').value, 'Waiting on rebar');
  assert.equal(doc.querySelector('[data-act="milestone-percent"]').value, '45');
  app.click('[data-act="close-panel"]');
  await settle(app);
  assert.ok(api.store.has('shared/ct-data'));
  assert.ok(!api.store.has('shared/qc-data'), 'tracker never touches QC storage');
  assert.deepEqual(app.errors, []);
});

test('scroll preservation is scoped per tool when both have panels open', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  app.click('#app .back-to-dash');
  app.click('[data-tool="construction-tracker"]');
  await app.wait(30);
  app.click('#tracker-app [data-act="open-new-project"]');
  app.setVal('ctnp-name', 'T'); app.setVal('ctnp-code', 'T');
  app.click('[data-act="save-new-project"]');
  app.click('#tracker-app [data-act="open-new-milestone"]');
  app.setVal('nm-name', 'M');
  app.click('[data-act="save-new-milestone"]');
  await app.wait(20);
  assert.ok(doc.querySelector('#app .panel-body') && doc.querySelector('#tracker-app .panel-body'), 'both panels exist in the DOM');
  doc.querySelector('#tracker-app .panel-body').scrollTop = 123;
  app.click('.status-choices button[data-status="in-progress"]');
  assert.equal(doc.querySelector('#tracker-app .panel-body').scrollTop, 123);
});
