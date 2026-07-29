/**
 * Проверка контраста в обеих темах.
 *
 * Меряем в настоящем браузере с активной вкладкой: в фоновой вкладке CSS-переходы
 * приостанавливаются, и getComputedStyle отдаёт застрявшее старое значение цвета —
 * замер там показывает провалы, которых в реальности нет.
 */
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:4173', { waitUntil: 'domcontentloaded' });

const probe = async (theme) => {
  if (theme === 'light') await p.click('#theme');
  await p.waitForTimeout(500);          // дать переходам доиграть
  return p.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const rgb = (c) => { ctx.fillStyle = '#000'; ctx.fillRect(0,0,1,1); ctx.fillStyle = c; ctx.fillRect(0,0,1,1);
      const d = ctx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
    const lum = (a) => { const [r,g,b2] = a.map(v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); });
      return .2126*r + .7152*g + .0722*b2; };
    const ratio = (x,y) => { const l1 = lum(rgb(x)), l2 = lum(rgb(y));
      return +(((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)).toFixed(2)); };
    const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && !/\/\s*0\)/.test(c)) return c; n = n.parentElement; }
      return getComputedStyle(document.body).backgroundColor; };
    const sel = ['.step-label','.note-body','.note-kind','.voice-meta','.step-time','.track-label',
                 '.panel-head','.ghost','.clock','.voice-title','.agent','.primary','.time-chip','.voice-name'];
    const bad = []; let min = 99;
    for (const s of sel) { const el = document.querySelector(s); if (!el) continue;
      const st = getComputedStyle(el); const r = ratio(st.color, bgOf(el));
      const px = parseFloat(st.fontSize); const big = px >= 18 || (px >= 14 && parseInt(st.fontWeight) >= 700);
      min = Math.min(min, r); if (r < (big ? 3 : 4.5)) bad.push(`${s} = ${r}`); }
    const ta = document.querySelector('.composer textarea');
    const rp = ratio(getComputedStyle(ta, '::placeholder').color, bgOf(ta));
    if (rp < 4.5) bad.push(`плейсхолдер = ${rp}`);
    return { min, bad };
  });
};

console.log('тёмная  ', JSON.stringify(await probe('dark')));
console.log('светлая ', JSON.stringify(await probe('light')));
await b.close();
