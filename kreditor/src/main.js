import { newProject, parseProject, serializeProject } from './project.js';
import { readKrpj, writeKrpj } from './krpj.js';

const $ = (id) => document.getElementById(id);
let project = newProject();
let assets = new Map(); // other files in the open .krpj ("sprites/x/0.png"...), written back on save

function render() {
  document.title = `Editing ${project.cfg_db_relay?.title ?? 'Untitled'}`;
}

// header dropdowns: click a menu to toggle it, click anywhere else to close
document.addEventListener('click', (e) => {
  const menu = e.target.closest('.hdm');
  const opening = menu && e.target.classList.contains('hdmi') && !menu.classList.contains('open');
  document.querySelectorAll('.hdm.open').forEach((m) => m.classList.remove('open'));
  if (opening) menu.classList.add('open');
});

$('btn-new').onclick = () => { project = newProject(); assets = new Map(); render(); };

$('btn-open').onclick = () => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.krpj,.json' });
  input.onchange = async () => {
    try {
      const f = input.files[0];
      if (f.name.toLowerCase().endsWith('.json')) { project = parseProject(await f.text()); assets = new Map(); }
      else {
        const files = await readKrpj(new Uint8Array(await f.arrayBuffer()));
        const main = files.get('game.json');
        if (!main) throw new Error('no game.json in this .krpj');
        project = parseProject(new TextDecoder().decode(main));
        files.delete('game.json');
        assets = files;
      }
      render();
    } catch (e) { alert(e.message); }
  };
  input.click();
};

$('btn-save').onclick = () => {
  const a = document.createElement('a');
  const files = new Map([['game.json', new TextEncoder().encode(serializeProject(project))], ...assets]);
  a.href = URL.createObjectURL(writeKrpj(files));
  a.download = `${project.cfg_db_relay?.slug || 'game'}.krpj`;
  a.click();
  URL.revokeObjectURL(a.href);
};

render();
