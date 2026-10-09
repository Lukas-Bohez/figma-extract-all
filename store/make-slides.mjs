// Builds 1920x1080 Figma Community carousel slides around the real plugin UI.
// usage:
//   cd %TEMP% && npm pack lucide-static && tar -xzf lucide-static-*.tgz   (icons in %TEMP%\package)
//   then, from the plugin folder: node store/make-slides.mjs . "%TEMP%\package" store/carousel
// Needs Microsoft Edge. Scratch files go to the system temp folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = join(tmpdir(), 'extract-all-slides');
const [, , pluginDir, lucideDir, outDir] = process.argv;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(join(here, 'plugin'), { recursive: true });
mkdirSync(outDir, { recursive: true });

// ── 1. demo copy of the real UI: picks tab/theme/state from the query string ──
const demo = `
<style>#logArea{display:none!important} body{overflow:hidden}</style>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  function go() {
    var b = document.querySelector('[data-tab="' + (q.get('tab') || 'import') + '"]'); if (b) b.click();
    if (q.get('theme') === 'dark' && !document.body.classList.contains('dark')) document.getElementById('themeToggle').click();
    if (q.get('theme') === 'light' && document.body.classList.contains('dark')) document.getElementById('themeToggle').click();
    if (q.get('state') === 'connected') {
      document.getElementById('xcDot').className = 'x-dot on';
      document.getElementById('xcState').textContent = 'Connected \\u2014 Claude can now work in \\u201cInteraction Design\\u201d';
      document.getElementById('xcToggle').innerHTML = ic('unplug') + 'Disconnect';
      document.getElementById('xcAuto').checked = true;
      var log = document.getElementById('xcLog'); log.innerHTML = '';
      [['13:35:49  Connected to the bridge', 'ok']]
        .forEach(function (l) { var d = document.createElement('div'); d.className = l[1]; d.textContent = l[0]; log.appendChild(d); });
    }
    setTimeout(function () {
      var w = document.querySelector('.wrap');
      parent.postMessage({ demoHeight: Math.ceil(w.getBoundingClientRect().bottom + 12), id: q.get('id') }, '*');
    }, 150);
  }
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
</script>`;
writeFileSync(join(here, 'plugin', 'ui-demo.html'), readFileSync(join(pluginDir, 'ui.html'), 'utf8').replace('</body>', demo + '\n</body>'));

