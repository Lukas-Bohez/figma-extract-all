/* capture-page.js — runs INSIDE a web page.
 *
 * Walks the rendered DOM and serialises it into a "figma-layout" document
 * that the Extract All plugin can rebuild as real Figma layers:
 * frames with fills, borders, radii, shadows and (optionally) auto layout
 * from flexbox; text with styled runs; SVGs with every colour resolved.
 *
 * Usable three ways:
 *   - injected by the CLI / bridge (capture-cli.mjs) through Chrome DevTools
 *   - pasted into the browser console
 *   - as a bookmarklet (see bookmarklet.txt)
 *
 * It defines window.__figmaCapture(options) and returns a plain object.
 */
(function () {
  'use strict';

  var VERSION = 1;

  /* ---------- colour normalisation ----------
     getComputedStyle hands back colours in whatever space they were written
     in: oklch(), color-mix() results, light-dark() results... Figma wants
     sRGB 0..1. Painting one pixel on a canvas and reading it back converts
     ANY valid CSS colour to sRGB bytes, including gamut mapping. */
  var cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  var colorCache = Object.create(null);

  function toRGBA(css) {
    if (!css || css === 'transparent' || css === 'none') return null;
    if (colorCache[css] !== undefined) return colorCache[css];
    var out = null;
    try {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = css;              // an invalid value leaves #000 in place
      cx.fillRect(0, 0, 1, 1);
      var d = cx.getImageData(0, 0, 1, 1).data;
      if (d[3] > 0) {
        out = { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: +(d[3] / 255).toFixed(3) };
      }
    } catch (e) { out = null; }
    colorCache[css] = out;
    return out;
  }

  function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round(n) { return Math.round(n * 100) / 100; }

  /* ---------- visibility & classification ---------- */
  function isHidden(el, cs) {
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    // closed popovers and dialogs
    if (el.hasAttribute && el.hasAttribute('popover')) {
      try { if (!el.matches(':popover-open')) return true; } catch (e) { return true; }
    }
    if (el.tagName === 'DIALOG' && !el.open) return true;
    // visually hidden (.sr-only) utilities
    var r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1 && cs.overflow !== 'visible') return true;
    if (cs.clipPath === 'inset(50%)') return true;
    return false;
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1, BR: 1, WBR: 1 };

  function hasBox(cs) {
    if (toRGBA(cs.backgroundColor)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (px(cs.borderTopWidth) + px(cs.borderRightWidth) + px(cs.borderBottomWidth) + px(cs.borderLeftWidth) > 0) return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    if (px(cs.paddingTop) + px(cs.paddingRight) + px(cs.paddingBottom) + px(cs.paddingLeft) > 0) return true;
    return false;
  }

  function isPlainInline(el) {
    if (el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'svg' || tag === 'SVG' || tag === 'IMG' || tag === 'INPUT' || tag === 'TEXTAREA' ||
        tag === 'SELECT' || tag === 'BUTTON' || tag === 'CANVAS' || tag === 'VIDEO') return false;
    var cs = getComputedStyle(el);
    if (cs.display !== 'inline') return false;
    if (hasBox(cs)) return false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && !SKIP_TAGS[c.tagName] && !isPlainInline(c)) return false;
    }
    return true;
  }

  // An element whose content is only text + plain inline elements becomes ONE
  // Figma text layer with styled runs, instead of a pile of fragments.
  function isTextBlock(el) {
    var sawText = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) sawText = true; continue; }
      if (c.nodeType !== 1 || SKIP_TAGS[c.tagName]) continue;
      if (!isPlainInline(c)) return false;
      if ((c.textContent || '').trim()) sawText = true;
    }
    return sawText;
  }

  /* ---------- style extraction ---------- */
  function fontFor(cs) {
    return {
      family: (cs.fontFamily.split(',')[0] || 'Inter').replace(/["']/g, '').trim(),
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
      size: round(px(cs.fontSize)),
      lineHeight: cs.lineHeight === 'normal' ? null : round(px(cs.lineHeight)),
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : round(px(cs.letterSpacing)),
    };
  }

  function textProps(cs) {
    return {
      font: fontFor(cs),
      color: toRGBA(cs.color),
      decoration: /underline/.test(cs.textDecorationLine) ? 'UNDERLINE' : /line-through/.test(cs.textDecorationLine) ? 'STRIKETHROUGH' : 'NONE',
      transform: cs.textTransform === 'uppercase' ? 'UPPER' : cs.textTransform === 'lowercase' ? 'LOWER' : cs.textTransform === 'capitalize' ? 'TITLE' : 'ORIGINAL',
    };
  }

  function sameStyle(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Split at top-level commas (not inside parentheses).
  function splitTop(s) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function parseShadows(v) {
    if (!v || v === 'none') return [];
    var res = [];
    splitTop(v).forEach(function (part) {
      var inset = /\binset\b/.test(part);
      var m = part.match(/(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b)/i);
      var color = m ? toRGBA(m[0]) : { r: 0, g: 0, b: 0, a: 0.25 };
      if (!color) return;
      var nums = part.replace(m ? m[0] : '', '').replace('inset', '').trim().split(/\s+/).map(px);
      res.push({ x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, color: color, inset: inset });
    });
    return res;
  }

  function boxProps(el, cs, rect, warn) {
    var p = {};
    var bg = toRGBA(cs.backgroundColor);
    p.fills = bg ? [{ type: 'SOLID', color: bg }] : [];
    if (cs.backgroundImage && cs.backgroundImage !== 'none') warn('background-image niet overgenomen', el);

    var bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
    if (bw[0] + bw[1] + bw[2] + bw[3] > 0) {
      var sideColors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
      var idx = 0;
      while (idx < 4 && !(bw[idx] > 0)) idx++;
      var bc = toRGBA(sideColors[idx]);
      if (bc) p.stroke = { color: bc, weights: bw.map(round) };
    }

    var maxR = Math.min(rect.width, rect.height) / 2;
    var r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
      .map(function (v) { return round(Math.min(px(v), maxR)); });
    if (r.some(function (x) { return x > 0; })) p.radius = r;

    var shadows = parseShadows(cs.boxShadow);
    if (shadows.length) p.shadows = shadows;

    var op = parseFloat(cs.opacity);
    if (op < 1) p.opacity = op;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') p.clip = true;
    return p;
  }

  // Flexbox -> Figma auto layout, but only where the result will be faithful:
  // no margins, no reordering, no absolutely positioned children.
  function layoutProps(el, cs, inflow) {
    if (!/flex/.test(cs.display)) return null;
    if (/reverse/.test(cs.flexDirection)) return null;
    for (var i = 0; i < inflow.length; i++) {
      var ccs = getComputedStyle(inflow[i]);
      if (px(ccs.marginTop) || px(ccs.marginRight) || px(ccs.marginBottom) || px(ccs.marginLeft)) return null;
      if (ccs.order !== '0') return null;
    }
    var dir = /column/.test(cs.flexDirection) ? 'VERTICAL' : 'HORIZONTAL';
    var gap = dir === 'VERTICAL' ? px(cs.rowGap) : px(cs.columnGap);
    var crossGap = dir === 'VERTICAL' ? px(cs.columnGap) : px(cs.rowGap);
    var jc = cs.justifyContent;
    var ai = cs.alignItems;
    return {
      mode: dir,
      wrap: cs.flexWrap === 'wrap',
      gap: round(gap),
      crossGap: round(crossGap),
      padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)].map(round),
      primary: /space-between/.test(jc) ? 'SPACE_BETWEEN' : /center/.test(jc) ? 'CENTER' : /(flex-)?end|right/.test(jc) ? 'MAX' : 'MIN',
      counter: /center/.test(ai) ? 'CENTER' : /(flex-)?end/.test(ai) ? 'MAX' : /baseline/.test(ai) ? 'BASELINE' : 'MIN',
    };
  }

  /* ---------- names ---------- */
  function nameFor(el) {
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria;
    var cls = ((el.getAttribute && el.getAttribute('class')) || '').trim().split(/\s+/)[0];
    var tag = el.tagName.toLowerCase();
    if (cls) return cls;
    if (el.id) return tag + '#' + el.id;
    return tag;
  }

  /* ---------- SVG: inline every computed paint ----------
     Figma's SVG importer does not know CSS variables, classes or
     currentColor as used by icon sets. So every element gets its computed
     paint written back as a plain attribute. */
  var PAINT_PROPS = ['fill', 'stroke', 'stop-color'];
  var PLAIN_PROPS = ['stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
                     'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'fill-rule'];
  // Figma's importer reads these from attributes, not from the stylesheet
  var TEXT_PROPS = ['font-weight', 'font-style', 'letter-spacing', 'text-anchor'];
  var SHAPES = /^(rect|circle|ellipse|path|line|polyline|polygon)$/;

  /* A CSS transform (or the separate `translate` property) on an SVG element is
     what places things like chart markers, and the old code threw it away with
     the style attribute: everything landed in the corner. Write the computed
     result back as a transform attribute (matrix a b c d e f). */
  function matrixOf(value) {
    var m = /^matrix(3d)?\(([^)]+)\)$/.exec(value || '');
    if (!m) return null;
    var n = m[2].split(',').map(parseFloat);
    return m[1] ? [n[0], n[1], n[4], n[5], n[12], n[13]] : n;
  }
  function multiply(p, q) {
    return [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
            p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
  }
  function svgTransform(cs) {
    var m = matrixOf(cs.getPropertyValue('transform'));
    var tr = cs.getPropertyValue('translate');
    if (tr && tr !== 'none') {
      var p = tr.split(/\s+/).map(parseFloat);
      m = multiply([1, 0, 0, 1, p[0] || 0, p[1] || 0], m || [1, 0, 0, 1, 0, 0]);
    }
    if (!m) return null;
    var origin = (cs.getPropertyValue('transform-origin') || '0 0').split(/\s+/).map(parseFloat);
    var ox = origin[0] || 0, oy = origin[1] || 0;
    if (ox || oy) m = multiply(multiply([1, 0, 0, 1, ox, oy], m), [1, 0, 0, 1, -ox, -oy]);
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return null;
    return m.map(function (v) { return Math.round(v * 1e5) / 1e5; });
  }

  function serializeSvg(svg, rect) {
    var clone = svg.cloneNode(true);
    var srcAll = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
    var dstAll = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    var remove = [];
    for (var i = 0; i < srcAll.length; i++) {
      var s = srcAll[i], d = dstAll[i];
      if (!d || !d.setAttribute) continue;
      var cs = getComputedStyle(s);
      var tag = s.tagName.toLowerCase();
      if (cs.display === 'none' || tag === 'title' || tag === 'desc') { remove.push(d); continue; }
      if (SHAPES.test(tag)) {
        // an invisible hit area (fill transparent, no stroke) is only ballast in Figma
        var f = cs.getPropertyValue('fill'), st = cs.getPropertyValue('stroke');
        var fc = toRGBA(f), sc = toRGBA(st);
        var noFill = f === 'none' || (fc && fc.a === 0);
        var noStroke = st === 'none' || (sc && sc.a === 0) || parseFloat(cs.getPropertyValue('stroke-width')) === 0;
        if (noFill && noStroke && !/^url\(/.test(f)) { remove.push(d); continue; }
      }
      PAINT_PROPS.forEach(function (prop) {
        var v = cs.getPropertyValue(prop);
        if (!v) return;
        if (v === 'none') { d.setAttribute(prop, 'none'); return; }
        if (/^url\(/.test(v)) {
          var id = v.match(/#([^")]+)/);
          if (id) d.setAttribute(prop, 'url(#' + id[1] + ')');
          return;
        }
        var c = toRGBA(v);
        if (!c) return;
        d.setAttribute(prop, 'rgb(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ')');
        if (c.a < 1) {
          var opProp = prop === 'stop-color' ? 'stop-opacity' : prop + '-opacity';
          var prev = parseFloat(cs.getPropertyValue(opProp) || '1');
          d.setAttribute(opProp, String(round((isFinite(prev) ? prev : 1) * c.a)));
        }
      });
      PLAIN_PROPS.forEach(function (prop) {
        if (d.hasAttribute(prop)) return;
        var v = cs.getPropertyValue(prop);
        if (v && v !== 'normal' && v !== 'none' && !(prop === 'opacity' && v === '1')) d.setAttribute(prop, v);
      });
      if (tag === 'text' || tag === 'tspan') {
        var family = cs.getPropertyValue('font-family').split(',')[0].replace(/["']/g, '').trim();
        if (family) d.setAttribute('font-family', family);
        var size = parseFloat(cs.getPropertyValue('font-size'));
        if (size) d.setAttribute('font-size', String(round(size)));
        TEXT_PROPS.forEach(function (prop) {
          var v = cs.getPropertyValue(prop);
          if (v && v !== 'normal') d.setAttribute(prop, prop === 'letter-spacing' ? String(parseFloat(v)) : v);
        });
      }
      var matrix = svgTransform(cs);
      if (matrix) d.setAttribute('transform', 'matrix(' + matrix.join(' ') + ')');
      d.removeAttribute('class');
      d.removeAttribute('style');
    }
    remove.forEach(function (d) { d.parentNode && d.parentNode.removeChild(d); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(round(rect.width)));
    clone.setAttribute('height', String(round(rect.height)));
    if (!clone.getAttribute('viewBox') && rect.width && rect.height) {
      clone.setAttribute('viewBox', '0 0 ' + round(rect.width) + ' ' + round(rect.height));
    }
    return new XMLSerializer().serializeToString(clone);
  }

  /* ---------- image to data URL (same-origin or CORS-enabled only) ---------- */
  function imageData(img) {
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }

  /* ---------- the walk ---------- */
  function capture(options) {
    options = options || {};
    var rootEl = options.selector ? document.querySelector(options.selector) : document.body;
    if (!rootEl) throw new Error('Geen element gevonden voor selector ' + options.selector);

    var warnings = [];
    var counts = { FRAME: 0, TEXT: 0, SVG: 0, IMAGE: 0 };
    var fontsUsed = Object.create(null);
    function warn(msg, el) {
      if (warnings.length < 40) warnings.push(msg + (el ? ' (' + nameFor(el) + ')' : ''));
    }

    var origin = rootEl.getBoundingClientRect();
    var ox = origin.left + window.scrollX, oy = origin.top + window.scrollY;
    function geom(r) {
      return { x: round(r.left + window.scrollX - ox), y: round(r.top + window.scrollY - oy), w: round(r.width), h: round(r.height) };
    }

    function textNode(runs, rect, cs) {
      var text = runs.map(function (r) { return r.text; }).join('');
      if (!text.trim()) return null;
      counts.TEXT++;
      runs.forEach(function (r) { fontsUsed[r.font.family + '|' + r.font.weight + '|' + r.font.italic] = true; });
      var g = geom(rect);
      var lh = runs[0].font.lineHeight || runs[0].font.size * 1.25;
      var node = {
        type: 'TEXT',
        name: text.trim().slice(0, 40),
        text: text,
        font: runs[0].font,
        color: runs[0].color,
        decoration: runs[0].decoration,
        transform: runs[0].transform,
        align: cs.textAlign === 'center' ? 'CENTER' : (cs.textAlign === 'right' || cs.textAlign === 'end') ? 'RIGHT' : cs.textAlign === 'justify' ? 'JUSTIFIED' : 'LEFT',
        wrap: g.h > lh * 1.5,
      };
      if (runs.length > 1) node.runs = runs;
      return Object.assign(node, g);
    }

    // Collapse whitespace the way the browser rendered it.
    function renderedText(node, cs) {
      var t = node.nodeValue;
      if (!/pre/.test(cs.whiteSpace)) t = t.replace(/\s+/g, ' ');
      return t;
    }

    function collectRuns(el) {
      var runs = [];
      (function walkInline(n, cs) {
        for (var c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) {
            var t = renderedText(c, cs);
            if (!t) continue;
            var props = textProps(cs);
            var last = runs[runs.length - 1];
            if (last && sameStyle(last.font, props.font) && sameStyle(last.color, props.color) &&
                last.decoration === props.decoration && last.transform === props.transform) {
              last.text += t;
            } else {
              runs.push({ text: t, font: props.font, color: props.color, decoration: props.decoration, transform: props.transform });
            }
          } else if (c.nodeType === 1 && !SKIP_TAGS[c.tagName]) {
            walkInline(c, getComputedStyle(c));
          }
        }
      })(el, getComputedStyle(el));
      if (runs.length) {
        runs[0].text = runs[0].text.replace(/^\s+/, '');
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
      }
      // collapse double spaces at run boundaries
      for (var i = 1; i < runs.length; i++) {
        if (/\s$/.test(runs[i - 1].text) && /^\s/.test(runs[i].text)) runs[i].text = runs[i].text.replace(/^\s+/, '');
      }
      return runs.filter(function (r) { return r.text.length; });
    }

    function contentRect(el) {
      var range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    }

    function walk(el, depth) {
      if (depth > 60) return null;
      if (SKIP_TAGS[el.tagName]) return null;
      var cs = getComputedStyle(el);
      if (isHidden(el, cs)) return null;
      var rect = el.getBoundingClientRect();
      var tag = el.tagName;

      if (tag === 'svg' || tag === 'SVG') {
        if (rect.width < 0.5 || rect.height < 0.5) return null;
        counts.SVG++;
        return Object.assign({ type: 'SVG', name: nameFor(el), svg: serializeSvg(el, rect) }, geom(rect));
      }

      if (tag === 'IMG') {
        counts.IMAGE++;
        var data = imageData(el);
        if (!data) warn('afbeelding niet leesbaar (CORS)', el);
        return Object.assign({ type: 'IMAGE', name: el.alt || nameFor(el), src: data, fit: cs.objectFit === 'contain' ? 'FIT' : 'FILL' }, geom(rect));
      }

      var node = Object.assign({ type: 'FRAME', name: nameFor(el) }, geom(rect), boxProps(el, cs, rect, warn));
      node.children = [];
      counts.FRAME++;

      // Form fields: show the value, or the placeholder in its own colour
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        var val = el.value || el.getAttribute('placeholder') || '';
        if (val && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'hidden') {
          var pcs = el.value ? cs : getComputedStyle(el, '::placeholder');
          var props = textProps(pcs);
          var lh = props.font.lineHeight || props.font.size * 1.25;
          var inner = {
            left: rect.left + px(cs.paddingLeft) + px(cs.borderLeftWidth),
            top: rect.top + (rect.height - lh) / 2,
            width: Math.max(1, rect.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)),
            height: lh,
          };
          var tn = textNode([{ text: val, font: props.font, color: props.color, decoration: 'NONE', transform: 'ORIGINAL' }], inner, cs);
          if (tn) { tn.wrap = false; node.children.push(tn); }
        }
        return node;
      }

      if (isTextBlock(el)) {
        var t = textNode(collectRuns(el), contentRect(el), cs);
        if (!t) { counts.FRAME--; return null; }
        // a text block without a box of its own needs no wrapping frame
        if (!hasBox(cs) && !node.clip) { counts.FRAME--; return t; }
        node.children.push(t);
        return node;
      }

      var inflow = [];
      var strayText = false;
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          var txt = renderedText(c, cs).trim();
          if (!txt) continue;
          var range = document.createRange();
          range.selectNode(c);
          var tnode = textNode([{ text: txt, font: textProps(cs).font, color: textProps(cs).color, decoration: textProps(cs).decoration, transform: textProps(cs).transform }], range.getBoundingClientRect(), cs);
          if (tnode) { node.children.push(tnode); strayText = true; }
          continue;
        }
        if (c.nodeType !== 1) continue;
        var child = walk(c, depth + 1);
        if (!child) continue;
        var ccs = getComputedStyle(c);
        if (ccs.position === 'absolute' || ccs.position === 'fixed') child.absolute = true;
        else inflow.push(c);
        node.children.push(child);
      }

      if (options.autoLayout !== false && !strayText) {
        var lay = layoutProps(el, cs, inflow);
        if (lay) node.layout = lay;
      }

      // Drop wrapper frames that add nothing: no box, one child, same size.
      if (!hasBox(cs) && !node.clip && node.children.length === 1 && !node.layout) {
        var only = node.children[0];
        if (Math.abs(only.w - node.w) < 1 && Math.abs(only.h - node.h) < 1) {
          counts.FRAME--;
          if (only.type === 'FRAME' && /^(div|span)$/.test(only.name)) only.name = node.name;
          return only;
        }
      }
      if (!node.children.length && !hasBox(cs)) { counts.FRAME--; return null; }
      return node;
    }

    var root = walk(rootEl, 0) || { type: 'FRAME', name: 'empty', x: 0, y: 0, w: origin.width, h: origin.height, children: [] };
    if (root.type !== 'FRAME') root = { type: 'FRAME', name: 'page', x: 0, y: 0, w: round(origin.width), h: round(origin.height), children: [root] };
    // The root always carries the page background, so the frame is never transparent.
    if (!root.fills || !root.fills.length) {
      var bg = toRGBA(getComputedStyle(document.body).backgroundColor) ||
               toRGBA(getComputedStyle(document.documentElement).backgroundColor) ||
               { r: 1, g: 1, b: 1, a: 1 };
      root.fills = [{ type: 'SOLID', color: bg }];
    }
    root.clip = true;
    root.name = options.name || document.title || 'Captured page';

    return {
      format: 'figma-layout',
      version: VERSION,
      source: {
        url: location.href,
        title: document.title,
        capturedAt: new Date().toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        theme: document.documentElement.getAttribute('data-theme'),
      },
      fonts: Object.keys(fontsUsed).map(function (k) {
        var p = k.split('|');
        return { family: p[0], weight: +p[1], italic: p[2] === 'true' };
      }),
      counts: counts,
      warnings: warnings,
      root: root,
    };
  }

  window.__figmaCapture = capture;
})();
