// Any audio the browser decodes (Ogg Vorbis) -> Ogg Opus, with WebAudio + WebCodecs. Browser only.

import { oggOpus } from './emit/ogg.ts';

const RATE = 48000; // Opus always decodes at 48 kHz
let ctx: OfflineAudioContext | undefined;

export const canEncodeOpus = () => typeof AudioEncoder !== 'undefined';

/** `kbps` is the total bitrate, whatever the channel count. */
export async function toOpus(data: Uint8Array, kbps: number): Promise<Uint8Array> {
  ctx ??= new OfflineAudioContext(1, 1, RATE);
  const pcm = await ctx.decodeAudioData(data.slice().buffer as ArrayBuffer), ch = pcm.numberOfChannels, frames = pcm.length;
  if (ch > 2) throw new Error(`${ch} channels`);
  const packets: Uint8Array[] = [];
  let preSkip = 312, failed: Error | undefined; // libopus's lookahead, unless the encoder says otherwise (its OpusHead)
  const enc = new AudioEncoder({
    output(chunk, meta) {
      const d = meta?.decoderConfig?.description;
      const h = d && (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d));
      if (h && h.length >= 19 && h[0] === 0x4f) preSkip = h[10] | (h[11] << 8);
      const p = new Uint8Array(chunk.byteLength);
      chunk.copyTo(p);
      packets.push(p);
    },
    error(e) { failed = e; },
  });
  enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: ch, bitrate: kbps * 1000 });
  // A packet of silence follows the audio so the encoder's lookahead doesn't cut the end off (the muxer trims it).
  const total = frames + 960;
  for (let at = 0; at < total && !failed; at += RATE) {
    const n = Math.min(RATE, total - at), buf = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) buf.set(pcm.getChannelData(c).subarray(at, at + n), c * n);
    const audio = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((at / RATE) * 1e6), data: buf });
    enc.encode(audio);
    audio.close();
    while (enc.encodeQueueSize > 4 && !failed) await new Promise((r) => setTimeout(r));
  }
  if (!failed) await enc.flush();
  if (enc.state !== 'closed') enc.close();
  if (failed) throw failed;
  return oggOpus(packets, ch, preSkip, frames);
}
