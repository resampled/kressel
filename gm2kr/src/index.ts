import { readChunks } from './datawin';

const input = document.getElementById('input') as HTMLInputElement;
const log = (msg: string) => { document.getElementById('log')!.textContent += msg + '\n'; };

input.addEventListener('change', async () => {
  const dataWin = [...(input.files ?? [])].find((f) => f.name.toLowerCase() === 'data.win');
  if (!dataWin) return log('error: no data.win found in selection');

  try {
    const chunks = readChunks(await dataWin.arrayBuffer());
    log(`data.win: ${chunks.length} chunks`);
    for (const c of chunks) log(`  ${c.name}  ${c.size} bytes`);
    // TODO: convert chunks -> game.krpj + assets, zip, download
  } catch (e) {
    log(`error: ${(e as Error).message}`);
  }
});
