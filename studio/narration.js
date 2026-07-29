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

  /** Строка собирается из ключа и чисел прямо на узле — тогда она пересобирается сама
      при переключении языка, а не застывает на том, что стоял в момент правки. */
  const put = (node, key, args) => {
    node.dataset.i = key;
    if (args) node.dataset.iArgs = JSON.stringify(args); else delete node.dataset.iArgs;
    node.textContent = window.taktText?.(key, args) ?? node.textContent;
  };

  const fitOf = (text, hold) => {
    const est = text.trim().length / RATE;
    // Сравниваем полной точностью, а показываем округлённо: округлять до сравнения значит
    // менять вердикт об укладке ради вида числа.
    if (!hold || !Number.isFinite(hold)) {
      return { est, state: 'ok', key: 'fitEst', args: { est: est.toFixed(1) } };
    }
    const args = { est: est.toFixed(1), hold: hold.toFixed(1) };
    if (est > hold) return { est, state: 'over', key: 'fitOver', args };
    if (est > hold * TIGHT) return { est, state: 'tight', key: 'fitTight', args };
    return { est, state: 'ok', key: 'fitOk', args };
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
        if (!line.seconds) put(fit, f.key, f.args);
        else if (line.hold) put(fit, 'fitRecordedOf',
                                { sec: line.seconds.toFixed(1), hold: line.hold.toFixed(1) });
        else put(fit, 'fitRecorded', { sec: line.seconds.toFixed(1) });
      };
      refresh();
      area.addEventListener('input', refresh);
      area.addEventListener('change', save);

      speech += line.text.trim().length / RATE;
      li.append(at, area, fit);
      el.list.append(li);
    });

    // Итог — две строки в одном ряду: озвученных может не быть вовсе, а склеенные в
    // одну они переводились бы только целиком, вместе с несуществующим хвостом.
    const voiced = narration.lines.filter((l) => l.state === 'voiced').length;
    el.total.innerHTML = '<span></span><span></span>';
    put(el.total.firstElementChild, 'narrationTotal',
        { n: narration.lines.length, time: mmss(speech) });
    if (voiced) put(el.total.lastElementChild, 'narrationVoiced', { n: voiced });
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
