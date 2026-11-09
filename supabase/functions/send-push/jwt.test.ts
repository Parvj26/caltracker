import { assert, assertEquals } from '@std/assert';
import { signApnsJwt } from './jwt.ts';

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
function b64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function throwawayKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join('\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

Deno.test('signApnsJwt: ES256 header and claims, verifiable signature', async () => {
  const { pem, publicKey } = await throwawayKey();
  const jwt = await signApnsJwt({ keyP8: pem, keyId: 'KEY123', teamId: '88L5M6CC34' }, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  assertEquals(json(h), { alg: 'ES256', kid: 'KEY123' });
  assertEquals(json(c), { iss: '88L5M6CC34', iat: 1_800_000_000 });
  assertEquals(b64url(s).length, 64);
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64url(s), enc(`${h}.${c}`)));
});
