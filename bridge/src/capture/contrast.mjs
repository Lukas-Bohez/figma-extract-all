// contrast.mjs — WCAG 2.x contrast audit on a figma-layout document.
//
// For every text layer we composite the backgrounds of its ancestor frames
// (respecting alpha and opacity) to find what the text actually sits on,
// then compute the contrast ratio against the (composited) text colour.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ({ r, g, b }) => 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Source-over compositing of `top` (with alpha) onto an opaque `bottom`.
function over(top, bottom, extraAlpha = 1) {
  const a = (top.a ?? 1) * extraAlpha;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

// WCAG "large text": >= 24px, or >= 18.66px (14pt) and bold (>= 700).
const isLarge = (font) => font.size >= 24 || (font.size >= 18.66 && font.weight >= 700);

/**
 * @param {object} doc  figma-layout document
 * @returns {{checked:number, failures:Array, passes:number, worst:Array}}
 */
export function auditContrast(doc) {
  const results = [];

  function visit(node, bg, opacity, path) {
    const op = opacity * (node.opacity ?? 1);
    let here = bg;
    if (node.type === 'FRAME') {
      for (const f of node.fills || []) {
        if (f.type === 'SOLID' && f.color) here = over(f.color, here, op);
      }
    }
    const nextPath = node.type === 'FRAME' && node.name && !/^(div|span)$/.test(node.name) ? [...path, node.name] : path;

    if (node.type === 'TEXT') {
      const runs = node.runs || [{ text: node.text, font: node.font, color: node.color }];
      for (const run of runs) {
        if (!run.color || !run.text.trim()) continue;
        const fg = over(run.color, here, op);
        const ratio = contrastRatio(fg, here);
        const need = isLarge(run.font) ? 3 : 4.5;
        results.push({
          text: run.text.trim().slice(0, 48),
          ratio: Math.round(ratio * 100) / 100,
          need,
          pass: ratio >= need,
          fg: hex(fg),
          bg: hex(here),
          size: run.font.size,
          weight: run.font.weight,
          where: nextPath.slice(-3).join(' › '),
        });
      }
    }
    for (const c of node.children || []) visit(c, here, op, nextPath);
  }

  const pageBg = (doc.root.fills || []).find((f) => f.type === 'SOLID')?.color || { r: 1, g: 1, b: 1, a: 1 };
  visit(doc.root, { ...pageBg, a: 1 }, 1, []);

  // Deduplicate identical colour/size combinations so the report stays readable.
  const failures = [];
  const seen = new Set();
  for (const r of results.filter((x) => !x.pass).sort((a, b) => a.ratio - b.ratio)) {
    const key = `${r.fg}|${r.bg}|${r.size}|${r.weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push({ ...r, occurrences: results.filter((x) => !x.pass && `${x.fg}|${x.bg}|${x.size}|${x.weight}` === key).length });
  }
  return {
    checked: results.length,
    passes: results.filter((r) => r.pass).length,
    failures,
    worst: [...results].sort((a, b) => a.ratio - b.ratio).slice(0, 5),
  };
}
