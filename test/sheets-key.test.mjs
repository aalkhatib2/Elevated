import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { normalizePrivateKey } from '../api/_lib/sheets.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const escaped = pem.replace(/\n/g, '\\n'); // how it sits in the JSON file

const signs = (key) => createSign('RSA-SHA256').update('x').sign(key, 'base64url').length > 0;

test('accepts the literal \\n form from the JSON file', () => assert.ok(signs(normalizePrivateKey(escaped))));
test('accepts real newlines', () => assert.ok(signs(normalizePrivateKey(pem))));
test('accepts the value pasted with its quotes and trailing comma', () =>
  assert.ok(signs(normalizePrivateKey(`"${escaped}",`))));
test('accepts the whole service-account JSON', () =>
  assert.ok(signs(normalizePrivateKey(JSON.stringify({ client_email: 'a@b', private_key: pem })))));
test('rejects garbage with an actionable message', () =>
  assert.throws(() => normalizePrivateKey('not a key'), /Re-copy the "private_key"/));
test('rejects empty', () => assert.throws(() => normalizePrivateKey('')));
