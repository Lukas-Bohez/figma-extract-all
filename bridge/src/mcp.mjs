// mcp.mjs — the MCP server: every Figma capability as a tool for Claude
// (or any MCP client: Claude Code, Claude Desktop, Cursor, VS Code, ...).

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotConnectedError } from './hub.mjs';
import { captureUrl } from './capture/cdp.mjs';
import { auditContrast } from './capture/contrast.mjs';

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({
  isError: true,
  content: [{ type: 'text', text: e instanceof NotConnectedError ? e.message : `Fout: ${e && e.message ? e.message : e}` }],
});

const ids = z.array(z.string()).optional().describe('Figma node ids. Leeg = de huidige selectie in Figma.');
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

// A property bag the way an LLM naturally describes a layer.
const props = {
  name: z.string().optional(),
  x: z.number().optional(), y: z.number().optional(),
  width: z.number().optional(), height: z.number().optional(),
  visible: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(),
  fill: z.string().optional().describe('Kleur als #rrggbb, #rrggbbaa of rgb(). "none" = geen vulling.'),
  stroke: z.union([z.string(), z.object({ color: z.string(), weight: z.number().optional(), align: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional() })]).optional(),
  cornerRadius: z.number().optional(),
  layout: z.object({
    mode: z.enum(['HORIZONTAL', 'VERTICAL', 'NONE']).optional(),
    gap: z.number().optional(),
    padding: z.union([z.number(), z.array(z.number())]).optional().describe('Eén getal, [verticaal, horizontaal] of [top, rechts, onder, links].'),
    primary: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
    counter: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']).optional(),
    wrap: z.boolean().optional(),
  }).optional().describe('Auto layout.'),
  sizing: z.object({ h: z.enum(['FIXED', 'HUG', 'FILL']).optional(), v: z.enum(['FIXED', 'HUG', 'FILL']).optional() }).optional()
    .describe('Gedrag binnen een auto-layout-ouder.'),
  text: z.string().optional(), fontSize: z.number().optional(), fontFamily: z.string().optional(),
  fontWeight: z.number().optional(), lineHeight: z.union([z.number(), z.literal('auto')]).optional(),
  textAlign: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional(),
  shadow: z.object({ x: z.number().optional(), y: z.number().optional(), blur: z.number().optional(), spread: z.number().optional(), color: z.string().optional() }).nullable().optional(),
};

