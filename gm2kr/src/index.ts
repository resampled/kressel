// gm2kr's bundle runs twice: as the page script, and as the page's conversion worker (src/worker.ts).

import { startPage } from './page.ts';
import { startWorker } from './worker.ts';

if (typeof document === 'undefined') startWorker();
else startPage();
