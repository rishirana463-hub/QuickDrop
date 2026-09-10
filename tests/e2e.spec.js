import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const status = (page) => page.getByRole('status');

async function startTransfer(sender, file) {
  await sender.goto('/');
  await sender.getByLabel('Choose a file to send').setInputFiles(file);
  const link = sender.getByLabel('Transfer link', { exact: true });
  await expect(link).toHaveValue(/\/receive\/[\da-f-]{36}/i);
  return link.inputValue();
}

async function withReceiver(browser, url, run) {
  // Separate contexts exercise independent peers, without shared storage/state.
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const receiver = await context.newPage();
    // Exercise this test server even when the developer has a public QR override.
    await receiver.goto(`http://localhost:5173${new URL(url).pathname}`);
    await run(receiver);
  } finally {
    await context.close();
  }
}

test('binary bytes travel over WebRTC only after consent and download unchanged', async ({
  page: sender,
  browser,
}, testInfo) => {
  // Observe real outgoing binary frames without replacing the transport.
  await sender.addInitScript(() => {
    window.__sentFileBytes = 0;
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (typeof data !== 'string') window.__sentFileBytes += data.byteLength ?? data.size ?? 0;
      return send.call(this, data);
    };
  });
  const bytes = Buffer.from(
    Array.from({ length: 1024 * 1024 + 137 }, (_, index) => (index * 73 + 19) % 256),
  );
  const name = 'quickdrop-binary-fixture.bin';
  const url = await startTransfer(sender, {
    name,
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });

  await withReceiver(browser, url, async (receiver) => {
    const downloads = [];
    receiver.on('download', (download) => downloads.push(download));
    await expect(receiver.getByRole('button', { name: 'Accept file', exact: true })).toBeVisible();
    await expect(receiver.getByText(name, { exact: true })).toBeVisible();
    await expect(status(sender)).toContainText('waiting for acceptance');
    expect(downloads).toHaveLength(0);
    expect(await sender.evaluate(() => window.__sentFileBytes)).toBe(0);
    expect(await receiver.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      391,
    );
    await receiver.screenshot({
      path: testInfo.outputPath('receiver-consent-phone.png'),
      fullPage: true,
      animations: 'disabled',
    });

    const downloadPromise = receiver.waitForEvent('download');
    await receiver.getByRole('button', { name: 'Accept file', exact: true }).click();
    const download = await downloadPromise;
    await expect(status(receiver)).toContainText('Transfer complete');
    await expect(status(sender)).toContainText('Transfer complete');
    expect(download.suggestedFilename()).toBe(name);
    expect(await download.failure()).toBeNull();
    const savedBytes = await readFile(await download.path());
    expect(savedBytes.equals(bytes)).toBe(true);
    expect(await sender.evaluate(() => window.__sentFileBytes)).toBe(bytes.length);
    expect(downloads).toHaveLength(1);
    await receiver.screenshot({
      path: testInfo.outputPath('receiver-complete-phone.png'),
      fullPage: true,
      animations: 'disabled',
    });
  });
});

test('an empty file completes and downloads with zero bytes', async ({ page: sender, browser }) => {
  const url = await startTransfer(sender, {
    name: 'empty.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(0),
  });
  await withReceiver(browser, url, async (receiver) => {
    await expect(receiver.getByRole('button', { name: 'Accept file', exact: true })).toBeVisible();
    const downloadPromise = receiver.waitForEvent('download');
    await receiver.getByRole('button', { name: 'Accept file', exact: true }).click();
    const download = await downloadPromise;
    await expect(status(receiver)).toContainText('Transfer complete');
    await expect(status(sender)).toContainText('Transfer complete');
    expect(download.suggestedFilename()).toBe('empty.txt');
    expect((await readFile(await download.path())).length).toBe(0);
  });
});

test('declining stops both peers without downloading', async ({ page: sender, browser }) => {
  const url = await startTransfer(sender, {
    name: 'decline.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('do not send'),
  });
  await withReceiver(browser, url, async (receiver) => {
    const downloads = [];
    receiver.on('download', (download) => downloads.push(download));
    await expect(receiver.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
    await receiver.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(status(receiver)).toContainText('Transfer declined');
    await expect(status(sender)).toContainText('Transfer declined');
    expect(downloads).toHaveLength(0);
    await sender.getByRole('button', { name: 'Send another file', exact: true }).click();
    await expect(sender.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible();
  });
});

test('sender cancellation closes a connected invitation before acceptance', async ({
  page: sender,
  browser,
}) => {
  const url = await startTransfer(sender, {
    name: 'cancel.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('cancel me'),
  });
  await withReceiver(browser, url, async (receiver) => {
    const downloads = [];
    receiver.on('download', (download) => downloads.push(download));
    await expect(receiver.getByRole('button', { name: 'Accept file', exact: true })).toBeVisible();
    await sender.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    await expect(status(sender)).toContainText('Transfer cancelled');
    await expect(status(receiver)).toContainText('Transfer cancelled');
    await expect(receiver.getByRole('button', { name: 'Accept file', exact: true })).toBeHidden();
    expect(downloads).toHaveLength(0);
  });
});

test('cancelling an active transfer stops file reads and never downloads a partial file', async ({
  page: sender,
  browser,
}) => {
  await sender.addInitScript(() => {
    // A slow file read makes the cancellation window deterministic on fast CI.
    // File bytes and the actual WebRTC data channel remain unchanged.
    const arrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return arrayBuffer.call(this);
    };
    window.__sentFileBytes = 0;
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (typeof data !== 'string') window.__sentFileBytes += data.byteLength ?? data.size ?? 0;
      return send.call(this, data);
    };
  });
  const fileSize = 8 * 1024 * 1024;
  const url = await startTransfer(sender, {
    name: 'cancel-active.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(fileSize, 73),
  });
  await withReceiver(browser, url, async (receiver) => {
    const downloads = [];
    receiver.on('download', (download) => downloads.push(download));
    await receiver.getByRole('button', { name: 'Accept file', exact: true }).click();
    await expect.poll(() => sender.evaluate(() => window.__sentFileBytes)).toBeGreaterThan(0);
    await sender.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    await expect(status(sender)).toContainText('Transfer cancelled');
    await expect(status(receiver)).toContainText('Transfer cancelled');
    const sentBytes = await sender.evaluate(() => window.__sentFileBytes);
    expect(sentBytes).toBeLessThan(fileSize);
    expect(downloads).toHaveLength(0);
  });
});

