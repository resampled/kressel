import type { Krpj } from './krpj.ts';

async function loadProject(src: string): Promise<Krpj> {
  const url = new URL(src, location.href);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kressel: failed to load ${url} (${res.status})`);
  return res.json();
}

async function boot() {
  const src = document.getElementById('kressel-load-project')?.getAttribute('src');
  if (!src) return console.error('kressel: no <meta id="kressel-load-project" src="..."> found');

  const project = await loadProject(src);
  const { width, height, window_title } = project.cfg_defaults;
  const canvas = document.createElement('canvas');
  canvas.width = width === 'default' ? 640 : width;
  canvas.height = height === 'default' ? 480 : height;
  document.title = window_title;
  document.body.appendChild(canvas);
  console.info(`kressel: loaded "${project.cfg_db_relay.title}" (krpj ${project.krpj_v})`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
