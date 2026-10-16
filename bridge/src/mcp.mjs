// mcp.mjs — the MCP server: every Figma capability as a tool for Claude
// (or any MCP client: Claude Code, Claude Desktop, Cursor, VS Code, ...).

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { NotConnectedError, AmbiguousTargetError } from './hub.mjs';
import { saveExport } from './export.mjs';
import { captureUrl } from './capture/cdp.mjs';
import { auditContrast } from './capture/contrast.mjs';
import { readOwnerKey, withOwnerKey } from './owner.mjs';

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({
  isError: true,
  content: [{ type: 'text', text: e instanceof NotConnectedError || e instanceof AmbiguousTargetError ? e.message : `Fout: ${e && e.message ? e.message : e}` }],
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
  stroke: z.union([z.string(), z.object({
    color: z.string(), weight: z.number().optional(), align: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional(),
    cap: z.enum(['NONE', 'ROUND', 'SQUARE']).optional(), join: z.enum(['MITER', 'BEVEL', 'ROUND']).optional(),
    dash: z.array(z.number()).optional().describe('Streeppatroon, bv. [4, 4].'),
  })]).optional(),
  cornerRadius: z.number().optional(),
  rotation: z.number().optional().describe('Graden.'),
  clip: z.boolean().optional().describe('Inhoud buiten het frame afknippen.'),
  arc: z.object({ start: z.number(), end: z.number(), inner: z.number().min(0).max(1).optional() }).optional()
    .describe('Alleen ELLIPSE: begin- en eindhoek in radialen en de binnenstraal (0-1) voor een ring of taartpunt.'),
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

export function createMcpServer(hub, { log = () => {}, ownerKey = readOwnerKey() } = {}) {
  const server = new McpServer({ name: 'figma-extract-all', version: '1.0.0' });

  // The owner key rides along with the owner commands only
  const cmd = (name, params, timeoutMs) => hub.send(name, withOwnerKey(name, params, ownerKey), timeoutMs);
  const tool = (name, description, inputSchema, annotations, handler) =>
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      try { return await handler(args || {}); } catch (e) { log(`${name}: ${e.message}`); return fail(e); }
    });

  // ── reading ──────────────────────────────────────────────────────────
  tool('figma_status', 'Is de Figma-plugin verbonden? Toont bestand, pagina en huidige selectie. Begin hier. Bij meerdere verbonden bestanden: kies er een met figma_use_file.', {}, READ,
    async () => {
      const st = await hub.status();
      if (!st.plugin) return text({ ...st, hint: 'Open "Extract All" in Figma desktop, tab "Claude", klik Verbinden.' });
      if (st.ambiguous) return text({ ...st, hint: 'Meerdere Figma-bestanden zijn verbonden en er is er geen gekozen. Gebruik figma_use_file met de naam van het bestand waarin je wil werken.' });
      return text({ ...st, figma: await cmd('status') });
    });

  tool('figma_use_file',
    'Meerdere Figma-bestanden kunnen tegelijk verbonden zijn (een plugin-venster per bestand). Zonder argumenten: toon welke. Met file: kies het bestand waar alle volgende opdrachten naartoe gaan. Met unpin: wis de keuze. Doe dit altijd voor je gaat bouwen als er meer dan een bestand openstaat.',
    { file: z.string().optional().describe('Naam van het Figma-bestand (hoofdletterongevoelig) of de id uit de lijst.'), unpin: z.boolean().optional() }, WRITE,
    async ({ file, unpin }) => {
      if (unpin) return text(await cmd('hub.unpin'));
      if (file) return text(await cmd('hub.use', { file }));
      return text(await cmd('hub.files'));
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
  tool('figma_create', 'Maak een laag: FRAME, RECTANGLE, ELLIPSE, TEXT, VECTOR of SVG. Geef parentId om in een frame te plaatsen.',
    {
      kind: z.enum(['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'VECTOR', 'SVG']),
      parentId: z.string().optional(),
      svg: z.string().optional().describe('SVG-markup voor kind SVG.'),
      path: z.string().optional().describe('SVG-padgegevens voor kind VECTOR, bv. "M0 0 L40 20". Lijnen en vlakken, kleur via stroke/fill.'),
      windingRule: z.enum(['NONZERO', 'EVENODD']).optional(),
      ...props,
    }, WRITE,
    async (a) => text(await cmd('create', a)));

  tool('figma_build',
    'Bouw een hele boom van lagen in een keer, met kleuren, randen, radius, spacing en tekststijlen gebonden aan variabelen en stijlen op NAAM. Elke node: { kind: FRAME|RECTANGLE|ELLIPSE|TEXT|VECTOR, name, key?, x, y, width, height, layout, sizing, fill/stroke (vaste kleur) of fillVar/strokeVar (variabele, bv. "color/chart/fiets"), vars: {cornerRadius|padding|itemSpacing|strokeWeight: "radius/md"}, textStyle: "title", text, path (VECTOR), arc (ELLIPSE), children: [...] }. Geeft de id van elke node met een key terug. Mislukt iets, dan wordt alles van die build teruggedraaid.',
    {
      tree: z.union([z.record(z.string(), z.any()), z.array(z.record(z.string(), z.any()))]).describe('Een node of een lijst nodes (de wortels).'),
      parentId: z.string().optional().describe('Frame waarin de wortel(s) komen. Leeg = de huidige pagina.'),
      x: z.number().optional(), y: z.number().optional(),
      replaceByName: z.boolean().optional().describe('Verwijder eerst lagen met dezelfde naam in de ouder, zodat je een build opnieuw kan draaien.'),
    }, WRITE,
    async (a) => text(await cmd('build', a, 300000)));

  tool('figma_set_page', 'Ga naar een pagina van het bestand (op naam of id). Met create wordt ze aangemaakt als ze nog niet bestaat.',
    { name: z.string(), create: z.boolean().optional() }, WRITE,
    async (a) => text(await cmd('set_page', a)));

  tool('figma_export',
    'Exporteer lagen naar bestanden op deze pc: PNG, JPG, SVG, PDF of de REST-JSON van een laag. Een .fig-bestand kan geen plugin maken: dat is Bestand > Lokale kopie opslaan in Figma zelf. Zonder ids: de selectie.',
    {
      ids, format: z.enum(['PNG', 'JPG', 'SVG', 'PDF', 'JSON_REST_V1']).optional().describe('Standaard PNG.'),
      scale: z.number().min(0.1).max(4).optional().describe('Voor PNG en JPG (standaard 2).'),
      dir: z.string().optional().describe('Map om in op te slaan (wordt aangemaakt). Standaard ./figma-export.'),
      outlineText: z.boolean().optional().describe('SVG: tekst als paden (standaard ja).'),
    }, WRITE,
    async (a) => {
      const { dir, ...params } = a;
      const r = await cmd('export', params, 180000);
      return text({ dir: resolve(dir || 'figma-export'), saved: saveExport(r.files, dir || 'figma-export') });
    });

  tool('figma_set_code_syntax',
    'Zet de code syntax (Dev Mode) van variabelen: map { "color/text/low": "var(--color-text-low)" }.',
    { map: z.record(z.string(), z.string()), platform: z.enum(['WEB', 'ANDROID', 'iOS']).optional() }, WRITE,
    async (a) => text(await cmd('set_code_syntax', a)));

  tool('figma_delete_variables', 'Verwijder variabelen op naam en/of hele collecties.',
    { names: z.array(z.string()).optional(), collections: z.array(z.string()).optional() },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async (a) => text(await cmd('delete_variables', a)));

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

  tool('figma_duplicate',
    'Dupliceer lagen naast het origineel. Een gedupliceerde variant blijft in zijn component set: zo maak je een hover-variant (daarna hernoemen naar bv. "state=hover" en de vulling aanpassen of binden).',
    { ids, props: z.object(props).optional().describe('Eigenschappen voor de kopie, bv. {"name": "state=hover"}.') }, WRITE,
    async (a) => text(await cmd('duplicate', a)));

  tool('figma_set_hover',
    'Prototype-hover: zet op elke rusttoestand-variant (bv. state=default) "While hovering → Change to" de hover-variant met dezelfde andere properties. Werkt op component sets, hun varianten of instances; met deep op een heel scherm. Figma zet de variant zelf terug als de muis weggaat. Geeft per set terug wat gekoppeld is en welke varianten nog geen hover-tegenhanger hebben.',
    {
      ids,
      deep: z.boolean().optional().describe('Alle instances BINNEN de gegeven lagen (bv. een heel scherm) meenemen. Wat niet kan, staat in "skipped" met de reden.'),
      property: z.string().optional().describe('Variant-property, bv. "state". Standaard: de property die een waarde "hover" heeft.'),
      from: z.string().optional().describe('Rusttoestand, bv. "default". Standaard: default/rest/normal/idle/base.'),
      to: z.string().optional().describe('Hover-waarde (standaard "hover").'),
      transition: z.enum(['smart', 'dissolve', 'instant']).optional().describe('Standaard smart animate.'),
      duration: z.number().min(0).max(2000).optional().describe('Milliseconden (standaard 150).'),
      easing: z.enum(['EASE_OUT', 'EASE_IN', 'EASE_IN_AND_OUT', 'LINEAR', 'GENTLE', 'QUICK']).optional(),
    }, WRITE,
    async (a) => text(await cmd('set_hover', a)));

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
        codeSyntax: z.string().optional().describe('Web code syntax, bv. "var(--color-text-low)".'),
        description: z.string().optional(),
      })),
    }, WRITE,
    async (a) => text(await cmd('create_variables', a)));

  tool('figma_bind_variable',
    'Koppel een variabele aan een eigenschap, zodat het ontwerp de tokens echt GEBRUIKT. field: "fill", "stroke", of paddingLeft/paddingRight/paddingTop/paddingBottom/itemSpacing/cornerRadius/width/height/opacity/strokeWeight.',
    { ids, field: z.string().describe('fill, stroke, cornerRadius, padding of een veld uit de lijst hierboven.'), variable: z.string().describe('Naam of id van de variabele.') }, WRITE,
    async (a) => text(await cmd('bind_variable', a)));

  tool('figma_apply_text_style', 'Pas een lokale tekststijl toe op tekstlagen.',
    { ids, style: z.string().describe('Naam (bv. "text/sm") of id.') }, WRITE,
    async (a) => text(await cmd('apply_text_style', a)));

  tool('figma_create_spacing_variables', 'Maak de 8px-grid-variabelen space/1..8 (4-64 px) en radius/* aan in een collectie "primitives". Slaat bestaande over.', {}, WRITE,
    async () => text(await cmd('create_spacing_variables')));

  tool('figma_text_inventory', 'Tel alle tekstlagen per lettertype, grootte, gewicht en regelhoogte (plus hoeveel al een stijl hebben).',
    { ids }, READ,
    async (a) => text(await cmd('text_inventory', a)));

  tool('figma_create_text_styles_bulk', 'Maak of herdefinieer lokale tekststijlen met gewicht: [{ name, size, weight, lineHeightPercent }].',
    { styles: z.array(z.object({ name: z.string(), size: z.number(), weight: z.number().optional(), family: z.string().optional(), lineHeightPercent: z.number().optional(), lineHeightPx: z.number().optional() })), update: z.boolean().optional() }, WRITE,
    async (a) => text(await cmd('create_text_styles_bulk', a)));

  tool('figma_apply_text_styles_auto', 'Pas lokale tekststijlen toe op alle tekstlagen door te matchen op grootte en gewicht: rules [{ size, weight, style }]. dryRun telt enkel.',
    { rules: z.array(z.object({ size: z.number(), weight: z.number(), style: z.string() })), ids, dryRun: z.boolean().optional(), onlyUnstyled: z.boolean().optional(), skipInstances: z.boolean().optional(), limit: z.number().optional() }, WRITE,
    async (a) => text(await cmd('apply_text_styles_auto', a)));

  tool('figma_layer_audit', 'Feiten voor de rubric: generieke laagnamen, frames zonder auto layout, spacing buiten het 4 px-raster en kleuren zonder variabele (enkel lagen buiten instanties).',
    { max: z.number().optional() }, READ,
    async (a) => text(await cmd('layer_audit', a)));

  tool('figma_bind_raw_colors', 'Koppel ongebonden effen vullingen en randen met een exacte kleur aan een variabele: map { "#999999": "text/muted" }. dryRun telt enkel.',
    { map: z.record(z.string(), z.string()), ids, dryRun: z.boolean().optional(), limit: z.number().optional() }, WRITE,
    async (a) => text(await cmd('bind_raw_colors', a)));

  tool('figma_snap_to_grid', 'Rond padding en gap buiten het 4 px-raster af naar het raster (lagen buiten instanties). dryRun telt enkel.',
    { ids, dryRun: z.boolean().optional(), limit: z.number().optional() }, WRITE,
    async (a) => text(await cmd('snap_to_grid', a)));

  tool('figma_create_text_styles', 'Maak de typeschaal text/xs..text/3xl (12-36 px, Inter) als lokale tekststijlen. Slaat bestaande over.', {}, WRITE,
    async () => text(await cmd('create_text_styles')));

  tool('figma_select', 'Selecteer lagen in Figma en zoom erop in, zodat de gebruiker ziet waar je het over hebt.',
    { ids: z.array(z.string()).min(1), zoom: z.boolean().optional() }, READ,
    async (a) => text(await cmd('set_selection', a)));

  tool('figma_get_components', 'Lijst van de components en component sets in het bestand, met hun varianten en ids. Gebruik dit om figma_create_instance te vullen.', {}, READ,
    async () => text(await cmd('get_components')));

  tool('figma_create_instance',
    'Plaats een instance van een component (of van één variant uit een component set) in een frame, met tekst-overrides per laagnaam. Zo gebruik je je components echt in de schermen.',
    {
      componentId: z.string().describe('Id van de component of van de component set.'),
      variant: z.record(z.string(), z.string()).optional().describe('Bij een set: {"variant": "primary", "size": "md"}.'),
      parentId: z.string().optional().describe('Frame waarin de instance komt. Leeg = de huidige pagina.'),
      texts: z.record(z.string(), z.string()).optional().describe('{"Label": "Opslaan"}: zet de tekst van de eerste tekstlaag met die naam.'),
      props: z.object(props).optional().describe('Naam, maat, sizing (bv. FILL), positie.'),
    }, WRITE,
    async (a) => text(await cmd('create_instance', a)));

  tool('figma_set_variable_mode',
    'Toon lagen in een andere mode van een variabelencollectie, bv. de Dark-mode van de Semantic-variabelen op een scherm.',
    { ids, collection: z.string(), mode: z.string() }, WRITE,
    async (a) => text(await cmd('set_variable_mode', a)));

  tool('figma_bind_raw_spacing',
    'Bind ruwe paddings, gaps en hoekradii aan FLOAT-variabelen op waarde, zoals bind_raw_colors dat voor kleuren doet. map {"8": "space/1"}, radiusMap {"8": "radius/sm"}. Waarden zonder variabele komen in offGrid terug.',
    {
      ids: z.array(z.string()).optional().describe('Leeg = het hele bestand.'),
      map: z.record(z.string(), z.string()), radiusMap: z.record(z.string(), z.string()).optional(), dryRun: z.boolean().optional(),
    }, WRITE,
    async (a) => text(await cmd('bind_raw_spacing', a, 120000)));

  // ── owner only: offered when FIGMA_OWNER_KEY is set, and executed only by the owner build of the plugin ──
  if (ownerKey) {
    tool('figma_owner_status', 'Eigenaarsversie: is de plugin de eigenaarsbuild en klopt de sleutel? Geeft de lijst met eigenaarscommandos terug.', {}, READ,
      async () => text(await cmd('owner_status')));

    tool('figma_move_node',
      'Eigenaarsversie: verplaats een laag naar een andere ouder (en eventueel een plek in de volgorde). Dat kan figma_update niet.',
      { id: z.string(), parentId: z.string(), index: z.number().int().min(0).optional().describe('Plek in de nieuwe ouder. Leeg = achteraan.') }, WRITE,
      async (a) => text(await cmd('move_node', a)));

    tool('figma_add_variant',
      'Eigenaarsversie: voeg een variant toe aan een bestaande component set door er één te kopiëren. set geeft de nieuwe waarde van een bestaande eigenschap ({"variant": "ghost"}), from kiest de variant om te kopiëren (leeg = de eerste). texts en props passen de kopie meteen aan.',
      {
        setId: z.string().describe('Id van de component set.'),
        set: z.record(z.string(), z.string()).describe('{"variant": "ghost"}: de nieuwe waarde van een eigenschap die de set al heeft.'),
        from: z.record(z.string(), z.string()).optional().describe('{"variant": "secondary", "size": "md"}: welke variant wordt gekopieerd.'),
        texts: z.record(z.string(), z.string()).optional().describe('{"Label": "Label"}: tekst van de eerste laag met die naam in de kopie.'),
        props: z.object(props).optional(),
      }, WRITE,
      async (a) => text(await cmd('add_variant', a)));

    tool('figma_set_variant',
      'Eigenaarsversie: zet instances op een andere variant (of verander hun andere component-eigenschappen), bv. {"variant": "secondary"}.',
      { ids, props: z.record(z.string(), z.string()).describe('Eigenschap en nieuwe waarde.') }, WRITE,
      async (a) => text(await cmd('set_variant', a)));
  }

  tool('figma_cancel', 'Vraag een lopende zware opdracht in Figma (bv. tekststijlen toepassen) om te stoppen met wat al klaar is. Handig na een time-out: de opdracht loopt in Figma door.', {}, WRITE,
    async () => text(await cmd('cancel')));

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