test('closing the sender reports a disconnected peer without downloading', async ({
  page: sender,
  browser,
}) => {
  const url = await startTransfer(sender, {
    name: 'disconnect.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('keep both pages open'),
  });
  await withReceiver(browser, url, async (receiver) => {
    const downloads = [];
    receiver.on('download', (download) => downloads.push(download));
    await expect(receiver.getByRole('button', { name: 'Accept file', exact: true })).toBeVisible();
    await sender.close();
    await expect(status(receiver)).toContainText('Couldn’t complete the transfer');
    await expect(status(receiver)).toContainText(/disconnect|connection|left/i);
    expect(downloads).toHaveLength(0);
  });
});

for (const [label, suffix] of [
  ['missing', ''],
  ['malformed', '/not-a-session'],
  ['unknown', `/${randomUUID()}`],
]) {
  test(`${label} invitations explain the error and never offer acceptance`, async ({ page }) => {
    await page.goto(`/receive${suffix}`);
    await expect(status(page)).toContainText('Couldn’t complete the transfer');
    await expect(page.getByRole('button', { name: 'Accept file', exact: true })).toBeHidden();
    await expect(status(page)).toContainText(/invalid|missing|expired|new link|valid/i);
  });
}

test('sender has no horizontal overflow on phone, tablet, and desktop', async ({
  page,
}, testInfo) => {
  for (const [label, width, height] of [
    ['phone', 375, 812],
    ['tablet', 768, 1024],
    ['desktop', 1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.screenshot({
      path: testInfo.outputPath(`${label}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByLabel('Choose a file to send').setInputFiles({
      name: `${'a-long-unbroken-filename'.repeat(8)}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('responsive fixture'),
    });
    await expect(page.getByLabel('Transfer link', { exact: true })).toHaveValue(
      /\/receive\/[\da-f-]{36}/i,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
    await page.screenshot({
      path: testInfo.outputPath(`${label}-file-selected.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('fresh QR reuses the selected file and invalidates the old invitation', async ({
  page: sender,
  browser,
}) => {
  const first = await startTransfer(sender, {
    name: 'retry.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('retry contents'),
  });
  await sender.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
  await sender.getByRole('button', { name: 'Create new QR code', exact: true }).click();
  const link = sender.getByLabel('Transfer link', { exact: true });
  await expect(link).not.toHaveValue(first);
  await expect(link).toHaveValue(/\/receive\/[\da-f-]{36}/i);
  const second = await link.inputValue();
  expect(second).not.toBe(first);
  await withReceiver(browser, first, async (receiver) => {
    await expect(status(receiver)).toContainText(/missing|expired/i);
    await expect(
      receiver.getByRole('heading', { name: 'Start from the sender’s current QR code' }),
    ).toBeVisible();
  });
  await withReceiver(browser, second, async (receiver) => {
    const pending = receiver.waitForEvent('download');
    await receiver.getByRole('button', { name: 'Accept file', exact: true }).click();
    const download = await pending;
    expect((await readFile(await download.path())).toString()).toBe('retry contents');
  });
});

test('previewable file downloads as binary and explicit native save writes its bytes', async ({
  page: sender,
  browser,
}) => {
  const content = '%PDF-1.4\nquickdrop-save-regression\n%%EOF';
  const url = await startTransfer(sender, {
    name: 'document.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(content),
  });
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const receiver = await context.newPage();
    await receiver.addInitScript(() => {
      window.showSaveFilePicker = async (options) => {
        window.__saveName = options.suggestedName;
        return {
          createWritable: async () => ({
            write: async (file) => {
              window.__savedText = await file.text();
            },
            close: async () => {
              window.__saveClosed = true;
            },
            abort: async () => {},
          }),
        };
      };
    });
    await receiver.goto(`http://localhost:5173${new URL(url).pathname}`);
    const pending = receiver.waitForEvent('download');
    await receiver.getByRole('button', { name: 'Accept file', exact: true }).click();
    const automatic = await pending;
    expect(automatic.suggestedFilename()).toBe('document.pdf');
    expect((await readFile(await automatic.path())).toString()).toBe(content);
    const downloadLink = receiver.getByRole('link', { name: 'Download file', exact: true });
    await expect(downloadLink).toBeVisible();
    const type = await downloadLink.evaluate(async (link) =>
      (await fetch(link.href)).headers.get('content-type'),
    );
    expect(type).toBe('application/octet-stream');
    await receiver.getByRole('button', { name: 'Save to device', exact: true }).click();
    await expect.poll(() => receiver.evaluate(() => window.__saveClosed)).toBe(true);
    expect(await receiver.evaluate(() => window.__saveName)).toBe('document.pdf');
    expect(await receiver.evaluate(() => window.__savedText)).toBe(content);
  } finally {
    await context.close();
  }
});
