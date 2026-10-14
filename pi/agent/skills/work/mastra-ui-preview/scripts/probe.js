(() => {
  const main = document.querySelector('[data-slot="page-layout"] > main');
  if (!main) return JSON.stringify({ path: location.pathname, noLayout: true });
  const sc = [main, ...main.querySelectorAll('*')].find(e => ['auto','scroll'].includes(getComputedStyle(e).overflowY));
  const content = sc === main ? main.firstElementChild : (sc.firstElementChild && sc.firstElementChild.firstElementChild ? sc.firstElementChild : sc.firstElementChild);
  const cr = content ? content.getBoundingClientRect() : null;
  const mr = main.getBoundingClientRect();
  return JSON.stringify({
    path: location.pathname,
    gutter: sc ? getComputedStyle(sc).scrollbarGutter : null,
    mainW: Math.round(mr.width), mainH: Math.round(mr.height),
    scrollerOffW: sc && sc.offsetWidth, scrollerClientW: sc && sc.clientWidth,
    scrolls: sc ? sc.scrollHeight > sc.clientHeight : null,
    contentX: cr && Math.round(cr.left - mr.left), contentW: cr && Math.round(cr.width), contentH: cr && Math.round(cr.height),
  });
})()
