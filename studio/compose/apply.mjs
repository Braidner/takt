/**
 * Сцена и применение кадра. Тонкий слой у композиции: вся геометрия уже посчитана
 * в frame.mjs числами, здесь она только доносится до стилей. Логики нет намеренно —
 * всё, что можно проверить без браузера, живёт в frame.mjs под тестами.
 *
 * Layout — из прототипа панорамы, которым утверждалась спека: фон двумя
 * радиальными пятнами, окно с горошинами, виньетка. Титры и курсор — брендовая
 * типографика, та же, что в студии, а не системный шрифт.
 */
/**
 * Формат кадра. Вертикаль — не обрезанная широкая сцена, а своя вёрстка: интерфейс
 * горизонтальный, и в 9:16 он помещается только целиком и мельче, зато остаётся
 * читаемым. Пустоту сверху и снизу занимает титр — в ленте смотрят без звука, и
 * текст там важнее воздуха.
 */
export const FORMATS = {
  wide: { w: 1920, h: 1080, window: 1330, top: 54, capBottom: 58, capSize: 50, capPad: 140 },
  // Окно вертикали выше пропорций экрана намеренно: масштаб интерфейса тот же, но в
  // кадр попадает больше страницы. Вписать экран целиком значило бы отдать две трети
  // кадра пустоте, а в ленте пустота — это пролистывание.
  vertical: { w: 1080, h: 1920, window: 1010, top: 210, stage: 1060,
              capBottom: 300, capSize: 56, capPad: 60 },
};

