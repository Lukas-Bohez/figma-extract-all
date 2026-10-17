// figma-mock.mjs — a small fake of the Figma plugin runtime.
//
// Not a full emulator: it models the parts the plugin uses, and it ENFORCES
// the runtime rules that the TypeScript typings cannot express, so that a
// mistake throws here the way it would in Figma:
//   - text cannot be edited before its font is loaded
//   - layoutSizing*/layoutPositioning only on children of auto-layout frames
//   - resize() needs sizes >= 0.01
//   - setRange*() must stay within the text
//   - sync getNodeById / createVariable(id) throw under documentAccess dynamic-page
//   - setBoundVariable wants a Variable object, not an id

import { Buffer } from 'node:buffer';

let nextId = 1;
const newId = () => `${nextId++}:1`;
const MIXED = Symbol('mixed');

export function createFigma({ fonts } = {}) {
  const available = fonts || [
    ...['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black']
      .flatMap((s) => [{ family: 'Inter', style: s }, { family: 'Inter', style: s === 'Regular' ? 'Italic' : `${s} Italic` }]),
    { family: 'Roboto', style: 'Regular' }, { family: 'Roboto', style: 'Bold' },
  ];
  const loaded = new Set();
  const fkey = (f) => `${f.family}|${f.style}`;
  const registry = new Map();
  const posted = [];
  const listeners = [];
  let onmessage = null;
  const storage = new Map();
  const log = { exports: 0, svgs: 0, images: 0, notifies: [] };

  const isAuto = (n) => n && n.layoutMode && n.layoutMode !== 'NONE';

  class Node {
    constructor(type) {
      this.id = newId(); this.type = type; this.name = type.toLowerCase();
      this.parent = null; this.x = 0; this.y = 0; this.width = 100; this.height = 100;
      this.visible = true; this.opacity = 1; this.rotation = 0; this.fills = []; this.strokes = []; this.effects = [];
      this.boundVariables = {};
      this._layoutSizingH = 'FIXED'; this._layoutSizingV = 'FIXED'; this._pos = 'AUTO';
      registry.set(this.id, this);
    }
    resize(w, h) {
      if (!(w >= 0.01) || !(h >= 0.01)) throw new Error(`in resize: Expected width and height >= 0.01, got ${w} x ${h}`);
      this.width = w; this.height = h;
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null; registry.delete(this.id);
      // Figma drops removed nodes from the selection.
      page.selection = page.selection.filter((n) => n !== this);
    }
    get layoutSizingHorizontal() { return this._layoutSizingH; }
    set layoutSizingHorizontal(v) {
      if (!isAuto(this.parent) && !isAuto(this)) throw new Error('layoutSizingHorizontal: node is not an auto-layout frame or a child of one');
      this._layoutSizingH = v;
    }
    get layoutSizingVertical() { return this._layoutSizingV; }
    set layoutSizingVertical(v) {
      if (!isAuto(this.parent) && !isAuto(this)) throw new Error('layoutSizingVertical: node is not an auto-layout frame or a child of one');
      this._layoutSizingV = v;
    }
    get layoutPositioning() { return this._pos; }
    set layoutPositioning(v) {
      if (!isAuto(this.parent)) throw new Error('layoutPositioning can only be set on children of auto-layout frames');
      this._pos = v;
    }
    setExplicitVariableModeForCollection(collection, modeId) {
      if (typeof collection === 'string') throw new Error('pass the collection, not an id');
      if (!collection.modes.some((m) => m.modeId === modeId)) throw new Error('unknown mode ' + modeId);
      (this.explicitVariableModes ||= {})[collection.id] = modeId;
    }
    setBoundVariable(field, variable) {
      if (typeof variable === 'string') throw new Error('setBoundVariable(field, variableId) is not allowed with documentAccess: dynamic-page');
      this.boundVariables[field] = { type: 'VARIABLE_ALIAS', id: variable.id };
    }
    /** A copy that lands right after the original, in the same parent (as in Figma) */
    clone() {
      const copy = (n) => {
        const c = n.type === 'TEXT' ? new Text() : n.children ? new Frame(n.type) : new Node(n.type);
        for (const k of ['name', 'x', 'y', 'width', 'height', 'fills', 'strokes', 'effects', 'opacity', 'cornerRadius', 'layoutMode',
                         'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'primaryAxisAlignItems',
                         'counterAxisAlignItems', 'fontSize']) if (k in n && n[k] !== undefined) c[k] = n[k];
        if (n.type === 'TEXT') { c._font = n._font; c._chars = n._chars; }
        (n.children || []).forEach((ch) => c.appendChild(copy(ch)));
        return c;
      };
      const c = copy(this);
      const parent = this.parent;
      if (parent) parent.insertChild(parent.children.indexOf(this) + 1, c);
      return c;
    }
    async exportAsync(settings) {
      if (!settings) throw new Error('exportAsync needs settings');
      log.exports++;
      if (settings.format === 'JSON_REST_V1') return { document: { id: this.id, name: this.name, type: this.type } };
      if (!['PNG', 'JPG', 'SVG', 'PDF'].includes(settings.format)) throw new Error(`mock cannot export ${settings.format}`);
      if (settings.format === 'SVG') return new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    }
  }

  class Vector extends Node {
    constructor() { super('VECTOR'); this._paths = []; this.strokeWeight = 1; }
    get vectorPaths() { return this._paths; }
    set vectorPaths(paths) {
      if (!Array.isArray(paths) || !paths.every((p) => p && typeof p.data === 'string' && p.data.trim() && ['NONZERO', 'EVENODD'].includes(p.windingRule))) {
        throw new Error('in set_vectorPaths: Invalid path');
      }
      this._paths = paths;
    }
  }

  class Container extends Node {
    constructor(type) { super(type); this.children = []; }
    appendChild(c) {
      if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
      this.children.push(c); c.parent = this;
    }
    insertChild(index, c) {
      if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
      this.children.splice(index, 0, c); c.parent = this;
    }
    findAll(pred = () => true) {
      const out = [];
      const walk = (n) => { for (const c of n.children || []) { if (pred(c)) out.push(c); walk(c); } };
      walk(this); return out;
    }
    findAllWithCriteria({ types }) { return this.findAll((n) => types.includes(n.type)); }
    findOne(pred) { return this.findAll(pred)[0] || null; }
  }

  class Frame extends Container {
    constructor(type = 'FRAME') {
      super(type);
      this.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      this.layoutMode = 'NONE'; this.itemSpacing = 0; this.counterAxisSpacing = 0;
      this.paddingTop = this.paddingRight = this.paddingBottom = this.paddingLeft = 0;
      this.primaryAxisAlignItems = 'MIN'; this.counterAxisAlignItems = 'MIN';
      this.primaryAxisSizingMode = 'AUTO'; this.counterAxisSizingMode = 'AUTO';
      this.layoutWrap = 'NO_WRAP'; this.clipsContent = true; this.cornerRadius = 0;
      this.strokeWeight = 1; this.strokeAlign = 'INSIDE';
    }
    get cornerRadius() { return this._radius ?? 0; }
    set cornerRadius(v) { this._radius = v; this.topLeftRadius = this.topRightRadius = this.bottomLeftRadius = this.bottomRightRadius = v; }
    async getMainComponentAsync() { return this.mainComponent || null; }
    setProperties(props) {
      if (this.type !== 'INSTANCE') throw new Error('setProperties only on instances');
      const defs = this.mainComponent && this.mainComponent.parent && this.mainComponent.parent.componentPropertyDefinitions;
      for (const k of Object.keys(props)) {
        if (defs && !defs[k]) throw new Error(`Could not find a component property with name: ${k}`);
        if (defs && defs[k].variantOptions && !defs[k].variantOptions.includes(props[k])) throw new Error(`Invalid value "${props[k]}" for property ${k}`);
      }
      this.componentProperties = Object.assign({}, this.componentProperties, Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { value: v }])));
    }
    get variantProperties() {
      if (this.type !== 'COMPONENT' || !this.parent || this.parent.type !== 'COMPONENT_SET') return null;
      const out = {};
      this.name.split(/,\s*/).forEach((pair) => { const [k, v] = pair.split('='); if (v !== undefined) out[k] = v; });
      return out;
    }
    createInstance() {
      if (this.type !== 'COMPONENT') throw new Error('createInstance only on components');
      const copy = (n, parent) => {
        let c;
        if (n.type === 'TEXT') { c = new Text(); c._font = n._font; c._chars = n._chars; c.fontSize = n.fontSize; }
        else if (n.children) { c = new Frame(n.type === 'COMPONENT' ? 'INSTANCE' : n.type); }
        else return;
        for (const k of ['name', 'width', 'height', 'fills', 'cornerRadius', 'layoutMode', 'itemSpacing', 'paddingTop', 'paddingRight',
                         'paddingBottom', 'paddingLeft', 'primaryAxisAlignItems', 'counterAxisAlignItems']) if (k in n && n[k] !== undefined) c[k] = n[k];
        parent && parent.appendChild(c);
        (n.children || []).forEach((ch) => copy(ch, c));
        return c;
      };
      const inst = copy(this, null);
      inst.mainComponent = this;
      return inst;
    }
    /** Shows another component: the layers are made again from it, texts with the same layer name keep what they say */
    swapComponent(component) {
      if (this.type !== 'INSTANCE') throw new Error('swapComponent only on instances');
      if (!component || component.type !== 'COMPONENT') throw new Error('swapComponent needs a component');
      const kept = {};
      (this.findAll ? this.findAll((n) => n.type === 'TEXT') : []).forEach((t) => { kept[t.name] = t._chars; });
      const fresh = component.createInstance();
      this.children = [];
      (fresh.children || []).forEach((c) => this.appendChild(c));
      this.findAll((n) => n.type === 'TEXT').forEach((t) => { if (kept[t.name] !== undefined) t._chars = kept[t.name]; });
      this.mainComponent = component;
    }
    get layoutWrap() { return this._wrap; }
    set layoutWrap(v) {
      if (v === 'WRAP' && this.layoutMode !== 'HORIZONTAL') throw new Error('layoutWrap WRAP requires HORIZONTAL layoutMode');
      this._wrap = v;
    }
    get counterAxisAlignItems() { return this._caa; }
    set counterAxisAlignItems(v) {
      if (v === 'BASELINE' && this.layoutMode === 'VERTICAL') throw new Error('BASELINE alignment is only valid for horizontal auto layout');
      this._caa = v;
    }
  }

  class Text extends Node {
    constructor() {
      super('TEXT');
      this._font = { family: 'Inter', style: 'Regular' };
      this._chars = ''; this.fontSize = 12; this.textAutoResize = 'WIDTH_AND_HEIGHT';
      this.lineHeight = { unit: 'AUTO' }; this.letterSpacing = { unit: 'PERCENT', value: 0 };
      this.textCase = 'ORIGINAL'; this.textDecoration = 'NONE'; this.textAlignHorizontal = 'LEFT';
      this.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
      this.textStyleId = ''; this.ranges = [];
    }
    _need(font) { if (!loaded.has(fkey(font))) throw new Error(`Cannot write to node with unloaded font "${font.family} ${font.style}"`); }
    get fontName() { return this._font; }
    set fontName(f) { this._need(f); this._font = f; }
    get characters() { return this._chars; }
    set characters(s) { this._need(this._font); this._chars = s; }
    _range(a, b) { if (a < 0 || b > this._chars.length || a >= b) throw new Error(`Range ${a}-${b} outside text of length ${this._chars.length}`); }
    setRangeFontName(a, b, f) { this._range(a, b); this._need(f); this.ranges.push(['font', a, b, f]); }
    setRangeFontSize(a, b, s) { this._range(a, b); this.ranges.push(['size', a, b, s]); }
    setRangeFills(a, b, f) { this._range(a, b); this.ranges.push(['fills', a, b, f]); }
    setRangeTextDecoration(a, b, d) { this._range(a, b); }
    setRangeTextCase(a, b, c) { this._range(a, b); }
    setRangeLetterSpacing(a, b, l) { this._range(a, b); }
    getRangeAllFontNames() { return [this._font, ...this.ranges.filter((r) => r[0] === 'font').map((r) => r[3])]; }
    resize(w, h) {
      if (this.textAutoResize === 'WIDTH_AND_HEIGHT') { /* Figma recomputes; allowed */ }
      super.resize(w, h);
    }
    async setTextStyleIdAsync(id) { this.textStyleId = id; }
  }

  let page = new Container('PAGE');
  page.name = 'Page 1';
  page.selection = [];
  const root = new Container('DOCUMENT');
  root.name = 'Interaction Design';
  root.appendChild(page);

  const collections = [];
  const variables = [];
  const textStyles = [];

  const figma = {
    mixed: MIXED,
    root,
    get currentPage() { return page; },
    showUI(html, opts) { figma._shown = { html, opts }; },
    on() {},
    notify(m) { log.notifies.push(m); },
    ui: {
      postMessage(m) { posted.push(m); },
      set onmessage(fn) { onmessage = fn; },
      get onmessage() { return onmessage; },
      on(type, cb) { if (type === 'message') listeners.push(cb); },
      resize() {},
    },
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
    clientStorage: {
      async getAsync(k) { return storage.get(k); },
      async setAsync(k, v) { storage.set(k, v); },
    },
    async loadAllPagesAsync() {},
    getNodeById() { throw new Error('getNodeById is not allowed with documentAccess: dynamic-page. Use getNodeByIdAsync.'); },
    async getNodeByIdAsync(id) { return registry.get(id) || (id === page.id ? page : null); },
    async listAvailableFontsAsync() { return available.map((f) => ({ fontName: f })); },
    async loadFontAsync(f) {
      if (!available.some((a) => a.family === f.family && a.style === f.style)) throw new Error(`The font "${f.family} ${f.style}" could not be loaded`);
      loaded.add(fkey(f));
    },
    createFrame() { return new Frame(); },
    createRectangle() { return new Node('RECTANGLE'); },
    createEllipse() { return new Node('ELLIPSE'); },
    createText() { return new Text(); },
    createVector() { return new Vector(); },
    createPage() { const p = new Container('PAGE'); p.name = 'Page'; p.selection = []; root.appendChild(p); return p; },
    async setCurrentPageAsync(p) { if (!root.children.includes(p)) throw new Error('not a page of this document'); page = p; },
    createNodeFromSvg(svg) {
      if (!/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$|\/>\s*$/i.test(svg)) throw new Error('Unable to parse SVG');
      log.svgs++;
      const f = new Frame(); f.fills = [];
      const w = svg.match(/\swidth="([\d.]+)"/), h = svg.match(/\sheight="([\d.]+)"/);
      f.width = w ? +w[1] : 100; f.height = h ? +h[1] : 100;
      if (/stroke=/.test(svg)) { const v = new Vector(); v.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; f.appendChild(v); }
      return f;
    },
    createImage(bytes) { if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('createImage needs bytes'); log.images++; return { hash: 'img' + bytes.length }; },
    base64Decode(s) { return new Uint8Array(Buffer.from(s, 'base64')); },
    base64Encode(b) { return Buffer.from(b).toString('base64'); },
    createComponentFromNode(n) {
      // Figma: "preserving all of its properties and children".
      const c = new Frame('COMPONENT');
      for (const k of ['name', 'width', 'height', 'x', 'y', 'fills', 'strokes', 'effects', 'opacity', 'cornerRadius',
                       'layoutMode', 'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                       'primaryAxisAlignItems', 'counterAxisAlignItems', 'boundVariables']) if (k in n) c[k] = n[k];
      const parent = n.parent;
      for (const ch of (n.children || []).slice()) c.appendChild(ch);
      parent && parent.appendChild(c); n.remove();
      return c;
    },
    combineAsVariants(comps, parent) {
      if (!comps.every((c) => c.type === 'COMPONENT')) throw new Error('combineAsVariants needs components');
      const set = new Frame('COMPONENT_SET');
      comps.forEach((c) => set.appendChild(c));
      parent.appendChild(set);
      const defs = {};
      comps.forEach((c) => c.name.split(/,\s*/).forEach((pair) => {
        const [k, v] = pair.split('=');
        if (v !== undefined) (defs[k] = defs[k] || { type: 'VARIANT', variantOptions: [] }).variantOptions.push(v);
      }));
      set.componentPropertyDefinitions = Object.keys(defs).length ? defs : { 'Property 1': { type: 'VARIANT', variantOptions: comps.map((_, i) => `Variant${i + 1}`) } };
      return set;
    },
    variables: {
      async getLocalVariableCollectionsAsync() { return collections; },
      async getLocalVariablesAsync() { return variables; },
      async getVariableByIdAsync(id) { return variables.find((v) => v.id === id) || null; },
      createVariableCollection(name) {
        const col = {
          id: 'VariableCollectionId:' + newId(), name, modes: [{ modeId: newId(), name: 'Mode 1' }], variableIds: [],
          renameMode(id, n) { this.modes.find((m) => m.modeId === id).name = n; },
          remove() {
            for (const id of [...this.variableIds]) { const i = variables.findIndex((v) => v.id === id); if (i >= 0) variables.splice(i, 1); }
            collections.splice(collections.indexOf(this), 1);
          },
          addMode(n) { const m = { modeId: newId(), name: n }; this.modes.push(m); return m.modeId; },
        };
        collections.push(col); return col;
      },
      createVariable(name, col, type) {
        if (typeof col === 'string') throw new Error('createVariable(name, collectionId, ...) is not allowed with documentAccess: dynamic-page');
        const v = {
          id: 'VariableID:' + newId(), name, resolvedType: type, variableCollectionId: col.id, valuesByMode: {}, scopes: ['ALL_SCOPES'],
          codeSyntax: {}, description: '',
          setValueForMode(m, val) {
            if (!col.modes.some((x) => x.modeId === m)) throw new Error('unknown mode ' + m);
            this.valuesByMode[m] = val;
          },
          setVariableCodeSyntax(platform, syntax) {
            if (!['WEB', 'ANDROID', 'iOS'].includes(platform)) throw new Error('bad platform ' + platform);
            this.codeSyntax[platform] = syntax;
          },
          remove() {
            variables.splice(variables.indexOf(this), 1);
            col.variableIds = col.variableIds.filter((x) => x !== this.id);
          },
        };
        col.variableIds.push(v.id); variables.push(v); return v;
      },
      createVariableAlias(v) { return { type: 'VARIABLE_ALIAS', id: v.id }; },
      setBoundVariableForPaint(paint, field, v) {
        if (typeof v === 'string') throw new Error('pass a Variable, not an id');
        return { ...paint, boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } } };
      },
    },
    async getLocalTextStylesAsync() { return textStyles; },
    async getLocalPaintStylesAsync() { return []; },
    async getLocalEffectStylesAsync() { return []; },
    async getStyleByIdAsync(id) { return textStyles.find((s) => s.id === id) || null; },
    createTextStyle() {
      const s = { id: 'S:' + newId(), name: '', fontSize: 12, lineHeight: { unit: 'AUTO' }, _font: { family: 'Inter', style: 'Regular' } };
      Object.defineProperty(s, 'fontName', {
        get() { return this._font; },
        set(f) { if (!loaded.has(fkey(f))) throw new Error(`Cannot set text style font to unloaded font ${f.family} ${f.style}`); this._font = f; },
        enumerable: true,
      });
      textStyles.push(s); return s;
    },
  };

  // Deliver a UI message the way Figma does: to onmessage AND every 'message' listener.
  async function send(msg) {
    const all = [];
    if (onmessage) all.push(onmessage(msg));
    for (const l of listeners) all.push(l(msg));
    await Promise.all(all);
  }

  return { figma, send, posted, log, page, registry, loaded, collections, variables, textStyles, MIXED };
}
