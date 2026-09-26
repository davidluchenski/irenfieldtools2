const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { bootApp, openQcRegister, createProject, createRecord } = require('./helpers');

function captureCsv(app) {
  let csv = null;
  const OB = app.window.Blob;
  app.window.Blob = function (parts, opts) { csv = parts.join(''); return new OB(parts, opts); };
  app.click('[data-act="export-csv"]');
  return csv;
}

test('CSV export uses the display tag and includes metadata + photo columns', async () => {
  const app = await bootApp();
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'junction-box-inspection', { inputs: { 'nr-tag-desc': 'DCRP-31-A1', 'nr-area': 'DC31', 'nr-subsystem': 'PDU' } });
  app.click('[data-act="close-panel"]');
  const csv = captureCsv(app);
  const [header, row] = csv.split('\n');
  for (const col of ['Discipline', 'Area', 'Subsystem', 'Contractor', 'Photos', 'Failed items']) assert.ok(header.includes(col), col);
  assert.ok(row.startsWith('"DCRP-31-A1"'));
  assert.ok(row.includes('"DC31"') && row.includes('"PDU"'));
});

test('Excel export builds Records and Punch List sheets with failed items and punchlist rows', async () => {
  const app = await bootApp({ xlsx: XLSX });
  const { doc } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'junction-box-inspection', { location: 'JB-1' });
  app.click('.check-btns button[data-val="fail"]');
  app.click('[data-act="close-panel"]');
  await createRecord(app, 'non-conformance', { location: 'Panel DB-3' });
  const inputs = doc.querySelectorAll('.data-table input');
  const vals = ['Cracked gland', 'MCC-04', 'ACME Electrical', 'Safety'];
  vals.forEach((v, i) => { inputs[i].value = v; app.fire(inputs[i], 'input'); });
  app.click('[data-act="close-panel"]');

  let wb = null;
  app.window.XLSX.writeFile = (w, name) => { wb = w; assert.equal(name, 'WTC-qc-export.xlsx'); };
  app.click('[data-act="export-excel"]');
  assert.deepEqual(wb.SheetNames, ['Records', 'Punch List']);
  const records = XLSX.utils.sheet_to_json(wb.Sheets['Records'], { header: 1 });
  assert.equal(records.length - 1, 2);
  const punch = XLSX.utils.sheet_to_json(wb.Sheets['Punch List'], { header: 1 }).slice(1);
  assert.equal(punch.length, 2);
  assert.ok(punch.some((r) => r[2] === 'Failed checklist item'));
  const pl = punch.find((r) => r[2] === 'Punchlist item');
  assert.deepEqual(pl.slice(3, 6), ['Cracked gland', 'MCC-04', 'ACME Electrical']);
});

test('Excel export explains itself when the library is unavailable', async () => {
  const app = await bootApp();
  await openQcRegister(app);
  await createProject(app);
  app.click('[data-act="export-excel"]');
  assert.ok(app.alerts.some((m) => m.includes('Excel export library')));
  assert.deepEqual(app.errors, []);
});

test('PDF export renders a complete print view and calls print()', async () => {
  const app = await bootApp();
  const { doc } = app;
  let printed = false;
  app.window.print = () => { printed = true; };
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app, 'electrical-torque-record', { inputs: { 'nr-area': 'DC31' } });
  app.click('.check-btns button[data-val="fail"]');
  const t = doc.querySelector('.data-table input'); t.value = 'Torque value'; app.fire(t, 'input');
  const n = doc.getElementById('rd-notes'); n.value = 'Needs follow-up'; app.fire(n, 'input');
  const s = doc.querySelector('[data-field="contractorName"]'); s.value = 'Jane Smith'; app.fire(s, 'input');
  app.click('[data-act="export-pdf"]');
  assert.ok(printed);
  const pv = doc.getElementById('print-view').innerHTML;
  for (const needle of ['WTC-60822-001', 'Checklist', '>FAIL<', 'DC31', 'Components / Ratings', 'Torque value', 'Needs follow-up', 'Jane Smith', 'Contractor QA/QC', 'IREN/ITI Representative Review', 'Record created']) {
    assert.ok(pv.includes(needle), 'print view missing: ' + needle);
  }
});

test('SharePoint push: prompts for URL, then POSTs the payload, and reports failures', async () => {
  const app = await bootApp();
  const { doc, api } = app;
  await openQcRegister(app);
  await createProject(app);
  await createRecord(app);
  app.click('[data-act="close-panel"]');

  app.click('[data-act="send-to-sharepoint"]');
  assert.ok(doc.querySelector('.modal-head').textContent.includes('SharePoint'), 'unconfigured -> settings modal');
  app.setVal('sp-url', 'https://prod-00.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke');
  app.click('[data-act="save-sharepoint-url"]');
  await app.wait(20);
  assert.ok(api.store.has('shared/qc-sharepoint-flow-url'), 'flow URL persisted as a shared setting');

  const sent = [];
  const realFetch = app.window.fetch;
  app.window.fetch = async (url, init) => {
    if (String(url).includes('logic.azure.com')) { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }
    return realFetch(url, init);
  };
  app.click('[data-act="send-to-sharepoint"]');
  await app.wait(50);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].project, 'Westview Tower');
  assert.equal(sent[0].records.length, 1);
  assert.deepEqual(Object.keys(sent[0].records[0]), ['tag', 'type', 'discipline', 'assetType', 'tagDescription', 'area', 'subsystem', 'contractor', 'location', 'inspector', 'date', 'status', 'failedItems', 'photoCount', 'notes']);
  assert.ok(app.alerts.some((m) => m.includes('Sent 1 record')));

  app.window.fetch = async (url, init) => { if (String(url).includes('logic.azure.com')) throw new TypeError('Failed to fetch'); return realFetch(url, init); };
  app.click('[data-act="send-to-sharepoint"]');
  await app.wait(50);
  assert.ok(app.alerts.some((m) => m.includes('Could not reach') && m.includes('CORS')));
  assert.deepEqual(app.errors, []);
});