export function mountScene(root, film, base) {
  const { w: sw, h: sh } = film.screen;
  const fmt = FORMATS[film.format] || FORMATS.wide;
  const W = fmt.w, H = fmt.h;
  // Окно вписывается по ширине формата, экран внутри — масштабом.
  const winW = fmt.window, scale = winW / sw;

  root.innerHTML = `
    <div class="scene" style="position:relative;width:${W}px;height:${H}px;overflow:hidden;
      background:radial-gradient(72% 92% at 78% 4%,#14335f,transparent 62%),
                 radial-gradient(60% 80% at 8% 98%,#0d3b34,transparent 60%),
                 linear-gradient(158deg,#0b1120,#070a11 72%)">
      <div class="window" style="position:absolute;left:${(W - winW) / 2}px;top:${fmt.top}px;width:${winW}px;
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
        <div class="stage" style="position:relative;width:${winW}px;
          height:${fmt.stage || Math.round(sh * scale)}px;overflow:hidden"></div>
      </div>
      <div style="position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(118% 90% at 50% 42%,transparent 54%,rgba(0,0,0,.5))"></div>
      <div class="caption" style="position:absolute;left:0;right:0;bottom:${fmt.capBottom}px;
        text-align:center;
        padding:0 ${fmt.capPad}px"><div style="overflow:hidden;padding-bottom:12px"><div class="caption-text"
        style="font:800 ${fmt.capSize}px/1.1 'Unbounded',system-ui,sans-serif;color:#fff;
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
        <div class="card-text" style="font:800 ${Math.round((plan.card === 'end' ? 84 : 96) * W / 1920)}px/1.05
          'Unbounded',system-ui,sans-serif;color:#f4f6fa;letter-spacing:-.03em;
          max-width:${Math.round(W * 0.78)}px"></div>
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
    // Живой план показывает запись, а не снимок: содержание такого плана — само
    // движение интерфейса, и собрать его из состояний нельзя.
    if (plan.kind === 'live') {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0;display:none';
      el.innerHTML = `<video class="live" src="${base}${plan.video}" muted playsinline
        preload="auto" style="position:absolute;inset:0;width:100%;height:100%;
        object-fit:cover"></video>`;
      stage.appendChild(el);
      screens.set(plan.id, { el, live: el.querySelector('video') });
      continue;
    }

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
          <div class="overlays" style="position:absolute;inset:0;pointer-events:none"></div>
          <div class="cursor" style="position:absolute;left:0;top:0;width:26px;height:26px;
            margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,255,255,.9);
            box-shadow:0 0 0 5px rgba(255,255,255,.28),0 6px 22px rgba(0,0,0,.5);
            opacity:0;will-change:transform"></div>
        </div>
      </div>`;
    stage.appendChild(el);
    screens.set(plan.id, {
      el, zoom: el.querySelector('.zoom'), body: el.querySelector('.body'),
      overlays: el.querySelector('.overlays'), cursor: el.querySelector('.cursor'),
      drawn: new Map(),
    });
  }

  return { screens, window: root.querySelector('.window'),
           captionText: root.querySelector('.caption-text'), lastText: '' };
}

/**
 * Наложения: подсветить, указать, подписать, размыть.
 *
 * Узлы создаются один раз на эффект и дальше только меняют непрозрачность: пересоздание
 * на каждом кадре стоило бы перерисовки блюра, а он самый дорогой из всего, что здесь
 * рисуется.
 *
 * Координаты — в шкале страницы, поэтому слой живёт внутри той же обёртки, что и снимок:
 * он едет вместе с панорамой и масштабируется вместе с наездом, как и должно быть у
 * пометки, привязанной к элементу интерфейса.
 */
function drawOverlays(screen, desc) {
  const живые = new Set();
  for (const o of desc.overlays || []) {
    живые.add(o.id);
    let node = screen.drawn.get(o.id);
    if (!node) {
      node = document.createElement('div');
      node.style.cssText = 'position:absolute;pointer-events:none';
      node.innerHTML = overlayHTML(o);
      node.dataset.place = o.place || 'above';
      screen.overlays.append(node);
      screen.drawn.set(o.id, node);
    }
    const r = o.rect || { x: 0, y: 0, w: 0, h: 0 };
    // Выноска и стрелка ставятся у цели, подсветка и размытие — по ней самой.
    const поле = o.what === 'spotlight' || o.what === 'blur' ? 12 : 0;
    node.style.left = `${r.x - поле}px`;
    node.style.top = `${r.y - поле}px`;
    node.style.width = `${r.w + поле * 2}px`;
    node.style.height = `${r.h + поле * 2}px`;
    node.style.opacity = String(o.opacity);
    if ((o.what === 'callout' || o.what === 'arrow') && node.dataset.place !== o.place) {
      node.dataset.place = o.place;
      node.innerHTML = overlayHTML(o);
    }
  }
  for (const [id, node] of screen.drawn) {
    if (!живые.has(id)) node.style.opacity = '0';
  }
}

function overlayHTML(o) {
  if (o.what === 'blur') {
    return `<div style="position:absolute;inset:0;backdrop-filter:blur(14px);
      border-radius:10px"></div>`;
  }
  if (o.what === 'arrow') {
    // Стрелка приходит сбоку и упирается в цель, не закрывая её. Сторону берём ту же,
    // что у выноски: у цели под верхним краем стрелка сверху обрезалась бы окном.
    const снизу = o.place === 'below';
    const бок = снизу ? 'right:100%;top:100%' : 'right:100%;bottom:100%';
    const путь = снизу
      ? { line: 'M4 116 C 40 90, 60 60, 96 24', head: 'M96 24 L 74 28 L 92 46 Z' }
      : { line: 'M4 4 C 40 30, 60 60, 96 96', head: 'M96 96 L 74 92 L 92 74 Z' };
    return `<svg viewBox="0 0 120 120" style="position:absolute;${бок};
      width:120px;height:120px;overflow:visible">
      <path d="${путь.line}" stroke="#00e0b8" stroke-width="7"
        fill="none" stroke-linecap="round"/>
      <path d="${путь.head}" fill="#00e0b8"/></svg>`;
  }
  if (o.what === 'callout') {
    // Сторона выноски приходит из кадра: у цели под верхним краем она уходила бы
    // за границу окна вместе с текстом.
    const место = o.place === 'below'
      ? 'top:calc(100% + 14px)' : 'bottom:calc(100% + 14px)';
    return `<div style="position:absolute;left:50%;${место};
      transform:translateX(-50%);white-space:nowrap;
      padding:10px 18px;border-radius:12px;background:rgba(9,11,16,.92);
      box-shadow:0 0 0 1px rgba(0,224,184,.5), 0 18px 40px -12px rgba(0,0,0,.8);
      font:600 26px/1.2 'Golos Text',system-ui,sans-serif;color:#f4f6fa">${o.text || ''}</div>
      <div style="position:absolute;inset:0;border-radius:10px;
        box-shadow:0 0 0 3px rgba(0,224,184,.75)"></div>`;
  }
  // Подсветка: затемняем всё, кроме цели, огромной тенью вокруг неё.
  return `<div style="position:absolute;inset:0;border-radius:12px;
    box-shadow:0 0 0 9999px rgba(4,6,12,.66), 0 0 0 3px rgba(255,255,255,.28)"></div>`;
}

export function applyFrame(scene, desc) {
  for (const [, s] of scene.screens) s.el.style.display = 'none';
  for (const d of desc.screens) {
    const s = scene.screens.get(d.plan);
    s.el.style.display = s.card ? 'grid' : '';
    s.el.style.opacity = String(d.opacity * (d.appear ?? 1));
    if (s.card) continue;
    if (s.live) {
      // Перематываем только когда действительно надо: лишний seek сбрасывает
      // декодер и заставляет кадр моргнуть.
      if (Math.abs(s.live.currentTime - d.video.t) > 0.005) s.live.currentTime = d.video.t;
      continue;
    }
    s.body.style.transform = `translateY(${-d.scrollY}px)`;
    // Окно камеры: сначала сдвиг к окну, затем масштаб — семантика zoompan.
    s.zoom.style.transform =
      `scale(${d.camera.scale}) translate(${-d.camera.x}px,${-d.camera.y}px)`;
    drawOverlays(s, d);
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
