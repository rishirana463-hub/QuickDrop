import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, open, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function offer(page, file) {
  await page.goto('/');
  await page.getByLabel('Choose a file to send').setInputFiles(file);
  const link = page.getByLabel('Transfer link', { exact: true });
  await expect(link).toHaveValue(/\/receive\//);
  return `http://localhost:5173${new URL(await link.inputValue()).pathname}`;
}

async function installDiskPicker(page) {
  await page.addInitScript(() => {
    window.__blobDownloads = 0;
    const create = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      window.__blobDownloads++;
      return create.call(this, blob);
    };
    window.showSaveFilePicker = async ({ suggestedName }) => {
      const root = await navigator.storage.getDirectory();
      window.__diskHandle = await root.getFileHandle(suggestedName, { create: true });
      return window.__diskHandle;
    };
  });
}

test('direct-to-disk transfer uses real browser writes and no assembled download Blob', async ({
  page: sender,
  browser,
}) => {
  const bytes = Buffer.from(Array.from({ length: 3 * 1024 * 1024 + 73 }, (_, i) => i % 251));
  const url = await offer(sender, {
    name: 'stream.bin',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  const receiver = await browser.newPage();
  try {
    await installDiskPicker(receiver);
    await receiver.goto(url);
    await receiver.getByRole('checkbox', { name: 'Save directly to disk' }).check();
    await receiver.getByRole('button', { name: 'Accept & save', exact: true }).click();
    await expect(receiver.getByRole('status')).toContainText('Transfer complete');
    await expect(sender.getByRole('status')).toContainText('Transfer complete');
    expect(
      await receiver.evaluate(async () => {
        const file = await window.__diskHandle.getFile();
        const data = new Uint8Array(await file.arrayBuffer());
        return {
          size: file.size,
          valid: data.every((v, i) => v === i % 251),
          blobs: window.__blobDownloads,
        };
      }),
    ).toEqual({ size: bytes.length, valid: true, blobs: 0 });
    await expect(receiver.getByRole('link', { name: 'Download file', exact: true })).toHaveCount(0);
  } finally {
    await receiver.close();
  }
});

test('cancelling the save picker sends no file bytes and permits another attempt', async ({
  page: sender,
  browser,
}) => {
  await sender.addInitScript(() => {
    window.__sentBytes = 0;
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (typeof data !== 'string') window.__sentBytes += data.byteLength;
      return send.call(this, data);
    };
  });
  const url = await offer(sender, {
    name: 'picker.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(2048),
  });
  const receiver = await browser.newPage();
  try {
    await receiver.addInitScript(() => {
      window.showSaveFilePicker = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });
    await receiver.goto(url);
    await receiver.getByRole('checkbox', { name: 'Save directly to disk' }).check();
    await receiver.getByRole('button', { name: 'Accept & save', exact: true }).click();
    await expect(receiver.getByRole('alert')).toContainText('No location selected');
    await expect(sender.getByRole('status')).toContainText('waiting for acceptance');
    expect(await sender.evaluate(() => window.__sentBytes)).toBe(0);
    await expect(
      receiver.getByRole('button', { name: 'Accept & save', exact: true }),
    ).toBeEnabled();
  } finally {
    await receiver.close();
  }
});

test('disk commit failure never reports a completed transfer', async ({
  page: sender,
  browser,
}) => {
  const url = await offer(sender, {
    name: 'full-disk.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(100),
  });
  const receiver = await browser.newPage();
  try {
    await receiver.addInitScript(() => {
      window.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async () => {},
          close: async () => {
            throw new Error('Disk full');
          },
          abort: async () => {
            window.__aborted = true;
          },
        }),
      });
    });
    await receiver.goto(url);
    await receiver.getByRole('checkbox', { name: 'Save directly to disk' }).check();
    await receiver.getByRole('button', { name: 'Accept & save', exact: true }).click();
    await expect(receiver.getByRole('status')).toContainText('Disk full');
    await expect(sender.getByRole('status')).toContainText('Transfer cancelled');
    await expect.poll(() => receiver.evaluate(() => window.__aborted)).toBe(true);
  } finally {
    await receiver.close();
  }
});