// ── 2. Lucide icons for the slides ──
const icon = (name, size = 24, extra = '') => {
  const svg = readFileSync(join(lucideDir, 'icons', name + '.svg'), 'utf8');
  return svg.slice(svg.indexOf('<svg')).replace(/class="[^"]*"/, `class="ic" ${extra}`)
    .replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`).replace(/\s*\n\s*/g, ' ');
};

const win = (id, tab, theme, state = '', z = 1.3, extraStyle = '') => `
  <div class="win" id="w-${id}" style="--z:${z};${extraStyle}">
    <div class="chrome"><span class="appic">${icon('code-xml', 13)}</span><span>Extract All</span><span class="x">${icon('x', 15)}</span></div>
    <iframe src="plugin/ui-demo.html?id=${id}&tab=${tab}&theme=${theme}${state ? '&state=' + state : ''}" scrolling="no"></iframe>
  </div>`;

const page = (body, slideClass = '') => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=block" rel="stylesheet">
<style>
  :root { --ink:#1f2328; --muted:#5f6570; --accent:#1463ff; --accent2:#0f4fd1; --bg:#f6f3ee; }
  * { box-sizing:border-box; margin:0; }
  html,body { width:1920px; height:1080px; overflow:hidden; }
  body { font-family:Inter, "Segoe UI", system-ui, sans-serif; color:var(--ink); background:var(--bg); position:relative; -webkit-font-smoothing:antialiased; }
  .bg { position:absolute; inset:0; overflow:hidden; }
  .bg::before { content:""; position:absolute; width:1400px; height:1400px; right:-380px; top:-520px; border-radius:50%;
    background:radial-gradient(circle, rgba(20,99,255,.20), rgba(20,99,255,0) 62%); }
  .bg::after { content:""; position:absolute; width:1100px; height:1100px; left:-420px; bottom:-620px; border-radius:50%;
    background:radial-gradient(circle, rgba(130,80,223,.12), rgba(130,80,223,0) 62%); }
  .dots { position:absolute; inset:0; background-image:radial-gradient(rgba(31,35,40,.09) 1.4px, transparent 1.6px); background-size:28px 28px;
    -webkit-mask-image:linear-gradient(90deg, transparent 0%, #000 45%, #000 100%); }
  .copy { position:absolute; left:120px; top:0; bottom:0; width:720px; display:flex; flex-direction:column; justify-content:center; gap:28px; z-index:2; }
  .chip { align-self:flex-start; display:inline-flex; align-items:center; gap:10px; padding:10px 18px; border-radius:999px; background:#fff;
    border:1px solid rgba(31,35,40,.10); color:var(--accent); font-weight:700; font-size:22px; box-shadow:0 4px 14px rgba(31,35,40,.06); }
  h1 { font-size:76px; line-height:1.04; letter-spacing:-0.035em; font-weight:800; }
  h1 em { font-style:normal; background:linear-gradient(135deg,var(--accent),#7c4dff); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { font-size:30px; line-height:1.4; color:var(--muted); max-width:680px; }
  ul.pts { list-style:none; padding:0; display:flex; flex-direction:column; gap:18px; margin-top:6px; }
  ul.pts li { display:flex; gap:16px; align-items:flex-start; font-size:27px; line-height:1.35; font-weight:500; }
  ul.pts li .ic { flex-shrink:0; margin-top:3px; color:var(--accent); }
  .ic { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .brand { position:absolute; left:120px; bottom:56px; display:flex; align-items:center; gap:12px; font-size:20px; font-weight:600; color:var(--muted); z-index:2; }
  .brand .appic { width:30px; height:30px; border-radius:8px; }
  .stage { position:absolute; top:0; bottom:0; right:0; left:860px; z-index:1; }
  .win { position:absolute; width:calc(520px * var(--z)); border-radius:calc(14px * var(--z)); overflow:hidden; background:#fff;
    box-shadow:0 2px 6px rgba(31,35,40,.08), 0 30px 80px -10px rgba(16,24,40,.28), 0 0 0 1px rgba(31,35,40,.10); }
  .chrome { height:calc(40px * var(--z)); display:flex; align-items:center; gap:calc(9px * var(--z)); padding:0 calc(14px * var(--z));
    font:600 calc(13px * var(--z)) "Segoe UI", system-ui, sans-serif; color:#1f2328; border-bottom:1px solid rgba(31,35,40,.10); background:#fff; }
  .appic { display:inline-flex; align-items:center; justify-content:center; width:calc(22px * var(--z)); height:calc(22px * var(--z));
    border-radius:calc(6px * var(--z)); background:#1f2328; color:#fff; }
  .appic svg { width:62%; height:62%; }
  .chrome .x { margin-left:auto; display:inline-flex; color:#1f2328; } .chrome .x svg { width:calc(15px * var(--z)); height:calc(15px * var(--z)); }
  .win iframe { display:block; border:0; width:520px; height:600px; zoom:var(--z); }
  .center-v { top:50%; transform:translateY(-50%); }
  .pills { display:flex; flex-wrap:wrap; gap:14px; max-width:720px; }
  .pill { display:inline-flex; align-items:center; gap:10px; padding:12px 18px; border-radius:14px; background:#fff; font-size:22px; font-weight:600;
    border:1px solid rgba(31,35,40,.10); box-shadow:0 4px 14px rgba(31,35,40,.05); }
  .pill .ic { color:var(--accent); }
  .note { font-size:20px; color:var(--muted); }
</style></head><body class="${slideClass}">
<div class="bg"><div class="dots"></div></div>
${body}
<div class="brand"><span class="appic">${icon('code-xml', 16)}</span>Extract All &middot; Figma plugin</div>
<script>
  // size each window to its content, like the plugin UI that fits its panel
  addEventListener('message', function (e) {
    if (!e.data || !e.data.demoHeight) return;
    var w = document.getElementById('w-' + e.data.id); if (!w) return;
    w.querySelector('iframe').style.height = Math.max(300, Math.min(e.data.demoHeight, 820)) + 'px';
    w.dataset.ready = '1';
  });
</script>
</body></html>`;

const copy = (chipIcon, chip, h1, sub, pts, extra = '') => `
<div class="copy">
  <span class="chip">${icon(chipIcon, 24)}${chip}</span>
  <h1>${h1}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ''}
  <ul class="pts">${pts.map((p) => `<li>${icon('circle-check', 30)}<span>${p}</span></li>`).join('')}</ul>
  ${extra}
</div>`;

// single window: right side, vertically centered
const one = (id, tab, theme, state, z, top = 'center') =>
  win(id, tab, theme, state, z, `left:50%; ${top === 'center' ? 'top:50%; transform:translate(-50%,-50%);' : top}`);
// pair: light window behind, dark window in front
const pair = (tab, z = 1.2) =>
  win(tab + 'L', tab, 'light', '', z, 'left:0px; top:110px;') +
  win(tab + 'D', tab, 'dark', '', z, 'left:410px; top:290px;');

const slides = [
  ['01-overview', page(`
<div class="copy">
  <h1>Extract All<br><em>Lottie, AI Export &amp; Design Audit</em></h1>
  <p class="sub">Get things in and out of Figma: Lottie animations in, everything an AI coding tool or After Effects needs out, and a design audit on top.</p>
  <div class="pills">
    <span class="pill">${icon('import', 24)}Lottie import</span>
    <span class="pill">${icon('bot', 24)}AI export</span>
    <span class="pill">${icon('clapperboard', 24)}After Effects</span>
    <span class="pill">${icon('package', 24)}Assets</span>
    <span class="pill">${icon('list-checks', 24)}Design audit</span>
    <span class="pill">${icon('hammer', 24)}Web to layers</span>
  </div>
</div>
<div class="stage">
  ${win('ov1', 'import', 'light', '', 0.95, 'left:20px; top:110px;')}
  ${win('ov2', 'build', 'light', '', 0.95, 'left:285px; top:215px;')}
  ${win('ov3', 'ai', 'dark', '', 0.95, 'left:540px; top:320px;')}
</div>`)],
  ['02-lottie-import', page(copy('import', 'Lottie Import', 'Check a Lottie <em>before</em> you use it',
    'Drop a Lottie or Bodymovin JSON file.',
    ['Animation info, layer tree and statistics', 'Bodymovin export settings checked, with fixes', 'Rendered frame by frame into an animated GIF on your canvas']) +
    `<div class="stage">${pair('import')}</div>`)],
  ['03-ai-export', page(copy('bot', 'AI Export', 'Hand your design to an <em>AI coding tool</em>',
    'One ZIP for Cursor, Claude, ChatGPT or v0.',
    ['SVGs, plus text with colors, fonts and positions', 'Variables, styles and components', 'The layer hierarchy and a plain text dump']) +
    `<div class="stage">${pair('ai')}</div>`)],
  ['04-after-effects', page(copy('clapperboard', 'After Effects Export', 'Rebuild the scene in <em>After Effects</em>',
    'Everything you need to recreate a frame as a composition.',
    ['SVGs of your layers', 'A JSON with every position', 'All text content']) +
    `<div class="stage">${pair('ae')}</div>`)],
  ['05-assets', page(copy('package', 'Assets', 'Any asset, <em>any size</em>', '',
    ['SVG, PNG or JPG of the selection, at any scale', 'Batch export a page or all pages', 'Variables, styles, components and pages as JSON']) +
    `<div class="stage">${one('as', 'assets', 'light', '', 1.45)}</div>`)],
  ['06-design-audit', page(copy('list-checks', 'Design Audit', 'Audit your <em>design system</em>',
    'Checks a file the way a design reviewer would.',
    ['Padding and gaps on a 4/8 px grid', 'Variables in two layers, and how many fills really use them', 'Text styles, variant names and auto layout coverage']) +
    `<div class="stage">${one('ru', 'rubric', 'light', '', 1.45)}</div>`)],
  ['07-build', page(copy('hammer', 'Build', 'Turn a web page into <em>editable layers</em>',
    'Import a captured page: React, HTML, localhost or online.',
    ['Frames with auto layout from flexbox', 'Styled text, SVGs and shadows', 'Capture with the free open-source tool or bookmarklet']) +
    `<div class="stage">${one('bu', 'build', 'light', '', 1.3)}</div>`)],
  ['08-claude-bridge', page(copy('plug', 'For developers', 'Let <em>Claude</em> work in your file',
    'A local MCP server with 25 tools, in the open-source version on GitHub.',
    ['Read, check and build in the open file', 'Capture web pages and set prototype hover', 'Runs on your own computer only'],
    '<p class="note">Requires running the plugin from its manifest (Plugins &rarr; Development).</p>') +
    `<div class="stage">${one('cl', 'claude', 'light', 'connected', 1.16)}</div>`)],
];

for (const [name, html] of slides) {
  const file = join(here, name + '.html');
  writeFileSync(file, html);
  const png = join(outDir, name + '.png');
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--force-device-scale-factor=1', '--window-size=1920,1080', '--virtual-time-budget=6000',
    '--screenshot=' + png, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log('ok', name);
}
