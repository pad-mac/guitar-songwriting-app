// Drag to reorder the items of a container, and long-press menus.
//   touch: hold ~0.3 s and the item lifts (move now to drag it); keep holding and the menu opens
//          while the finger is still down; moving the finger then closes the menu and drags instead
//   mouse: drag once moved a few pixels; right-click = menu
// onMenu(el, at) opens a menu and returns it (with .close()). Without onOrder: menu only.

const LIFT_MS = 300, MENU_MS = 560;

export function sortable(container, { items, onOrder, onMenu }) {
  let st = null;
  let swallowClick = false;
  const all = () => [...container.querySelectorAll(items)];
  const ids = () => all().map((el) => Number(el.dataset.id));

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st) return;
    const el = e.target.closest(items);
    if (!el || !container.contains(el) || e.target.closest('input, textarea')) return;
    st = { el, id: e.pointerId, touch: e.pointerType !== 'mouse', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, lifted: false, dragging: false, menu: null };
    if (st.touch) {
      if (onOrder) st.timer = setTimeout(lift, LIFT_MS);
      if (onMenu) st.menuTimer = setTimeout(openMenu, onOrder ? MENU_MS : 460);
    }
  });

  function openMenu() {
    if (!st || st.dragging) return;
    st.lifted = true;
    st.el.classList.remove('lifted');
    navigator.vibrate?.(8);
    st.menuAt = { x: st.x, y: st.y };
    st.menu = onMenu(st.el, { x: st.x, y: st.y, el: st.el, held: true }) || null;
  }

  function lift() {
    if (!st) return;
    st.lifted = true;
    st.el.classList.add('lifted');
    navigator.vibrate?.(10);
  }

  document.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.x = e.clientX; st.y = e.clientY;
    const dist = Math.hypot(e.clientX - st.x0, e.clientY - st.y0);
    if (st.dragging) return moveDrag();
    if (st.touch && !st.lifted) { if (dist > 8) cancel(); return; }
    if (st.menu) {     // the menu is open and the finger moves on: it becomes a drag
      if (onOrder && Math.hypot(e.clientX - st.menuAt.x, e.clientY - st.menuAt.y) > 12) {
        st.menu.close?.();
        st.menu = null;
        startDrag();
      }
      return;
    }
    if (onOrder && ((st.touch && st.lifted && dist > 6) || (!st.touch && dist > 5))) startDrag();
  });
  // once an item is lifted, the finger drags it instead of scrolling the page
  document.addEventListener('touchmove', (e) => { if (st && (st.lifted || st.dragging)) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', (e) => { if (st && e.pointerId === st.id) finish(true); });
  // after a hold or a drag, the finger's lift must not also "click" whatever is now under it
  let eatTouchEnd = false;
  document.addEventListener('touchend', (e) => { if (eatTouchEnd) { eatTouchEnd = false; e.preventDefault(); } }, { passive: false });
  document.addEventListener('pointercancel', (e) => { if (st && e.pointerId === st.id) finish(false); });

  container.addEventListener('contextmenu', (e) => {
    const el = e.target.closest(items);
    if (!el || e.target.closest('input')) return;
    e.preventDefault();
    if (st?.touch) return;            // touch long-press is handled above
    onMenu?.(el, { x: e.clientX, y: e.clientY, el, held: false });
  });
  container.addEventListener('click', (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); }
  }, true);

  function cancel() {
    clearTimeout(st.timer);
    clearTimeout(st.menuTimer);
    st.el.classList.remove('lifted');
    st = null;
  }

  function startDrag() {
    clearTimeout(st.timer);
    clearTimeout(st.menuTimer);
    st.dragging = true;
    st.before = ids().join(',');
    const r = st.el.getBoundingClientRect();
    st.offX = st.x0 - r.left;
    st.offY = st.y0 - r.top;
    const ghost = st.el.cloneNode(true);
    ghost.classList.remove('lifted');
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.appendChild(ghost);
    st.ghost = ghost;
    st.el.classList.add('drag-placeholder');
    st.el.classList.remove('lifted');
    document.body.classList.add('dragging');
    autoScroll();
    moveDrag();
  }

  function moveDrag() {
    st.ghost.style.left = st.x - st.offX + 'px';
    st.ghost.style.top = st.y - st.offY + 'px';
    // hit-test against layout positions (offsetLeft/Top ignore the glide transforms;
    // on-screen positions would make an item that is still gliding away swap straight back)
    const cr = container.getBoundingClientRect();
    const px = st.x - cr.left, py = st.y - cr.top;
    const list = all();
    const over = list.find((el) => el !== st.el && px >= el.offsetLeft && px < el.offsetLeft + el.offsetWidth && py >= el.offsetTop && py < el.offsetTop + el.offsetHeight);
    if (!over) return;
    const from = list.indexOf(st.el), to = list.indexOf(over);
    const wide = over.offsetWidth > container.clientWidth * 0.7;     // a section row
    const after = wide ? py > over.offsetTop + over.offsetHeight / 2 : to > from;
    const ref = after ? over.nextElementSibling : over;
    if (ref === st.el || (!after && over.previousElementSibling === st.el)) return;   // already there
    flip(() => container.insertBefore(st.el, ref));
  }

  // move in the DOM, then let the other items glide to their new places
  function flip(mutate) {
    const els = all();
    const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
    mutate();
    for (const el of els) {
      if (el === st.el) continue;
      const b = before.get(el), a = el.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (!dx && !dy) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.getBoundingClientRect();
      el.style.transition = 'transform 170ms cubic-bezier(.25,.8,.3,1)';
      el.style.transform = '';
    }
  }

  function autoScroll() {
    if (!st?.dragging) return;
    const edge = 80, h = window.innerHeight;
    let v = 0;
    if (st.y < edge) v = -Math.ceil((edge - st.y) / 6);
    else if (st.y > h - edge) v = Math.ceil((st.y - (h - edge)) / 6);
    if (v) { window.scrollBy(0, v); moveDrag(); }
    requestAnimationFrame(autoScroll);
  }

  function finish(ok) {
    const s = st;
    st = null;
    clearTimeout(s.timer);
    clearTimeout(s.menuTimer);
    if (s.touch && (s.lifted || s.dragging)) eatTouchEnd = true;
    if (s.menu) window.dispatchEvent(new Event('gsa:lp-up'));     // the menu may take taps from now on
    s.el.classList.remove('lifted');
    if (s.dragging) {
      swallowClick = true;
      s.ghost.remove();
      s.el.classList.remove('drag-placeholder');
      document.body.classList.remove('dragging');
      const after = ids();
      if (ok && after.join(',') !== s.before) onOrder(after);
      else if (!ok) {   // cancelled: put everything back as it was
        for (const id of s.before.split(',')) container.appendChild(container.querySelector(`[data-id="${id}"]`));
      }
    } else if (s.lifted) {
      swallowClick = true;
    }
    setTimeout(() => { swallowClick = false; }, 400);
  }
}