test('unsupported receiver blocks large-file acceptance without reading file contents', async ({
  page: sender,
  browser,
}) => {
  await sender.addInitScript(() => {
    const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
    Object.defineProperty(File.prototype, 'size', {
      get() {
        return this.name === 'large-metadata.bin' ? 3 * 1024 ** 3 : size.call(this);
      },
    });
  });
  const url = await offer(sender, {
    name: 'large-metadata.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(1),
  });
  const receiver = await browser.newPage();
  try {
    await receiver.addInitScript(() => {
      window.showSaveFilePicker = undefined;
    });
    await receiver.goto(url);
    await expect(receiver.getByText(/This browser cannot receive files over 512 MB/)).toBeVisible();
    await expect(
      receiver.getByRole('button', { name: 'Accept & save', exact: true }),
    ).toBeDisabled();
    await expect(sender.getByRole('status')).toContainText('waiting for acceptance');
  } finally {
    await receiver.close();
  }
});

test('multi-GB real file streams to browser disk without an in-memory Blob', async ({
  page: sender,
}) => {
  test.skip(
    process.env.QUICKDROP_LARGE_TEST !== '1',
    'Opt in to the actual 2 GB disk/transport test.',
  );
  test.setTimeout(900_000);
  const dir = await mkdtemp(join(tmpdir(), 'quickdrop-gb-test-'));
  const path = join(dir, 'two-gigabytes.bin');
  const size = 2 * 1024 ** 3 + 37;
  const source = await open(path, 'w');
  const head = Buffer.from('QuickDrop start');
  const tail = Buffer.from('QuickDrop end');
  try {
    await source.truncate(size);
    await source.write(head, 0, head.length, 0);
    await source.write(tail, 0, tail.length, size - tail.length);
  } finally {
    await source.close();
  }
  // Incognito storage is constrained by a memory-backed global quota even when
  // CDP overrides the origin quota. A fresh persistent profile uses real disk
  // storage. Playwright removes the temporary profile when the context closes.
  const diskContext = await chromium.launchPersistentContext('', { headless: true });
  const receiver = await diskContext.newPage();
  try {
    const url = await offer(sender, path);
    await installDiskPicker(receiver);
    await receiver.goto(url);
    const storage = await receiver.evaluate(() => navigator.storage.estimate());
    expect(storage.quota - storage.usage).toBeGreaterThan(size * 2);
    await receiver.getByRole('button', { name: 'Accept & save', exact: true }).click();
    await receiver.waitForFunction(
      () => !!document.querySelector('.status-complete,.status-error,.status-cancelled'),
      {},
      { timeout: 840_000 },
    );
    await expect(receiver.getByRole('status')).toContainText('Transfer complete');
    await expect(sender.getByRole('status')).toContainText('Transfer complete');
    console.log('2 GiB transfer committed; checking every saved byte.');
    const result = await receiver.evaluate(
      async ({ size, head, tail }) => {
        const file = await window.__diskHandle.getFile();
        let offset = 0;
        let valid = true;
        const reader = file.stream().getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (let i = 0; i < value.length; i++) {
            const position = offset + i;
            const expected =
              position < head.length
                ? head[position]
                : position >= size - tail.length
                  ? tail[position - (size - tail.length)]
                  : 0;
            if (value[i] !== expected) {
              valid = false;
              break;
            }
          }
          offset += value.length;
          if (!valid) {
            await reader.cancel();
            break;
          }
        }
        return { size: file.size, checked: offset, valid, blobs: window.__blobDownloads };
      },
      { size, head: [...head], tail: [...tail] },
    );
    expect(result).toEqual({ size, checked: size, valid: true, blobs: 0 });
    console.log(`Verified all ${size} bytes after real WebRTC transfer and browser disk writes.`);
  } finally {
    await diskContext.close();
    await unlink(path);
    await rmdir(dir);
  }
});
