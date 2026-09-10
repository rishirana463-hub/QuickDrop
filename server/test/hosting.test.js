import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../index.js';

test('single-service hosting serves the app and deep links without exposing server files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quickdrop-hosting-'));
  await mkdir(path.join(directory, 'assets'));
  const files = ['index.html', 'assets/app.js', '.env'];
  await writeFile(path.join(directory, files[0]), '<!doctype html><title>QuickDrop</title>');
  await writeFile(path.join(directory, files[1]), 'console.log("QuickDrop");');
  await writeFile(path.join(directory, files[2]), 'PRIVATE_TEST_VALUE');
  const app = createSignalingServer({
    staticDir: directory,
    allowedOrigins: ['https://quickdrop.example'],
    publicOrigin: 'https://deployed.example',
  });
  try {
    const address = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    for (const route of ['/', '/receive/123?source=qr']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /<title>QuickDrop<\/title>/);
    }
    const asset = await fetch(base + '/assets/app.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    const head = await fetch(base + '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const route of [
      '/.env',
      '/server/index.js',
      '/assets/missing.js',
      '/assets/%2eenv',
      '/unknown',
      '/signal',
    ]) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
    assert.equal(
      (await fetch(base + '/', { method: 'POST', body: 'not a file upload' })).status,
      404,
    );
    assert.equal((await (await fetch(base + '/health')).json()).status, 'ok');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/signal`, {
      origin: 'https://deployed.example',
    });
    await once(socket, 'open');
    socket.close();
    await once(socket, 'close');
  } finally {
    await app.close();
    for (const file of files) await unlink(path.join(directory, file));
    await rmdir(path.join(directory, 'assets'));
    await rmdir(directory);
  }
});

test('single-service hosting fails clearly when the frontend has not been built', () => {
  assert.throws(
    () =>
      createSignalingServer({ staticDir: path.join(tmpdir(), 'quickdrop-missing-build', 'dist') }),
    /Frontend build is missing/,
  );
});
