// SOND (sounds), AGRP (audio groups) and AUDO (embedded audio data). Layouts per UndertaleModTool.
// Group 0's audio lives in data.win's AUDO; group N's in audiogroupN.dat (its own FORM with an AUDO chunk).
// Sounds with audio id -1 are external files next to the game (sond.file).

import { FormatError, type Reader } from '../io/reader.ts';
import { chunkReader, readChunks } from '../datawin.ts';

export interface GmSound {
  name: string;
  /** 0x1 embedded, 0x2 compressed, 0x64 GMS2 "regular". */
  flags: number;
  /** File name ("snd_x.ogg" for external files, the sound name for embedded ones). */
  file: string;
  volume: number; pitch: number;
  group: number;
  /** Index into the group's AUDO list, or -1 for an external file. */
  audio: number;
}

export function readSond(r: Reader): GmSound[] {
  return r.ptrList(1 << 16).map((p) => {
    const s = r.at(p);
    const name = s.strPtr(), flags = s.u32();
    s.skip(4); // type (".ogg"/".wav"), often null
    const file = s.strPtr();
    s.skip(4); // effects
    const volume = s.f32(), pitch = s.f32(), group = s.i32(), audio = s.i32();
    return { name, flags, file, volume, pitch, group, audio };
  });
}

/** Audio group names by index. Some GM 2024 builds store null entries (groups with nothing in them). */
export function readAgrp(r: Reader): string[] {
  const n = r.count(1024), out: string[] = [];
  for (let i = 0; i < n; i++) { const p = r.ptr(true); out.push(p ? r.at(p).strPtr() : ''); }
  return out;
}

const MAX_AUDIO = 256 << 20;

/** AUDO entries: u32 length + bytes (WAV or OGG). */
export function readAudo(r: Reader): Uint8Array[] {
  return r.ptrList(1 << 16).map((p) => {
    const a = r.at(p), n = a.u32();
    if (n > MAX_AUDIO) throw new FormatError('AUDO: entry too large', p);
    return a.bytes(n);
  });
}

/** The AUDO list of an audiogroupN.dat file. */
export function readAudioGroupFile(buf: ArrayBuffer): Uint8Array[] {
  const r = chunkReader(buf, readChunks(buf), 'AUDO');
  if (!r) throw new FormatError('audio group file has no AUDO chunk', 0);
  return readAudo(r);
}

/** Guesses a file extension from the data's magic bytes. */
export function audioExt(data: Uint8Array): string {
  const m = String.fromCharCode(data[0], data[1], data[2], data[3]);
  return m === 'OggS' ? 'ogg' : m === 'RIFF' ? 'wav' : m.startsWith('ID3') || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) ? 'mp3' : 'bin';
}
