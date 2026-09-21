// Test end-to-end strip metadata qua file thật (node, không tiếng Việt)
// Chạy: node test_e2e_strip.js
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = blocks[1];

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('Not found ' + name);
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
const scanFn = extractFn(js, 'scanForMetadata');

const vm = require('vm');
const ctx = { console, Buffer, Uint8Array };
vm.createContext(ctx);
vm.runInContext(concatBytes + '\n' + readAscii + '\n' + stripJpeg + '\n' + stripPng + '\n' + stripWebp + '\n' + scanFn, ctx);

// --- Fixtures ---
function seg(marker, payload) {
  const len = payload.length + 2;
  return Uint8Array.from([0xFF, marker, (len >> 8) & 0xFF, len & 0xFF, ...payload]);
}
function buildJpegWithExifAndTrailer() {
  const parts = [];
  parts.push(Uint8Array.from([0xFF, 0xD8]));
  parts.push(seg(0xE1, Uint8Array.from([...Buffer.from('Exif\0\0'), ...Buffer.from('GPSLAT=123')])));
  parts.push(seg(0xDB, Uint8Array.from([0, 1, 2, 3])));   // DQT
  parts.push(seg(0xC0, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])));  // SOF0
  parts.push(seg(0xC4, Uint8Array.from([0, 1, 2, 3])));   // DHT
  const sos = Uint8Array.from([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0]);
  const entropy = Uint8Array.from([0x12, 0x34, 0xFF, 0x00, 0xAB, 0xFF, 0xD9]); // entropy + EOI
  const trailer = Uint8Array.from(Buffer.from('HIDDEN_EXIF_AFTER_EOI_999'));
  return Buffer.concat([...parts.map(Buffer.from), Buffer.from(sos), Buffer.from(entropy), Buffer.from(trailer)]);
}
function buildJpegTrailerONLY() {
  // JPEG không có segment metadata nào, CHỈ có trailer ẩn sau EOI
  const parts = [];
  parts.push(Uint8Array.from([0xFF, 0xD8]));
  parts.push(seg(0xDB, Uint8Array.from([0, 1, 2, 3])));
  parts.push(seg(0xC0, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])));
  parts.push(seg(0xC4, Uint8Array.from([0, 1, 2, 3])));
  const sos = Uint8Array.from([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0]);
  const entropy = Uint8Array.from([0x12, 0x34, 0xFF, 0x00, 0xAB, 0xFF, 0xD9]);
  const trailer = Uint8Array.from(Buffer.from('SECRET_TRAILER_ONLY'));
  return Buffer.concat([...parts.map(Buffer.from), Buffer.from(sos), Buffer.from(entropy), Buffer.from(trailer)]);
}
function pngChunk(type, payload) {
  const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  return Buffer.concat([len, Buffer.from(type), payload, crc]);
}
function buildPngWithAuthor() {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4,0); ihdr.writeUInt32BE(4,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([sig, pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Author\0NguyenMinh')),
    pngChunk('IDAT', Buffer.from('DATABYTES')),
    pngChunk('IEND', Buffer.alloc(0))]);
}

// --- Tests ---
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

// Test 1: JPEG EXIF + trailer
{
  const jpeg = buildJpegWithExifAndTrailer();
  ctx.__tmp = jpeg;
  const out = vm.runInContext('stripJpegMetadata(new Uint8Array(__tmp))', ctx);
  check('JPEG co EXIF+trailer: ra ket qua', !!out && out.length < jpeg.length);
  if (out) {
    const s = Buffer.from(out).toString('latin1');
    check('  - het Exif/GPS', !s.includes('GPSLAT'));
    check('  - het trailer', !s.includes('HIDDEN_EXIF'));
    check('  - het scan (verify)', !vm.runInContext('scanForMetadata(new Uint8Array(__tmp2))', Object.assign(ctx, {__tmp2: out})));
    check('  - ket thuc EOI', Buffer.from(out)[Buffer.from(out).length-2] === 0xFF && Buffer.from(out)[Buffer.from(out).length-1] === 0xD9);
  }
}

// Test 2: JPEG chỉ có trailer (không segment) — LỖI CŨ
{
  const jpeg = buildJpegTrailerONLY();
  ctx.__tmp = jpeg;
  const out = vm.runInContext('stripJpegMetadata(new Uint8Array(__tmp))', ctx);
  check('JPEG chi trailer: co thay doi (out != null)', !!out);
  if (out) {
    const s = Buffer.from(out).toString('latin1');
    check('  - het trailer', !s.includes('SECRET_TRAILER_ONLY'));
    check('  - scan sach', !vm.runInContext('scanForMetadata(new Uint8Array(__tmp2))', Object.assign(ctx, {__tmp2: out})));
  }
}

// Test 3: PNG Author
{
  const png = buildPngWithAuthor();
  ctx.__tmp = png;
  const out = vm.runInContext('stripPngMetadata(new Uint8Array(__tmp))', ctx);
  check('PNG Author: co ket qua', !!out && out.length < png.length);
  if (out) {
    const s = Buffer.from(out).toString('latin1');
    check('  - het Author', !s.includes('Author'));
    check('  - het scan', !vm.runInContext('scanForMetadata(new Uint8Array(__tmp2))', Object.assign(ctx, {__tmp2: out})));
    check('  - con IEND', s.includes('IEND'));
  }
}

// Test 4: scanForMetadata phát hiện
{
  const evil = Buffer.concat([Buffer.from([0xFF,0xD8]), Buffer.from('Exif\0\0xxxx')]);
  ctx.__tmp = evil;
  const found = vm.runInContext('scanForMetadata(new Uint8Array(__tmp))', ctx);
  check('scan phat hien Exif', found === 'Exif\0\0' || found === 'Exif');
  const clean = Buffer.from([0xFF,0xD8,0xFF,0xD9]);
  ctx.__tmp = clean;
  check('scan sach thi null', vm.runInContext('scanForMetadata(new Uint8Array(__tmp))', ctx) === null);
}

console.log('\nKet qua: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);