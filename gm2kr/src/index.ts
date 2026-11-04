import { chunkReader, readChunks } from './datawin.ts';
import { readGen8 } from './chunks/gen8.ts';
import { detectFormat } from './format.ts';

const input = document.getElementById('input') as HTMLInputElement;
const log = (msg: string) => { document.getElementById('log')!.textContent += msg + '\n'; };

input.addEventListener('change', async () => {
  const dataWin = [...(input.files ?? [])].find((f) => f.name.toLowerCase() === 'data.win');
  if (!dataWin) return log('error: no data.win found in selection');

  try {
    const buf = await dataWin.arrayBuffer();
    const chunks = readChunks(buf);
    log(`data.win: ${chunks.length} chunks`);
    for (const c of chunks) log(`  ${c.name}  ${c.size} bytes`);
    const gen8r = chunkReader(buf, chunks, 'GEN8');
    if (!gen8r) return log('error: no GEN8 chunk');
    const gen8 = readGen8(gen8r);
    log(`game: ${gen8.name} ${gen8.version.join('.')}, format ${JSON.stringify(detectFormat(gen8, chunks))}`);
    // TODO: convert chunks -> game.krpj + assets, zip, download
  } catch (e) {
    log(`error: ${(e as Error).message}`);
  }
});
