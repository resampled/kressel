// Builders for synthetic data.win bytes. Real data.win files never go in the repo (see CLAUDE.md).

export const bytes = (b: number[]): ArrayBuffer => new Uint8Array(b).buffer;

const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A FORM file containing the given [name, body] chunks. */
export function form(chunks: [string, number[]][]): ArrayBuffer {
  const body = chunks.flatMap(([name, data]) => [...tag(name), ...u32(data.length), ...data]);
  return bytes([...tag('FORM'), ...u32(body.length), ...body]);
}

export { u32 };
