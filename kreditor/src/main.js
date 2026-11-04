import { newProject, parseProject, serializeProject } from './project.js';

const $ = (id) => document.getElementById(id);
let project = newProject();

function render() {
  $('resources').innerHTML = ['sprites', 'sounds', 'fonts']
    .map((k) => `<h4>${k}</h4>` + Object.values(project[k] ?? {}).map((r) => `<div>${r.name}</div>`).join(''))
    .join('');
  $('inspector').textContent = project.cfg_db_relay?.title ?? '';
}

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
