const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, openQcRegister, createProject, createRecord, settle } = require('./helpers');

test('dashboard is the landing page and shows the signed-in user', async () => {
  const app = await bootApp();
  const { doc } = app;
  assert.notEqual(doc.getElementById('page-dashboard').style.display, 'none');
  assert.equal(doc.getElementById('page-qc').style.display, 'none');
  assert.equal(doc.querySelector('.auth-user').textContent, 'jane@iren.com');
  assert.ok(doc.querySelector('.auth-link[href*="logout"]'));
  assert.equal(doc.querySelectorAll('.dash-card').length, 6);
  assert.deepEqual(app.errors, []);
});

test('navigating into QC Register and back to the dashboard', async () => {
  const app = await bootApp();
  const { doc, click } = app;
  await openQcRegister(app);
  assert.notEqual(doc.getElementById('page-qc').style.display, 'none');
  assert.ok(doc.querySelector('#app .back-to-dash'));
  click('#app .back-to-dash');
  assert.notEqual(doc.getElementById('page-dashboard').style.display, 'none');
  assert.deepEqual(app.errors, []);
});

test('project + record creation persists through the storage API', async () => {
  const app = await bootApp();
  const { doc, api } = app;
  await openQcRegister(app);
  await createProject(app);
  assert.equal(doc.querySelector('.proj-item .p-name').textContent, 'Westview Tower');
  await createRecord(app, 'junction-box-inspection', { location: 'Panel DB-2, Circuit 14' });
  assert.ok(doc.querySelector('#record-detail-panel'));
  assert.equal(doc.querySelector('.tag-badge').textContent.trim(), 'WTC-60825-001');
  assert.equal(doc.querySelectorAll('.check-item').length, 21);
  await settle(app);
  assert.ok(api.store.has('shared/qc-data'));
  assert.ok(api.store.has('shared/qc-records-chunk-0'));
  assert.ok(!('records' in JSON.parse(api.store.get('shared/qc-data'))), 'index key must not embed records');
  assert.deepEqual(app.errors, []);
});

test('new records default to Not started and Draft no longer exists', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  assert.equal(doc.querySelector('.status-choices button.cur').textContent, 'Not started');
  const labels = [...doc.querySelectorAll('.status-choices button')].map((b) => b.textContent);
  assert.deepEqual(labels, ['Not started', 'Submitted', 'In review', 'On hold', 'Approved', 'Rejected']);
});

test('switching checksheet type mid-form does not wipe other fields (regression)', async () => {
  const app = await bootApp();
  const { doc, click, setVal } = app;
  await openQcRegister(app);
  await createProject(app);
  click('[data-act="open-new-record"]');
  click('[data-act="pick-type"][data-id="junction-box-inspection"]');
  setVal('nr-location', 'Panel DB-2');
  setVal('nr-area', 'DC41');
  setVal('nr-notes', 'context');
  click('[data-act="pick-type"][data-id="receptacle-inspection"]');
  assert.equal(doc.getElementById('nr-location').value, 'Panel DB-2');
  assert.equal(doc.getElementById('nr-area').value, 'DC41');
  assert.equal(doc.getElementById('nr-notes').value, 'context');
  assert.ok(doc.querySelector('[data-act="pick-type"][data-id="receptacle-inspection"]').classList.contains('sel'));
  click('[data-act="save-new-record"]');
  await app.wait(20);
  assert.ok(doc.querySelector('.tag-badge').textContent.includes('60826'), 'saved with the last-picked type');
});

test('checklist marks, failed-item flag, and status changes', async () => {
  const app = await bootApp();
  const { doc, click } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  click('.check-btns button[data-val="fail"]');
  assert.ok(doc.querySelector('.check-btns button[data-val="fail"]').classList.contains('on-fail'));
  click('.status-choices button[data-status="submitted"]');
  assert.equal(doc.querySelector('.status-choices button.cur').textContent, 'Submitted');
  click('[data-act="close-panel"]');
  assert.ok(doc.querySelector('.flag-dot'), 'row shows failed-item flag');
  assert.equal(doc.querySelector('.status-pill').textContent.trim(), 'Submitted');
  const stats = [...doc.querySelectorAll('.stat-card .n')].map((n) => n.textContent);
  assert.deepEqual(stats, ['1', '1', '1', '0']);
});

test('notes autosave and survive an unrelated re-render (regression)', async () => {
  const app = await bootApp();
  const { doc, click } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  const notes = doc.getElementById('rd-notes');
  notes.value = 'Left this bolt for follow-up';
  app.fire(notes, 'input');
  click('.check-btns button[data-val="pass"]'); // triggers a full render
  assert.equal(doc.getElementById('rd-notes').value, 'Left this bolt for follow-up');
  assert.equal(doc.querySelector('[data-act="save-notes"]'), null, 'no Save notes button');
  click('[data-act="close-panel"]');
  click('[data-act="open-record"]');
  await app.wait(20);
  assert.equal(doc.getElementById('rd-notes').value, 'Left this bolt for follow-up');
});

test('panel scroll position survives checklist/status/table actions (regression)', async () => {
  const app = await bootApp();
  const { doc, click } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'e-house-checksheet');
  doc.querySelector('.panel-body').scrollTop = 450;
  click('.check-btns button[data-val="pass"]');
  assert.equal(doc.querySelector('.panel-body').scrollTop, 450);
  doc.querySelector('.panel-body').scrollTop = 300;
  click('.status-choices button[data-status="submitted"]');
  assert.equal(doc.querySelector('.panel-body').scrollTop, 300);
});

