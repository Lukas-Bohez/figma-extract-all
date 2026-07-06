var https = require('https');
var fs = require('fs');
https.get('https://unpkg.com/omggif@1.0.10/omggif.js', function(r) {
  var d = '';
  r.setEncoding('utf8');
  r.on('data', function(c) { d += c; });
  r.on('end', function() {
    fs.writeFileSync('omggif_full.js', d.trim() + '\n', 'utf8');
    console.log('Wrote ' + d.length + ' bytes');
    process.exit(0);
  });
});