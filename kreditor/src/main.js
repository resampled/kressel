import { newProject, parseProject, serializeProject } from './project.js';

const $ = (id) => document.getElementById(id);
let project = newProject();

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

$('btn-new').onclick = () => { project = newProject(); render(); };

$('btn-open').onclick = () => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.krpj,application/json' });
  input.onchange = async () => {
    try { project = parseProject(await input.files[0].text()); render(); }
    catch (e) { alert(e.message); }
  };
  input.click();
};

$('btn-save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([serializeProject(project)], { type: 'application/json' }));
  a.download = 'game.krpj';
  a.click();
  URL.revokeObjectURL(a.href);
};

render();
