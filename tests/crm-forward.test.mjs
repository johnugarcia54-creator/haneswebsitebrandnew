/* Tests for the CRM forward of website enquiries (ADDENDUM §7.3, §12.2): npm test.
   Every studio answer comes from a stand-in HTTP server on 127.0.0.1, so nothing leaves this machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validate, compose } from '../api/_lib/enquiry.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = s => createHash('sha256').update(s).digest('hex');
const good = { name: 'Aroha Smith', email: 'aroha@example.co.nz', subject: 'Hanesteel quote', form: 'test', page: '/hanesteel.html', elapsed: 9000, website: '',
  fields: [['Phone', '021 000 000'], ['Message', 'Six windows\nand a door']] };

/* ---------- validate: the two keys assets/enquiry.js sends at the top level ---------- */
test('validate keeps a UUID submissionId and makes one when it is missing or not a UUID', () => {
  assert.equal(validate({ ...good, submissionId: '0F8FAD5B-D9CB-469F-A165-70867728950E' }).data.submissionId, '0f8fad5b-d9cb-469f-a165-70867728950e');
  for (const submissionId of [undefined, '', 'abc', 42, '0f8fad5b-d9cb-469f-a165-70867728950e ', '0f8fad5b-d9cb-469f-a165-70867728950e\n', { id: 1 }]) {
    const id = validate({ ...good, submissionId }).data.submissionId;
    assert.match(id, UUID, String(submissionId));
  }
  assert.notEqual(validate(good).data.submissionId, validate(good).data.submissionId);
});

test('validate reads marketingOptIn as true only when it is exactly true', () => {
  assert.equal(validate({ ...good, marketingOptIn: true }).data.marketingOptIn, true);
  for (const marketingOptIn of [undefined, false, 'true', 'yes', 1, null]) assert.equal(validate({ ...good, marketingOptIn }).data.marketingOptIn, false);
});

/* ---------- compose: byte-identical without the CRM line ---------- */
test('compose without a note is byte for byte the email from before the forward', () => {
  // sha256 of JSON.stringify(compose(validate(good).data)) at 7c5c7a6, before C1a
  assert.equal(sha(JSON.stringify(compose(validate(good).data))), 'c18cd0a41601077046b312a17260460c4a2f49318ba6842a971287918457d8bd');
  assert.deepEqual(compose(validate(good).data, ''), compose(validate(good).data));
});

test('compose adds the note as one last line, escaped in the HTML', () => {
  const d = validate(good).data, base = compose(d), m = compose(d, 'CRM: NOT stored (400), enter by hand <x>');
  assert.equal(m.text, `${base.text}\nCRM: NOT stored (400), enter by hand <x>`);
  assert.ok(m.html.includes('CRM: NOT stored (400), enter by hand &lt;x&gt;</p>'));
  assert.ok(!m.html.includes('<x>'));
  assert.equal(m.subject, base.subject);
  assert.equal(m.replyTo, base.replyTo);
});
