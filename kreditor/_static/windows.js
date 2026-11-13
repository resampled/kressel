// Windows: .w panels inside .desk. Drag by .wtop, [data-act=max] toggles filling the desk, [data-act=close] hides
// the window (fires 'wclose' on it). kw.open(w) shows a window again and brings it to the front.
const kw = (() => {
  let z = 0;
  const front = (w) => { w.style.zIndex = ++z; };
  const open = (w) => { w.hidden = false; front(w); };
  const close = (w) => { w.hidden = true; w.dispatchEvent(new Event('wclose')); };
  const toggleMax = (w) => w.classList.toggle('max');

  function drag(e, w) {
    if (e.button !== 0 || e.target.closest('.wbtn') || w.classList.contains('max')) return;
    e.preventDefault();
    const desk = w.parentElement, top = e.currentTarget, ox = e.clientX - w.offsetLeft, oy = e.clientY - w.offsetTop;
    const move = (m) => {
      w.style.left = Math.max(0, Math.min(m.clientX - ox, desk.clientWidth - w.offsetWidth)) + 'px';
      w.style.top = Math.max(0, Math.min(m.clientY - oy, desk.clientHeight - top.offsetHeight)) + 'px';
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  function init() {
    for (const w of document.querySelectorAll('.w')) {
      const top = w.querySelector('.wtop');
      w.addEventListener('pointerdown', () => front(w), true);
      top.addEventListener('pointerdown', (e) => drag(e, w));
      top.addEventListener('dblclick', (e) => { if (!e.target.closest('.wbtn')) toggleMax(w); });
      top.addEventListener('click', (e) => {
        const act = e.target.closest('.wbtn')?.dataset.act;
        if (act === 'max') toggleMax(w); else if (act === 'close') close(w);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { open, close, front, toggleMax };
})();
