// cdp.mjs — capture a web page as a figma-layout document.
//
// Drives Edge or Chrome headless over the Chrome DevTools Protocol.
// No dependencies: Node 22+ ships a WebSocket client.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_SCRIPT = readFileSync(join(HERE, 'capture-page.js'), 'utf8');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

export function findBrowser() {
  const hit = CANDIDATES.find((p) => existsSync(p));
  if (!hit) throw new Error('Geen Edge of Chrome gevonden. Zet CHROME_PATH naar het uitvoerbare bestand.');
  return hit;
}

function launch(executable) {
  const profile = mkdtempSync(join(tmpdir(), 'figma-capture-'));
  // On Windows msedge.exe is a launcher: it starts the real browser as a
  // separate process and exits straight away. So we cannot read the DevTools
  // URL from its stderr, and killing it does not stop the browser. Chromium
  // writes the port to <profile>/DevToolsActivePort instead — we poll that.
  const proc = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
  proc.on('error', () => { /* reported through the timeout below */ });

  const portFile = join(profile, 'DevToolsActivePort');
  const wsUrl = (async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (existsSync(portFile)) {
        const [port, path] = readFileSync(portFile, 'utf8').split(/\r?\n/);
        if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
      }
      await sleep(100);
    }
    throw new Error('Browser startte niet binnen 20 s (geen DevToolsActivePort)');
  })();

  const close = () => {
    try { proc.kill(); } catch { /* launcher already gone */ }
    // Safety net for when Browser.close never arrived: stop every process
    // that runs on OUR temporary profile, and nothing else.
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { stdio: 'ignore' }).on('error', () => {});
    }
    // Edge keeps the profile locked for a moment after it exits.
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } }, 2500).unref();
  };
  return { wsUrl, close };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error('Kon niet verbinden met de browser')), { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        reject(new Error(`Timeout terwijl we wachtten op ${method}`));
      }, timeoutMs);
      const listener = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== listener);
          resolve(msg.params);
        }
      };
      this.listeners.push(listener);
    });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Capture a URL.
 * @param {object} o
 * @param {string} o.url
 * @param {number} [o.width=1440]
 * @param {number} [o.height=1000]
 * @param {boolean} [o.fullPage=true]   grow the viewport to the full document height
 * @param {'light'|'dark'} [o.theme]    emulate prefers-color-scheme
 * @param {number} [o.waitMs=1500]      extra wait for animations / data
 * @param {string} [o.selector]         capture only this element
 * @param {boolean} [o.autoLayout=true] convert flexbox to auto layout where faithful
 * @param {boolean} [o.screenshot=false] also return a PNG (base64)
 * @param {string} [o.name]             name of the root frame in Figma
 */
export async function captureUrl(o) {
  // Drop undefined values first: { width: 1440, ...{ width: undefined } }
  // would otherwise REPLACE the default with undefined, and the browser then
  // rejects the viewport ("Invalid parameters (-32602)"). Every MCP call that
  // leaves an optional argument out would hit that.
  const given = Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));
  const opts = { width: 1440, height: 1000, fullPage: true, waitMs: 1500, autoLayout: true, screenshot: false, ...given };
  if (!opts.url) throw new Error('url ontbreekt');

  const browser = launch(findBrowser());
  let cdp;
  try {
    cdp = await Cdp.open(await browser.wsUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);

    await s('Page.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });
    if (opts.theme) {
      await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.theme }] });
    }

    const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 45000);
    const nav = await s('Page.navigate', { url: opts.url });
    if (nav.errorText) throw new Error(`Pagina laden mislukt: ${nav.errorText} (${opts.url})`);
    await loaded;

    const evalJs = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(d.exception?.description || d.text || 'script error');
      }
      return r.result.value;
    };

    // The theme toggle in a page may have stored a choice; the emulated
    // media query only wins when nothing is pinned, so clear the pin.
    if (opts.theme) {
      await evalJs(`(() => { try { document.documentElement.removeAttribute('data-theme'); } catch (e) {} return true; })()`);
    }

    await evalJs('document.fonts ? document.fonts.ready.then(() => true) : true');
    await sleep(opts.waitMs);

    if (opts.fullPage) {
      const h = await evalJs('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
      if (h > opts.height) {
        await s('Emulation.setDeviceMetricsOverride', { width: opts.width, height: Math.min(h, 16000), deviceScaleFactor: 1, mobile: false });
        await sleep(400);
      }
    }

    await evalJs(PAGE_SCRIPT + '; true');
    const doc = await evalJs(`window.__figmaCapture(${JSON.stringify({ selector: opts.selector, autoLayout: opts.autoLayout, name: opts.name })})`);

    let screenshot = null;
    if (opts.screenshot) {
      const shot = await s('Page.captureScreenshot', { format: 'png' });
      screenshot = shot.data;
    }
    return { doc, screenshot };
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* ignore */ }
      cdp.close();
    }
    browser.close();
  }
}

/**
 * Open any page in a headless browser and keep it: for UI tests.
 * Returns { evaluate(js), screenshot(), errors, close() }.
 */
export async function openPage(url, { width = 520, height = 900, preload } = {}) {
  const browser = launch(findBrowser());
  const cdp = await Cdp.open(await browser.wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // Runs before the page's own scripts — like code.js, which is listening
  // before a plugin UI loads.
  if (preload) await s('Page.addScriptToEvaluateOnNewDocument', { source: preload });
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 30000);
  await s('Page.navigate', { url });
  await loaded;
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    evaluate,
    errors,
    screenshot: async () => (await s('Page.captureScreenshot', { format: 'png' })).data,
    close: async () => { try { await cdp.send('Browser.close'); } catch { /* ignore */ } cdp.close(); browser.close(); },
  };
}
