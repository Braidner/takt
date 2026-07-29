/**
 * Дикторский текст: показ до синтеза и правка на месте.
 *
 * Озвучка пяти минут стоит времени, а опечатка видна сразу — поэтому текст всегда
 * проходит через глаза человека прежде, чем уйдёт в синтез.
 *
 * Главное здесь — проверка укладки. Реплика привязана к моменту титра, и если она длиннее
 * своего окна, то в дорожке наедет на следующую: получатся два голоса разом. Синтез такого
 * не ловит — там каждая реплика сама по себе нормальная, проблема возникает только при
 * раскладке по меткам. Поэтому длина оценивается прямо во время правки, по замеренному
 * темпу, и предупреждение появляется до того, как человек нажмёт «Озвучить».
 */

const RATE = 13.0;        // символов в секунду — замеренный темп синтеза
const TIGHT = 0.9;        // впритык: между дублями темп гуляет на 3-5%

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function setupNarration({ post }) {
  const el = {
    dialog: document.querySelector('.narration'),
    list: document.querySelector('.narration-list'),
    total: document.querySelector('.narration-total'),
    toggle: document.querySelector('.narration-toggle'),
    close: document.querySelector('.narration-close'),
    voice: document.querySelector('.narration-voice'),
  };
  if (!el.dialog) return { render: () => {} };

  let narration = null;

  const fitOf = (text, hold) => {
    const est = text.trim().length / RATE;
    if (!hold || !Number.isFinite(hold)) return { est, state: 'ok', note: `≈ ${est.toFixed(1)} с` };
    if (est > hold) return { est, state: 'over', note: `≈ ${est.toFixed(1)} с — не влезает в ${hold.toFixed(1)} с` };
    if (est > hold * TIGHT) return { est, state: 'tight', note: `≈ ${est.toFixed(1)} с из ${hold.toFixed(1)} с — впритык` };
    return { est, state: 'ok', note: `≈ ${est.toFixed(1)} с из ${hold.toFixed(1)} с` };
  };

  const save = async () => {
    const lines = [...el.list.querySelectorAll('.narration-line')].map((row, i) => ({
      at: narration.lines[i].at,
      hold: narration.lines[i].hold,
      text: row.querySelector('textarea').value,
      state: narration.lines[i].state,
      seconds: narration.lines[i].seconds,
    }));
    await post('/api/narration', { ...narration, lines });
  };

  const render = (next) => {
    narration = next;
    const has = Boolean(narration?.lines?.length);
    if (el.toggle) el.toggle.hidden = !has;
    if (!has) return;

    el.list.innerHTML = '';
    let speech = 0;

    narration.lines.forEach((line, i) => {
      const li = document.createElement('li');
      li.className = 'narration-line';

      const at = document.createElement('span');
      at.className = 'narration-at';
      at.textContent = mmss(line.at);

      const area = document.createElement('textarea');
      area.value = line.text;

      const fit = document.createElement('span');
      fit.className = 'narration-fit';

      const refresh = () => {
        const f = fitOf(area.value, line.hold);
        fit.dataset.fit = f.state;
        // Уже озвученную реплику меряем по факту, а не по оценке: оценка может врать
        // на пару десятых, а записанная длительность — это то, что реально ляжет.
        fit.textContent = line.seconds
          ? `${line.seconds.toFixed(1)} с записано${line.hold ? ` из ${line.hold.toFixed(1)}` : ''}`
          : f.note;
      };
      refresh();
      area.addEventListener('input', refresh);
      area.addEventListener('change', save);

      speech += line.text.trim().length / RATE;
      li.append(at, area, fit);
      el.list.append(li);
    });

    const voiced = narration.lines.filter((l) => l.state === 'voiced').length;
    el.total.textContent = `${narration.lines.length} реплик · речи ≈ ${mmss(speech)}`
      + (voiced ? ` · озвучено ${voiced}` : '');
  };

  el.toggle?.addEventListener('click', () => el.dialog.showModal());
  el.close?.addEventListener('click', () => el.dialog.close());
  el.voice?.addEventListener('click', async () => {
    await save();
    el.voice.disabled = true;
    await post('/api/event', { type: 'narrate' });
    el.dialog.close();
  });

  return { render };
}
