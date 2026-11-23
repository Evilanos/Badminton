// Server statis kecil supaya game bisa dibuka dari HP di Wi-Fi yang sama.
// Jalankan:  node serve.js   (atau klik dua kali serve.bat)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = process.env.PORT || 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Tidak ditemukan'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('\nBadminton Arena berjalan.\n');
  console.log('  Di PC ini : http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) console.log('  Di HP     : http://' + i.address + ':' + PORT + '   (HP harus satu Wi-Fi dengan PC)');
  console.log('\nTekan Ctrl+C untuk berhenti.\n');
});