test('metadata fields: creation form, live editing, area/subsystem suggestions', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'junction-box-inspection', {
    inputs: { 'nr-asset-type': 'Reclaimer', 'nr-tag-desc': 'DCRP-31-A1', 'nr-area': 'DC41', 'nr-subsystem': 'UPS', 'nr-contractor': 'Beumer' }
  });
  assert.equal(doc.querySelector('[data-field="discipline"]').value, 'Electrical', 'defaults to Electrical');
  assert.equal(doc.querySelector('[data-field="area"]').value, 'DC41');
  assert.equal(doc.querySelector('[data-field="subsystem"]').value, 'UPS');
  assert.equal(doc.getElementById('area-list').querySelectorAll('option').length, 28);
  assert.equal(doc.getElementById('subsystem-list').querySelectorAll('option').length, 8);
  const contractor = doc.querySelector('[data-field="contractor"]');
  contractor.value = 'Updated Co';
  app.fire(contractor, 'input');
  app.click('[data-act="close-panel"]');
  app.click('[data-act="open-record"]');
  await app.wait(20);
  assert.equal(doc.querySelector('[data-field="contractor"]').value, 'Updated Co');
});

test('Tag Description is the displayed identifier, with auto-tag fallback', async () => {
  const app = await bootApp();
  const { doc, click } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'junction-box-inspection', { inputs: { 'nr-tag-desc': 'DCRP-31-A1/PDU-31-A1-A' } });
  assert.equal(doc.querySelector('.tag-badge').textContent.trim(), 'DCRP-31-A1/PDU-31-A1-A');
  click('[data-act="close-panel"]');
  assert.equal(doc.querySelector('.rec-tag').textContent.trim(), 'DCRP-31-A1/PDU-31-A1-A');
  await createRecord(app, 'junction-box-inspection', { location: 'JB-2' });
  assert.equal(doc.querySelector('.tag-badge').textContent.trim(), 'WTC-60825-002', 'falls back when blank');
});

test('table columns include Area and Subsystem; search covers them but not inspector', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'junction-box-inspection', { inputs: { 'nr-inspector': 'ZanzibarX', 'nr-area': 'ConveyorZoneAlpha', 'nr-subsystem': 'HopperSub' } });
  app.click('[data-act="close-panel"]');
  const head = [...doc.querySelectorAll('.rec-row.head > div')].map((d) => d.textContent);
  assert.ok(head.includes('Area') && head.includes('Subsystem'));
  const search = (q) => { const el = doc.querySelector('[data-act="filter-search"]'); el.value = q; app.fire(el, 'input'); return doc.querySelectorAll('.rec-row.body').length; };
  assert.equal(search('ConveyorZoneAlpha'), 1);
  assert.equal(search('HopperSub'), 1);
  assert.equal(search('ZanzibarX'), 0, 'inspector is not searchable');
  assert.equal(search(''), 1);
});

test('sign-off fields autosave and persist', async () => {
  const app = await bootApp();
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  const name = doc.querySelector('[data-field="contractorName"]');
  name.value = 'Jane Smith'; app.fire(name, 'input');
  const iren = doc.querySelector('[data-field="irenName"]');
  iren.value = 'John Doe'; app.fire(iren, 'input');
  app.click('[data-act="close-panel"]');
  app.click('[data-act="open-record"]');
  await app.wait(20);
  assert.equal(doc.querySelector('[data-field="contractorName"]').value, 'Jane Smith');
  assert.equal(doc.querySelector('[data-field="irenName"]').value, 'John Doe');
});

test('record and project deletion', async () => {
  const app = await bootApp();
  const { doc, click } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  click('[data-act="ask-delete-record"]');
  click('[data-act="confirm-delete"]');
  assert.ok(doc.querySelector('.empty-state').textContent.includes('No QC records yet'));
  click('[data-act="ask-delete-project"]');
  click('[data-act="confirm-delete"]');
  assert.ok(doc.querySelector('.empty-state').textContent.includes('No project selected'));
  assert.deepEqual(app.errors, []);
});

test('legacy records without newer fields load and get backfilled', async () => {
  const legacy = {
    id: 'r1', projectId: 'p1', type: 'junction-box-inspection', tag: 'LEG-60825-001', location: 'JB-1',
    inspector: 'Old', date: '2026-01-01', status: 'draft', notes: '',
    checklist: [{ id: 'c1', label: 'x', result: null }],
    history: [{ ts: Date.now(), by: 'Old', text: 'Record created' }], createdAt: Date.now(), updatedAt: Date.now()
    // no tables / signoff / photos / meta
  };
  const app = await bootApp({ store: {
    'shared/qc-data': JSON.stringify({ projects: [{ id: 'p1', name: 'Legacy', code: 'LEG', createdAt: Date.now() }], chunkCount: 1 }),
    'shared/qc-records-chunk-0': JSON.stringify([legacy])
  } });
  const { doc } = app;
  await openQcRegister(app);
  assert.equal(doc.querySelector('.status-pill').textContent.trim(), 'Not started', 'old draft status maps to Not started');
  app.click('[data-act="open-record"]');
  await app.wait(20);
  assert.ok(doc.querySelector('.signoff-grid'));
  assert.ok(doc.querySelector('.photo-grid'));
  assert.ok(doc.querySelectorAll('.meta-input').length > 0);
  assert.deepEqual(app.errors, []);
});