export function createMcpServer(hub, { log = () => {} } = {}) {
  const server = new McpServer({ name: 'figma-extract-all', version: '1.0.0' });

  const cmd = (name, params, timeoutMs) => hub.send(name, params, timeoutMs);
  const tool = (name, description, inputSchema, annotations, handler) =>
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      try { return await handler(args || {}); } catch (e) { log(`${name}: ${e.message}`); return fail(e); }
    });

  // ── reading ──────────────────────────────────────────────────────────
  tool('figma_status', 'Is de Figma-plugin verbonden? Toont bestand, pagina en huidige selectie. Begin hier.', {}, READ,
    async () => {
      const st = await hub.status();
      if (!st.plugin) return text({ ...st, hint: 'Open "Extract All" in Figma desktop, tab "Claude", klik Verbinden.' });
      return text({ ...st, figma: await cmd('status') });
    });

  tool('figma_get_document', 'Alle pagina\'s en hun lagen op het hoogste niveau (id, naam, type, grootte).', {}, READ,
    async () => text(await cmd('get_document')));

  tool('figma_get_selection', 'Wat er in Figma geselecteerd is, met eigenschappen (vulling, auto layout, tekst, gebonden variabelen).',
    { depth: z.number().int().min(0).max(6).optional().describe('Hoe diep kinderen tonen (standaard 1).') }, READ,
    async ({ depth }) => text(await cmd('get_selection', { depth })));

  tool('figma_get_node', 'Details van lagen: positie, maat, vullingen (hex + variabele), randen, radius, auto layout, sizing, tekst, tekststijl, variant.',
    { ids, depth: z.number().int().min(0).max(6).optional().describe('Diepte van de kinderen (standaard 2).') }, READ,
    async (a) => text(await cmd('get_node', a)));

  tool('figma_screenshot', 'Render lagen als PNG zodat je het ontwerp kan ZIEN. Zonder ids: de selectie, anders het eerste frame op de pagina.',
    { ids, scale: z.number().min(0.1).max(4).optional(), maxSize: z.number().int().min(200).max(4096).optional().describe('Langste zijde in px (standaard 1600).') }, READ,
    async (a) => {
      const r = await cmd('screenshot', a, 120000);
      return {
        content: [
          ...r.images.map((im) => ({ type: 'image', data: im.base64, mimeType: 'image/png' })),
          { type: 'text', text: r.images.map((im) => `${im.name} (${im.id}) ${im.width}x${im.height}`).join('\n') },
        ],
      };
    });

  tool('figma_get_variables', 'Alle variabelecollecties met modes (bv. Light/Dark) en waarden per mode; aliassen op naam.', {}, READ,
    async () => text(await cmd('get_variables')));

  tool('figma_get_styles', 'Lokale tekst-, kleur- en effectstijlen.', {}, READ,
    async () => text(await cmd('get_styles')));

  tool('figma_rubric_check',
    'Kijk het bestand na op een designrubric: 8px-grid (padding/gap), variabelen in 2 lagen met modes, of kleuren echt aan variabelen gebonden zijn, lokale tekststijlen, generieke variantnamen, auto-layout-dekking, lettergroottes buiten de schaal.',
    {}, READ, async () => text(await cmd('rubric_check', {}, 120000)));

  // ── building ─────────────────────────────────────────────────────────
  tool('figma_create', 'Maak een laag: FRAME, RECTANGLE, ELLIPSE, TEXT of SVG. Geef parentId om in een frame te plaatsen.',
    {
      kind: z.enum(['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'SVG']),
      parentId: z.string().optional(),
      svg: z.string().optional().describe('SVG-markup voor kind SVG.'),
      ...props,
    }, WRITE,
    async (a) => text(await cmd('create', a)));

  tool('figma_update', 'Wijzig eigenschappen van bestaande lagen (naam, maat, positie, vulling, rand, radius, auto layout, sizing, tekst, schaduw).',
    { ids, props: z.object(props) }, WRITE,
    async (a) => text(await cmd('update', a)));

  tool('figma_delete', 'Verwijder lagen.', { ids }, { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async (a) => text(await cmd('delete', a)));

  tool('figma_create_component', 'Zet frames om naar components.',
    { ids, name: z.string().optional().describe('Voor varianten: "variant=primary, size=md".') }, WRITE,
    async (a) => text(await cmd('create_component', a)));

  tool('figma_combine_as_variants',
    'Voeg components samen tot een component set met varianten. Geef de components namen als "variant=primary, size=md" zodat de properties betekenis hebben (geen "Property 1 = Variant2").',
    { ids: z.array(z.string()).min(2), name: z.string().optional() }, WRITE,
    async (a) => text(await cmd('combine_as_variants', a)));

  tool('figma_create_variables',
    'Maak of werk variabelen bij in een collectie, met modes (bv. Light en Dark). Een waarde {"alias": "base/grey/950"} maakt een alias: zo bouw je de tweede, semantische laag.',
    {
      collection: z.string(),
      modes: z.array(z.string()).optional().describe('Bv. ["Light", "Dark"]. De eerste hernoemt "Mode 1".'),
      variables: z.array(z.object({
        name: z.string().describe('Met slashes voor groepen: "semantic/text/primary".'),
        type: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']).optional(),
        value: z.any().optional().describe('Eén waarde voor de eerste mode.'),
        values: z.record(z.string(), z.any()).optional().describe('Per mode: {"Light": "#fff", "Dark": {"alias": "base/grey/950"}}.'),
        scopes: z.array(z.string()).optional(),
      })),
    }, WRITE,
    async (a) => text(await cmd('create_variables', a)));

  tool('figma_bind_variable',
    'Koppel een variabele aan een eigenschap, zodat het ontwerp de tokens echt GEBRUIKT. field: "fill", "stroke", of paddingLeft/paddingRight/paddingTop/paddingBottom/itemSpacing/cornerRadius/width/height/opacity/strokeWeight.',
    { ids, field: z.string(), variable: z.string().describe('Naam of id van de variabele.') }, WRITE,
    async (a) => text(await cmd('bind_variable', a)));

  tool('figma_apply_text_style', 'Pas een lokale tekststijl toe op tekstlagen.',
    { ids, style: z.string().describe('Naam (bv. "text/sm") of id.') }, WRITE,
    async (a) => text(await cmd('apply_text_style', a)));

  tool('figma_create_spacing_variables', 'Maak de 8px-grid-variabelen space/1..8 (4-64 px) en radius/* aan in een collectie "primitives". Slaat bestaande over.', {}, WRITE,
    async () => text(await cmd('create_spacing_variables')));

  tool('figma_create_text_styles', 'Maak de typeschaal text/xs..text/3xl (12-36 px, Inter) als lokale tekststijlen. Slaat bestaande over.', {}, WRITE,
    async () => text(await cmd('create_text_styles')));

  tool('figma_select', 'Selecteer lagen in Figma en zoom erop in, zodat de gebruiker ziet waar je het over hebt.',
    { ids: z.array(z.string()).min(1), zoom: z.boolean().optional() }, READ,
    async (a) => text(await cmd('set_selection', a)));

  tool('figma_notify', 'Toon een korte melding onderaan in Figma.', { message: z.string().max(200) }, READ,
    async (a) => text(await cmd('notify', a)));

  // ── web pages -> Figma ───────────────────────────────────────────────
  tool('figma_import_layout',
    'Importeer een figma-layout JSON (gemaakt door capture / capture_webpage) als bewerkbare Figma-lagen. Geef path (bestand op deze pc) of doc.',
    {
      path: z.string().optional(), doc: z.any().optional(),
      autoLayout: z.boolean().optional().describe('Flexbox omzetten naar auto layout waar dat getrouw kan (standaard ja).'),
      x: z.number().optional(), y: z.number().optional(), name: z.string().optional(),
    }, WRITE,
    async ({ path, doc, ...options }) => {
      const d = doc || (path ? JSON.parse(readFileSync(path, 'utf8')) : null);
      if (!d) throw new Error('Geef path of doc mee.');
      return text(await cmd('import_layout', { doc: d, options }, 300000));
    });

  tool('figma_capture_webpage',
    'Render een web-pagina (React, HTML, localhost of online) in een echte browser en zet ze om naar bewerkbare Figma-lagen: frames met auto layout uit flexbox, tekst met stijlen, SVG\'s, schaduwen. theme "both" maakt een licht én donker frame naast elkaar.',
    {
      url: z.string().url(),
      theme: z.enum(['light', 'dark', 'both']).optional(),
      width: z.number().int().min(320).max(3840).optional().describe('Viewportbreedte (standaard 1440).'),
      fullPage: z.boolean().optional(),
      selector: z.string().optional().describe('Alleen dit element (CSS-selector).'),
      autoLayout: z.boolean().optional(),
      importToFigma: z.boolean().optional().describe('Standaard ja. Nee = alleen vastleggen en samenvatten.'),
      includeScreenshot: z.boolean().optional().describe('Voeg een screenshot van de pagina toe (standaard ja).'),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async (a) => {
      const themes = a.theme === 'both' ? ['light', 'dark'] : [a.theme];
      const content = [];
      const summary = [];
      for (const theme of themes) {
        const { doc, screenshot } = await captureUrl({
          url: a.url, theme, width: a.width, fullPage: a.fullPage, selector: a.selector,
          autoLayout: a.autoLayout !== false, screenshot: a.includeScreenshot !== false,
        });
        const entry = { theme: doc.source.colorScheme, counts: doc.counts, size: `${doc.root.w}x${doc.root.h}`, warnings: doc.warnings.slice(0, 5) };
        if (a.importToFigma !== false) entry.figma = await cmd('import_layout', { doc, options: { autoLayout: a.autoLayout !== false } }, 300000);
        summary.push(entry);
        if (screenshot) content.push({ type: 'image', data: screenshot, mimeType: 'image/png' });
      }
      content.push({ type: 'text', text: JSON.stringify({ url: a.url, results: summary }, null, 2) });
      return { content };
    });

  tool('web_contrast_audit',
    'Meet het WCAG-contrast van ELKE tekstlaag van een web-pagina tegen de achtergrond waar ze echt op staat (ook door transparantie heen). Geen aanname: rendert in een echte browser. Heeft Figma niet nodig.',
    { url: z.string().url(), theme: z.enum(['light', 'dark']).optional(), width: z.number().int().optional() }, { readOnlyHint: true, openWorldHint: true },
    async (a) => {
      const { doc } = await captureUrl({ url: a.url, theme: a.theme, width: a.width });
      return text({ theme: doc.source.colorScheme, ...auditContrast(doc) });
    });

  return server;
}
