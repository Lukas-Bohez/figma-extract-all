const fs = require('fs');
const c = fs.readFileSync('code.js', 'utf8');
const h = fs.readFileSync('ui.html', 'utf8');
const checks = {
  // read from package.json, so this check does not break on every release
  ['code: version ' + require('./package.json').version]: c.includes('"' + require('./package.json').version + '"'),
  'code: b64Encode': c.includes('b64Encode'),
  'code: zip sends b64 not bytes array': c.includes('b64: b64Encode') && !c.includes('bytes: Array.from(zip.slice'),
  'code: flushZipPart': c.includes('flushZipPart'),
  'code: extras part flush >=25': c.includes('zipFiles.length >= 25'),
  'code: extras-complete msg': c.includes('extras-complete'),
  'code: nodes released': c.includes('workingNodes.length = 0'),
  'code: watchdog': c.includes('armWatchdog'),
  'code: owner commands are in the build': ['add_variant', 'set_variant', 'move_node', 'owner_status'].every((n) => c.includes(n)),
  'code: owner key is checked': c.includes('extract-all.owner-key'),
  'ui: b64ToU8': h.includes('b64ToU8'),
  'ui: atob decode': h.includes('atob(s)'),
  'ui: zip-chunk uses m.b64': h.includes('handleZipChunk(m.fileName, m.index, m.total, m.b64)'),
  'ui: extras-complete handler': h.includes('case "extras-complete"'),
  'ui: maybeFinishExport': h.includes('maybeFinishExport'),
};
let ok = true;
for (const k of Object.keys(checks)) {
  console.log((checks[k] ? 'PASS' : 'FAIL') + ' - ' + k);
  if (!checks[k]) ok = false;
}
console.log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
