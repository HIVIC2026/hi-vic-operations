import { afterEach, expect, test } from 'bun:test';
import { au1Configured, au1SendMessage } from '../src/lib/twilio-au1.server';

const originalFetch = globalThis.fetch;
const originalApp = process.env.LOVABLE_API_KEY;
const originalConnection = process.env.TWILIO_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApp === undefined) delete process.env.LOVABLE_API_KEY;
  else process.env.LOVABLE_API_KEY = originalApp;
  if (originalConnection === undefined) delete process.env.TWILIO_API_KEY;
  else process.env.TWILIO_API_KEY = originalConnection;
});

test('Sender uses explicitly selected linked US1 connection and form-encoded body', async () => {
  process.env.LOVABLE_API_KEY = 'synthetic-app';
  process.env.TWILIO_API_KEY = 'synthetic-us1';
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    expect(url).toBe('https://connector-gateway.lovable.dev/twilio/Messages.json');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Connection-Api-Key') === 'synthetic-us1').toBe(true);
    expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(init?.body instanceof URLSearchParams).toBe(true);
    expect(init?.signal instanceof AbortSignal).toBe(true);
    return new Response('{"sid":"synthetic"}', { status: 201 });
  }) as typeof fetch;
  expect(au1Configured()).toBe(true);
  expect((await au1SendMessage(new URLSearchParams({ Body: 'TEST ONLY' }))).status).toBe(201);
  expect(calls).toBe(1);
});

test('missing selected SMS connection fails closed without fallback or provider request', async () => {
  process.env.LOVABLE_API_KEY = 'synthetic-app';
  delete process.env.TWILIO_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  expect(au1Configured()).toBe(false);
  expect((await au1SendMessage(new URLSearchParams())).ok).toBe(false);
  expect(calls).toBe(0);
});

test('ambiguous provider failure is returned once without automatic retry', async () => {
  process.env.LOVABLE_API_KEY = 'synthetic-app';
  process.env.TWILIO_API_KEY = 'synthetic-us1';
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('Unavailable', { status: 503 }); }) as typeof fetch;
  expect((await au1SendMessage(new URLSearchParams())).status).toBe(503);
  expect(calls).toBe(1);
});