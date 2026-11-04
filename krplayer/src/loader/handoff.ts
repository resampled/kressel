// Handing an in-memory project to a player window (used by gm2kr's "Play" button).
//
//   sender                                  player (opened with ?from=opener)
//   window.open(playerUrl?from=opener) ──►  boots, posts { type: 'kr-player-ready' } to opener
//   posts { type: 'kr-project', files } ◄─┘ (ArrayBuffers transferred, not copied)
//
// The player only accepts the message from its own opener. A project received this way is
// treated like any other untrusted project (it runs in the player's sandbox of builtins).

export const READY = 'kr-player-ready';
export const PROJECT = 'kr-project';

export interface ProjectMessage { type: typeof PROJECT; files: Record<string, ArrayBuffer> }

/** Player side: announces readiness to window.opener and resolves with the files it sends back. */
export function receiveFromOpener(timeoutMs = 30000): Promise<Map<string, Uint8Array>> {
  const opener = window.opener as Window | null;
  if (!opener) return Promise.reject(new Error('no opener window to receive a project from'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener('message', onMessage); reject(new Error('timed out waiting for the project')); }, timeoutMs);
    function onMessage(e: MessageEvent) {
      if (e.source !== opener || e.data?.type !== PROJECT) return;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      const files = new Map<string, Uint8Array>();
      for (const [path, buf] of Object.entries((e.data as ProjectMessage).files)) {
        if (buf instanceof ArrayBuffer) files.set(path, new Uint8Array(buf));
      }
      resolve(files);
    }
    addEventListener('message', onMessage);
    opener.postMessage({ type: READY }, '*'); // carries no data; the reply is checked by source
  });
}

/** Sender side: opens the player and sends the project once it reports ready. Copies the files. */
export function sendToPlayer(playerUrl: string, files: Map<string, Uint8Array>): void {
  const url = new URL(playerUrl, location.href);
  url.searchParams.set('from', 'opener');
  const win = window.open(url.href, '_blank');
  if (!win) throw new Error('the player window was blocked (allow pop-ups for this page)');
  const onMessage = (e: MessageEvent) => {
    if (e.source !== win || e.data?.type !== READY) return;
    removeEventListener('message', onMessage);
    const out: Record<string, ArrayBuffer> = {};
    for (const [path, data] of files) out[path] = data.slice().buffer as ArrayBuffer;
    win.postMessage({ type: PROJECT, files: out } satisfies ProjectMessage, url.origin, Object.values(out));
  };
  addEventListener('message', onMessage);
}
