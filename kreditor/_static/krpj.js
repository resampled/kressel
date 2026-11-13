// .krpj reading (see /docs/krpj.md): a zip holding game.json plus "./" assets, or a bare game.json. Classic-script copy of
// the mockup's reader (stored + deflate), since kreditor has no build step. Input is untrusted: bounds-checked and capped.
var kreditorKrpj = (function () {
  'use strict';
  const MAX_ENTRY = 256 << 20, MAX_FILES = 65536;

  /** zip bytes -> Map<path, Uint8Array>. */
  async function unzip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bad = (m) => new Error(`not a valid .krpj: ${m}`);
    const u16 = (at) => { if (at < 0 || at + 2 > bytes.length) throw bad('truncated'); return v.getUint16(at, true); };
    const u32 = (at) => { if (at < 0 || at + 4 > bytes.length) throw bad('truncated'); return v.getUint32(at, true); };
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw bad('not a zip');
    const n = u16(eocd + 10);
    if (n > MAX_FILES) throw bad('too many entries');
    const dec = new TextDecoder(), files = new Map();
    for (let k = 0, at = u32(eocd + 16); k < n; k++) {
      if (u32(at) !== 0x02014b50) throw bad('bad central directory');
      const method = u16(at + 10), csize = u32(at + 20), size = u32(at + 24), nameLen = u16(at + 28), local = u32(at + 42);
      if (at + 46 + nameLen > bytes.length) throw bad('truncated');
      const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + u16(at + 30) + u16(at + 32);
      if (name.endsWith('/')) continue;
      if (size > MAX_ENTRY || csize > MAX_ENTRY) throw bad(`${name} too large`);
      if (u32(local) !== 0x04034b50) throw bad('bad local header');
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      if (start + csize > bytes.length) throw bad('truncated');
      let data = bytes.subarray(start, start + csize);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (method !== 0) throw bad(`${name} uses unsupported compression ${method}`);
      if (data.length !== size) throw bad(`${name} size mismatch`);
      files.set(name.replace(/^\.\//, ''), data);
    }
    return files;
  }

  /** .krpj (or game.json) bytes -> { game, files }. A file starting with "PK" is a zip, as in krplayer. */
  async function read(bytes) {
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b, files = zip ? await unzip(bytes) : new Map();
    const json = zip ? files.get('game.json') : bytes;
    if (!json) throw new Error('not a valid .krpj: no game.json');
    files.delete('game.json');
    const game = JSON.parse(new TextDecoder().decode(json));
    if (!game || typeof game !== 'object' || !game.krpj_v) throw new Error('not a Kratience game.json (missing krpj_v)');
    for (const k of ['functions', 'objects']) if (game[k] != null && (typeof game[k] !== 'object' || Array.isArray(game[k]))) throw new Error(`game.json: "${k}" is not an object`);
    return { game, files };
  }

  const CRC = new Uint32Array(256).map((_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** Map<path, Uint8Array> -> zip Blob (stored, UTF-8 names), as gm2kr writes them. */
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const [path, data] of files) {
      const name = enc.encode(path), crc = crc32(data);
      const l = new Uint8Array(30 + name.length), lv = new DataView(l.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); l.set(name, 30);
      const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); c.set(name, 46);
      parts.push(l, data); central.push(c);
      offset += l.length + data.length;
    }
    if (files.size > 0xffff || offset > 0xffffffff) throw new Error('project too large for a .krpj (no zip64 support)');
    const cdLen = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.size, true); ev.setUint16(10, files.size, true);
    ev.setUint32(12, cdLen, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  /** game.json text + asset files -> .krpj Blob. */
  const write = (json, files) => zip(new Map([['game.json', new TextEncoder().encode(json)], ...files]));

  const KRPJ_VERSION = '0.2';
  function newProject(title = 'Untitled') {
    const now = Math.floor(Date.now() / 1000);
    return {
      krpj_v: KRPJ_VERSION,
      cfg_db_relay: { slug: '', title, author: '', revision: 1, date_created: now, date_updated: now },
      cfg_gm_compat: { imported_from: null },
      cfg_defaults: { width: 'default', height: 'default', fps: 60, window_title: title },
      cfg_project: { init_room: null },
      sprites: {}, sounds: {}, fonts: {}, functions: {}, objects: {}, rooms: {},
    };
  }

  return { read, write, unzip, newProject, KRPJ_VERSION };
})();
