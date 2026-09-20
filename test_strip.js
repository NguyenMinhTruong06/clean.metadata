// Test thuật toán strip metadata — chạy: node test_strip.js
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = blocks[1];

// Tách hàm theo tên (brace matching đơn giản)
function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('Không tìm thấy ' + name);
  let depth = 0, i = src.indexOf('{', idx);
  const start = i;
  do {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  } while (depth > 0);
  return src.slice(src.indexOf('function ' + name, 0), i);
}

const concatBytes = extractFn(js, 'concatBytes');
const readAscii = extractFn(js, 'readAscii');
const stripJpeg = extractFn(js, 'stripJpegMetadata');
const stripPng = extractFn(js, 'stripPngMetadata');
const stripWebp = extractFn(js, 'stripWebpMetadata');

// ---------- Fixtures ----------
function seg(marker, payload) {
  const len = payload.length + 2;
  return Uint8Array.from([0xFF, marker, (len >> 8) & 0xFF, len & 0xFF, ...payload]);
}
function buildJpegWithExif() {
  const parts = [];
  parts.push(Uint8Array.from([0xFF, 0xD8]));
  parts.push(seg(0xE1, Uint8Array.from([...Buffer.from('Exif\0\0'), ...Buffer.from('GPSDATA123')])));
  parts.push(seg(0xE1, Uint8Array.from([...Buffer.from('http://ns.adobe.com/xap/1.0/'), ...Buffer.from('<x:xmpmeta/>')])));
  parts.push(seg(0xE2, Uint8Array.from([...Buffer.from('ICC_PROFILE\0'), 1, 0, ...Buffer.from('ICC')])));
  parts.push(seg(0xE2, Uint8Array.from([...Buffer.from('http://ns.adobe.com/xmp/extension/'), ...Buffer.from('XMPEXT')])));
  parts.push(seg(0xEC, Uint8Array.from(Buffer.from('Ducky'))));
  parts.push(seg(0xED, Uint8Array.from([...Buffer.from('Photoshop 3.0'), ...Buffer.from('IPTC')])));
  parts.push(seg(0xFE, Uint8Array.from(Buffer.from('MyComment'))));
  parts.push(seg(0xDB, Uint8Array.from([0, 1, 2, 3])));   // DQT
  parts.push(seg(0xC0, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])));  // SOF0
  parts.push(seg(0xC4, Uint8Array.from([0, 1, 2, 3])));   // DHT
  const sos = Uint8Array.from([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0]);
  const entropy = Uint8Array.from([0x12, 0x34, 0xFF, 0x00, 0xAB, 0xFF, 0xD9]); // có byte-stuffing 0xFF00
  const trailer = Uint8Array.from(Buffer.from('TRAILER_METADATA_12345'));
  return Buffer.concat([...parts.map(Buffer.from), Buffer.from(sos), Buffer.from(entropy), Buffer.from(trailer)]);
}
function pngChunk(type, payload) {
  const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  return Buffer.concat([len, Buffer.from(type), payload, crc]);
}
function buildPngWithMeta() {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4,0); ihdr.writeUInt32BE(4,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([sig, pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Comment\0Secret')),
    pngChunk('eXIf', Buffer.from('EXIFBLOB')),
    pngChunk('IDAT', Buffer.from('DATABYTES')),
    pngChunk('IEND', Buffer.alloc(0))]);
}
function webpChunk(type, payload) {
  const out = Buffer.alloc(8 + payload.length + (payload.length % 2));
  out.write(type, 0, 'ascii');
  out.writeUInt32LE(payload.length, 4);
  payload.copy(out, 8);
  return out;
}
function buildWebpWithMeta() {
  const body = Buffer.concat([webpChunk('VP8X', Buffer.from([0,0,0,0,0,0,0,0,0,0])),
    webpChunk('EXIF', Buffer.from('EXIFBLOB')),
    webpChunk('XMP ', Buffer.from('<xmp/>')),
    webpChunk('VP8 ', Buffer.from('VIDEODATA'))]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

// ---------- VM ----------
const vm = require('vm');
const ctx = { console, Buffer, Uint8Array };
vm.createContext(ctx);
const src = concatBytes + '\n' + readAscii + '\n' + stripJpeg + '\n' + stripPng + '\n' + stripWebp;
vm.runInContext(src, ctx);

// ---------- Test JPEG ----------
const jpeg = buildJpegWithExif();
ctx.__tmp = jpeg;
const out = vm.runInContext('stripJpegMetadata(new Uint8Array(__tmp))', ctx);
if (!out) {
  console.log('JPEG: LỖI — trả null');
} else {
  const buf = Buffer.from(out);
  const s = buf.toString('latin1');
  const check = (name, cond) => console.log('JPEG ' + name + ': ' + (cond ? 'PASS ✓' : 'FAIL ✗'));
  check('size giảm', buf.length < jpeg.length);
  check('bỏ EXIF GPS', !s.includes('GPSDATA123'));
  check('bỏ XMP', !s.includes('xap/1.0'));
  check('giữ ICC_PROFILE', s.includes('ICC_PROFILE'));
  check('bỏ XMP extension', !s.includes('XMPEXT'));
  check('bỏ Ducky', !s.includes('Ducky'));
  check('bỏ IPTC Photoshop', !s.includes('Photoshop 3.0'));
  check('bỏ COM comment', !s.includes('MyComment'));
  check('bỏ trailer sau EOI', !s.includes('TRAILER_METADATA'));
  check('giữ entropy', buf.includes(Buffer.from([0x12, 0x34])) && buf.includes(Buffer.from([0xAB])));
  check('kết thúc bằng EOI', buf[buf.length-2] === 0xFF && buf[buf.length-1] === 0xD9);
  check('giữ DQT', s.includes(String.fromCharCode(0x00,0xDB)) || buf.includes(Buffer.from([0xFF,0xDB])));
  console.log('  before:', jpeg.length, 'after:', buf.length);
}

// ---------- Test PNG ----------
const png = buildPngWithMeta();
ctx.__tmp = png;
const outPng = vm.runInContext('stripPngMetadata(new Uint8Array(__tmp))', ctx);
if (!outPng) {
  console.log('PNG: LỖI — trả null');
} else {
  const s = Buffer.from(outPng).toString('latin1');
  console.log('PNG tEXt bị bỏ:', !s.includes('tEXt') ? 'PASS ✓' : 'FAIL ✗');
  console.log('PNG eXIf bị bỏ:', !s.includes('eXIf') ? 'PASS ✓' : 'FAIL ✗');
  console.log('PNG giữ IDAT:', s.includes('IDAT') ? 'PASS ✓' : 'FAIL ✗');
  console.log('PNG giữ IEND:', s.includes('IEND') ? 'PASS ✓' : 'FAIL ✗');
  console.log('  before:', png.length, 'after:', outPng.length);
}

// ---------- Test WebP ----------
const webp = buildWebpWithMeta();
ctx.__tmp = webp;
const outW = vm.runInContext('stripWebpMetadata(new Uint8Array(__tmp))', ctx);
if (!outW) {
  console.log('WebP: LỖI — trả null');
} else {
  const s = Buffer.from(outW).toString('latin1');
  console.log('WebP EXIF bị bỏ:', !s.includes('EXIFBLOB') ? 'PASS ✓' : 'FAIL ✗');
  console.log('WebP XMP bị bỏ:', !s.includes('<xmp/>') ? 'PASS ✓' : 'FAIL ✗');
  console.log('WebP giữ VP8:', s.includes('VP8 ') ? 'PASS ✓' : 'FAIL ✗');
  console.log('WebP giữ VP8X:', s.includes('VP8X') ? 'PASS ✓' : 'FAIL ✗');
  const bufW = Buffer.from(outW);
  const sz = bufW.readUInt32LE(4);
  console.log('WebP RIFF size đúng:', sz === bufW.length - 8 ? 'PASS ✓' : 'FAIL ✗ (' + sz + ' vs ' + (bufW.length-8) + ')');
  console.log('  before:', webp.length, 'after:', outW.length);
}