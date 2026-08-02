/**
 * Сцена и применение кадра. Тонкий слой у композиции: вся геометрия уже посчитана
 * в frame.mjs числами, здесь она только доносится до стилей. Логики нет намеренно —
 * всё, что можно проверить без браузера, живёт в frame.mjs под тестами.
 *
 * Layout — из прототипа панорамы, которым утверждалась спека: фон двумя
 * радиальными пятнами, окно с горошинами, виньетка. Титры и курсор следуют
 * titles.mjs — брендовая типографика, а не системный шрифт.
 */
const W = 1920, H = 1080;

export function mountScene(root, film, base) {
  const { w: sw, h: sh } = film.screen;
  // Окно прототипа: 1330 из 1920 по ширине, экран вписан масштабом.
  const winW = 1330, scale = winW / sw;

  root.innerHTML = `
    <div class="scene" style="position:relative;width:${W}px;height:${H}px;overflow:hidden;
      background:radial-gradient(72% 92% at 78% 4%,#14335f,transparent 62%),
                 radial-gradient(60% 80% at 8% 98%,#0d3b34,transparent 60%),
                 linear-gradient(158deg,#0b1120,#070a11 72%)">
      <div class="window" style="position:absolute;left:${(W - winW) / 2}px;top:54px;width:${winW}px;
        border-radius:14px;overflow:hidden;background:#12161d;
        box-shadow:0 60px 120px -22px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.07),
                   0 0 160px -50px rgba(1,98,228,.5)">
        <div style="height:40px;display:flex;align-items:center;gap:9px;padding:0 16px;
          background:linear-gradient(#242a34,#1b2029)">
          <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
          <span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
          <span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
          <span style="margin-left:18px;color:rgba(255,255,255,.45);
            font:500 15px 'Golos Text',system-ui,sans-serif">${film.title}</span>
        </div>
        <div class="stage" style="position:relative;width:${winW}px;height:${Math.round(sh * scale)}px;
          overflow:hidden"></div>
      </div>
      <div style="position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(118% 90% at 50% 42%,transparent 54%,rgba(0,0,0,.5))"></div>
      <div class="caption" style="position:absolute;left:0;right:0;bottom:58px;text-align:center;
        padding:0 140px"><div style="overflow:hidden;padding-bottom:12px"><div class="caption-text"
        style="font:800 50px/1.1 'Unbounded',system-ui,sans-serif;color:#fff;
        letter-spacing:-.035em;text-shadow:0 12px 48px rgba(0,0,0,.9);
        transform:translateY(110%)"></div></div></div>
    </div>`;

  const stage = root.querySelector('.stage');
  const screens = new Map();
  for (const plan of film.plans) {
    // Карточка рисуется поверх всей сцены, а не внутри окна-мокапа: заставка — это
    // не экран продукта, а обложка ролика.
    if (plan.kind === 'card') {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;inset:0;display:none;place-content:center;
        justify-items:center;text-align:center;gap:26px;
        background:${plan.card === 'end' ? 'rgba(9,11,16,.92)' : 'transparent'}`;
      el.innerHTML = `
        <div class="card-text" style="font:800 ${plan.card === 'end' ? 84 : 96}px/1.05
          'Unbounded',system-ui,sans-serif;color:#f4f6fa;letter-spacing:-.03em;
          max-width:1500px"></div>
        ${plan.subtitle ? `<div class="card-sub" style="font:500 34px/1.4 'Golos Text',
          system-ui,sans-serif;color:#aab3c2;max-width:1300px"></div>` : ''}
        <div style="width:${plan.card === 'end' ? 140 : 120}px;height:4px;border-radius:2px;
          background:linear-gradient(96deg,#0162e4,#089efb 45%,#00e0b8)"></div>
        ${plan.url ? `<div class="card-url" style="font:500 34px/1 ui-monospace,
          'JetBrains Mono',monospace;color:#56b6ff"></div>` : ''}`;
      el.querySelector('.card-text').textContent = plan.text || '';
      if (plan.subtitle) el.querySelector('.card-sub').textContent = plan.subtitle;
      if (plan.url) el.querySelector('.card-url').textContent = plan.url;
      // Карточка вне окна-мокапа: она перекрывает всю сцену целиком.
      root.querySelector('.scene').append(el);
      screens.set(plan.id, { el, card: true });
      continue;
    }

    // Экран на план создаётся один раз и дальше только переключается видимостью:
    // пересоздавать DOM на каждом кадре — значит терять кеш декодированных картинок.
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;display:none';
    // Внутри — виртуальный экран в CSS-пикселях съёмки, вписанный масштабом:
    // так вся геометрия кадра остаётся в одной шкале со снимками и якорями.
    el.innerHTML = `
      <div class="cam" style="position:absolute;left:0;top:0;width:${sw}px;height:${sh}px;
        transform-origin:0 0;transform:scale(${scale})">
        <div class="zoom" style="position:absolute;inset:0;transform-origin:0 0">
          <img class="body" src="${base}${plan.state.body}" style="position:absolute;left:0;top:0;
            width:${sw}px;will-change:transform">
          ${plan.state.sticky.map((b) => `
            <div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;
              height:${b.h}px;overflow:hidden">
              <img src="${base}${plan.state.layer}" style="position:absolute;
                left:${-b.x}px;top:${-b.y}px;width:${sw}px"></div>`).join('')}
          <div class="cursor" style="position:absolute;left:0;top:0;width:26px;height:26px;
            margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,255,255,.9);
            box-shadow:0 0 0 5px rgba(255,255,255,.28),0 6px 22px rgba(0,0,0,.5);
            opacity:0;will-change:transform"></div>
        </div>
      </div>`;
    stage.appendChild(el);
    screens.set(plan.id, {
      el, zoom: el.querySelector('.zoom'), body: el.querySelector('.body'),
      cursor: el.querySelector('.cursor'),
    });
  }

  return { screens, window: root.querySelector('.window'),
           captionText: root.querySelector('.caption-text'), lastText: '' };
}

export function applyFrame(scene, desc) {
  for (const [, s] of scene.screens) s.el.style.display = 'none';
  for (const d of desc.screens) {
    const s = scene.screens.get(d.plan);
    s.el.style.display = s.card ? 'grid' : '';
    s.el.style.opacity = String(d.opacity * (d.appear ?? 1));
    if (s.card) continue;
    s.body.style.transform = `translateY(${-d.scrollY}px)`;
    // Окно камеры: сначала сдвиг к окну, затем масштаб — семантика zoompan.
    s.zoom.style.transform =
      `scale(${d.camera.scale}) translate(${-d.camera.x}px,${-d.camera.y}px)`;
    if (d.cursor) {
      s.cursor.style.opacity = String(d.cursor.opacity);
      // Курсор целится в якорь — его координаты в шкале СТРАНИЦЫ, а рисуется он
      // в шкале экрана: прокрутку надо вычесть. На планах с наездом scrollY = 0,
      // поэтому смоук такую ошибку не поймал бы.
      s.cursor.style.transform = `translate(${d.cursor.x}px,${d.cursor.y - d.scrollY}px)`
        + (d.cursor.pressed ? ' scale(.72)' : '');
    } else {
      s.cursor.style.opacity = '0';
    }
  }
  // Под карточкой окно продукта не показывается: это обложка, а не кадр интерфейса.
  const карточка = desc.screens.some((d) => scene.screens.get(d.plan)?.card);
  if (scene.window) scene.window.style.visibility = карточка ? 'hidden' : '';

  const cap = desc.caption;
  if (cap) {
    if (cap.text !== scene.lastText) {
      scene.captionText.textContent = cap.text;
      scene.lastText = cap.text;
    }
    scene.captionText.style.transform = `translateY(${110 - 110 * cap.progress}%)`;
  } else {
    scene.captionText.style.transform = 'translateY(110%)';
  }
}
