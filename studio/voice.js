/**
 * Голос диктора: запись прямо в браузере и загрузка файла.
 *
 * Запись на месте стоит здесь первой не для красоты. Качество исходника — главный
 * ограничитель клонирования, важнее любых настроек синтеза: полторы минуты, наговорённые
 * в тишине, дают сходство заметно выше, чем вырезка из старого ролика с фоновым шумом.
 * Прятать этот способ за «прочее» значит подталкивать к худшему варианту.
 *
 * Согласие спрашивается до записи чужого голоса и сохраняется рядом с ней. Это требование
 * закона, а не формальность: голос человека охраняется, и синтез допустим только с
 * разрешения его обладателя. Через месяц никто не вспомнит, спрашивали ли.
 */

const MIN_SECONDS = 20;   // короче — модели не хватает материала на устойчивый тембр
const GOOD_SECONDS = 60;  // от минуты сходство заметно лучше

export function setupVoice({ post, getToken }) {
  const el = {
    cards: document.querySelector('.voice-cards'),
    record: document.querySelector('.rec'),
    upload: document.querySelector('[data-i="upload"]'),
  };
  if (!el.record) return { render: () => {} };

  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let timer = null;

  const stopRecording = () => recorder?.state === 'recording' && recorder.stop();

  /** Имя и согласие спрашиваем ДО записи: после — человек уже наговорил впустую. */
  const askMeta = (source) => {
    const name = prompt(source === 'record'
      ? 'Чей это голос? Имя появится в каталоге'
      : 'Чей голос в файле?');
    if (!name) return null;
    const consent = confirm(
      `Подтвердите: ${name} согласен, что этим голосом будет говорить синтез.\n\n`
      + 'Голос человека охраняется законом — записывать чужой голос без его разрешения нельзя.');
    if (!consent) return null;
    return { name: name.trim(), consentBy: name.trim() };
  };

  el.record.addEventListener('click', async () => {
    if (recorder?.state === 'recording') return stopRecording();

    const meta = askMeta('record');
    if (!meta) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      // Обработка звука браузером выключена намеренно: шумодав и автоусиление срезают
      // обертоны, по которым голос узнаётся, — то же, чего мы избегаем при подготовке.
      alert('Микрофон недоступен. Разрешите доступ в настройках браузера.');
      return;
    }

    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      const seconds = (Date.now() - startedAt) / 1000;
      el.record.textContent = 'Записать сейчас';
      el.record.classList.remove('rec-active');

      if (seconds < MIN_SECONDS) {
        alert(`Слишком коротко: ${Math.round(seconds)} с. Нужно хотя бы ${MIN_SECONDS},`
              + ` а лучше около ${GOOD_SECONDS} — от этого сходство зависит сильнее всего.`);
        return;
      }

      const blob = new Blob(chunks, { type: 'audio/webm' });
      const audio = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      await post('/api/voice', { ...meta, audio, mime: 'audio/webm', seconds, source: 'record', consent: true });
    };

    startedAt = Date.now();
    recorder.start();
    el.record.classList.add('rec-active');
    timer = setInterval(() => {
      const s = Math.round((Date.now() - startedAt) / 1000);
      // Счётчик показывает не только время, но и достаточно ли уже: без этого человек
      // либо останавливается слишком рано, либо наговаривает лишние пять минут.
      el.record.textContent = s < MIN_SECONDS
        ? `Запись ${s} с — мало`
        : `Запись ${s} с — хватит, нажмите чтобы остановить`;
    }, 250);
  });

  el.upload?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,video/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const meta = askMeta('file');
      if (!meta) return;
      const audio = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(file);
      });
      await post('/api/voice', { ...meta, audio, mime: file.type, source: 'file', consent: true });
    });
    input.click();
  });

  /** Отрисовка каталога. Пока голос не подготовлен, он есть, но выбрать его нельзя. */
  const render = (voices = []) => {
    if (!el.cards) return;
    el.cards.innerHTML = '';
    for (const v of voices) {
      const b = document.createElement('button');
      b.className = 'voice-card';
      b.type = 'button';
      b.disabled = !v.ready;
      b.innerHTML = `<svg class="wave" viewBox="0 0 62 20" aria-hidden="true"></svg>
        <span><span class="voice-name"></span><span class="voice-meta"></span></span>`;
      b.querySelector('.voice-name').textContent = v.name;
      b.querySelector('.voice-meta').textContent = v.ready
        ? `${Math.round(v.seconds || 0)} с · ${v.source === 'record' ? 'чистая запись' : 'из файла'}`
        : 'готовится…';

      // Форма волны рисуется от идентификатора: одинаковые полоски у всех голосов
      // выглядят как заглушка, а рисовать настоящую осциллограмму здесь незачем.
      const svg = b.querySelector('.wave');
      let seed = [...v.id].reduce((a, c) => a + c.charCodeAt(0), 0);
      for (let x = 0; x < 16; x++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const h = 2 + (seed % 16);
        svg.insertAdjacentHTML('beforeend',
          `<rect x="${x * 4}" y="${(20 - h) / 2}" width="2" height="${h}" rx="1"/>`);
      }
      el.cards.append(b);
    }
  };

  return { render };
}
