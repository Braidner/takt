"""
Озвучка ролика голосом из каталога.

    takt narrate           озвучить все реплики
    takt narrate 3 7       переозвучить только третью и седьмую

Здесь общая часть: раскладка реплик, проверка результата, повторы при срыве, отчёт в
студию. Сам синтез делает движок из engines/ — какой именно, зависит от голоса и от
машины, и этой ветки здесь намеренно нет.

Опыт прошлых озвучек, каждое решение стоило отдельной отладки:

  * РАЗМЕТКА УДАРЕНИЙ НЕ ПРИМЕНЯЕТСЯ. Модель не понимает её ни в каком виде:
    комбинирующий знак читается как посторонний символ и растягивает речь на 57%, а
    удвоение ударной гласной даёт долготу вместо ударения — «домеен» звучит как
    «домиена». Без разметки русский читается правильно сам. Проверять такое можно только
    ухом: замер темпа показывал безобидные +10%, а ролик выходил неслушаемым.
  * ПРОВЕРКА ДЛИТЕЛЬНОСТИ. Примерно один прогон из десяти не останавливается вовремя и
    выдаёт вместо десяти секунд девяносто шесть, упираясь в потолок токенов. Настройками
    не лечится: тот же эталон с теми же параметрами в следующий раз отрабатывает
    нормально. Сорвавшаяся реплика уезжает в дорожку молча, и найти её иначе можно
    только переслушав весь ролик.
"""
import json
import os
import sys
import time
import wave

DIR = os.path.dirname(os.path.abspath(__file__))
# Путь добавляем до импорта движков: скрипт запускается из корня инструмента, и каталог
# со своими модулями сам собой в путь не попадает.
sys.path.insert(0, DIR)

import engines  # noqa: E402

# Каталог данных приходит из Node: он его и выбирает (см. home.mjs). Запасной путь — для
# запуска питоновской части напрямую, в обход takt.
HOME = os.environ.get("TAKT_HOME") or os.path.join(DIR, "journal")
info = json.load(open(os.path.join(HOME, "server.json"), encoding="utf-8"))
BASE = f"http://localhost:{info['port']}"

# Точечная переозвучка: правят обычно одну фразу, и гонять из-за неё весь ролик —
# это минуты ожидания на ровном месте.
ONLY = [int(x) for x in sys.argv[1:] if x.isdigit()]

RATE = 13.0        # символов в секунду — замеренный темп
MAX_TRIES = 4      # при частоте срыва ~1/10 хватает с большим запасом


def api(route, payload):
    import urllib.request
    req = urllib.request.Request(
        f"{BASE}{route}?token={info['token']}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req).read())


def get(route):
    import urllib.request
    return json.loads(urllib.request.urlopen(f"{BASE}{route}").read())


narration = get("/api/narration")
if not narration or not narration.get("lines"):
    sys.exit("Дикторский текст пуст: напишите реплики в студии")

voices = {v["id"]: v for v in get("/api/voices")}
voice = voices.get(narration.get("voiceId")) or next(
    (v for v in voices.values() if v.get("ready")), None)
if not voice:
    sys.exit("Нет подготовленного голоса: добавьте его в студии")

engine = engines.pick(voice.get("engine"))
if not engine.available():
    sys.exit(f"{engine.NAME} не установлен. Что ставить — покажет takt doctor")

# Смешение проверяется ДО синтеза, а не при сохранении: иначе минуты счёта уходят в
# корзину — реплика синтезирована, а студия её не примет. Точечная переозвучка другим
# движком дала бы шов посреди дорожки; полная — это не смешение, дорожка целиком новая.
ENGINE_ID = voice.get("engine") or "qwen"
prev = narration.get("engine")
voiced_elsewhere = [l["n"] for l in narration["lines"]
                    if l.get("state") == "voiced" and (not ONLY or l["n"] not in ONLY)]
if ONLY and prev and prev != ENGINE_ID and voiced_elsewhere:
    sys.exit(f"Дорожка озвучена движком «{prev}», а голос теперь на «{ENGINE_ID}». "
             f"Точечная переозвучка дала бы слышимый шов. Либо верните движок голосу, "
             f"либо переозвучьте всё: takt narrate")

VOICES = os.path.join(HOME, "voices")
ref_wav = os.path.join(VOICES, f"{voice['id']}-ref.wav")
ref_txt = os.path.join(VOICES, f"{voice['id']}-ref.txt")
if not os.path.exists(ref_wav):
    sys.exit(f"Эталон не подготовлен: {ref_wav}")

# Расшифровка нужна не всем движкам: Qwen сопоставляет звук с текстом, Chatterbox
# работает от одного образца. Лишняя расшифровка — это минута ожидания и гигабайтная
# модель распознавания там, где она не нужна.
ref_text = ""
if engine.NEEDS_REF_TEXT:
    if not os.path.exists(ref_txt):
        print("расшифровываю эталон…", flush=True)
        # Распознаём faster-whisper, а не встроенным в mlx-audio: тамошний whisper требует
        # HuggingFace-процессор, которого в опубликованных mlx-весах нет, и падает на
        # определении языка. Здесь же large-v3 работает на процессоре и без затей.
        from faster_whisper import WhisperModel
        stt = WhisperModel("large-v3", device="cpu", compute_type="int8")
        segments, _ = stt.transcribe(ref_wav, language="ru", beam_size=5)
        open(ref_txt, "w", encoding="utf-8").write(
            " ".join(s.text.strip() for s in segments).strip())
    ref_text = open(ref_txt, encoding="utf-8").read().strip()

OUT = os.path.join(HOME, "projects", json.load(
    open(os.path.join(HOME, "current.json"), encoding="utf-8"))["id"], "narration")
os.makedirs(OUT, exist_ok=True)

api("/api/status", {"state": "busy", "text": f"Загружаю модель: {engine.NAME}",
                    "step": None, "of": None})
model = engine.load()

lines = narration["lines"]
done = []

for i, line in enumerate(lines, 1):
    text = line["text"].strip()
    if not text or (ONLY and i not in ONLY):
        continue
    expect = len(text) / RATE
    sub = os.path.join(OUT, f"{i:02d}")
    os.makedirs(sub, exist_ok=True)

    api("/api/status", {"state": "busy", "text": f"Озвучиваю реплику {i}",
                        "step": i, "of": len(lines)})

    for attempt in range(1, MAX_TRIES + 1):
        for f in os.listdir(sub):
            os.remove(os.path.join(sub, f))
        t0 = time.time()
        engine.synth(model, text, ref_wav, ref_text, sub)
        files = [f for f in os.listdir(sub) if f.endswith(".wav")]
        if not files:
            print(f"[{i:02d}] попытка {attempt}: файл не создан", flush=True)
            continue
        with wave.open(os.path.join(sub, files[0])) as w:
            dur = w.getnframes() / w.getframerate()
        # Кратный порог на коротких репликах слишком строг: у фразы на четыре секунды
        # лишняя пауза уже даёт двукратное превышение. Настоящий срыв — десятки секунд.
        if dur <= expect * 2 + 3:
            print(f"[{i:02d}] {dur:5.1f} c (ждали ~{expect:4.1f}), "
                  f"{time.time() - t0:5.1f} c счёта", flush=True)
            done.append({"n": i, "seconds": dur})
            break
        print(f"[{i:02d}] попытка {attempt}: СРЫВ {dur:.0f} c при ожидаемых {expect:.0f}",
              flush=True)
    else:
        print(f"[{i:02d}] НЕ УДАЛОСЬ за {MAX_TRIES} попыток", flush=True)

# Длительности возвращаются в студию: по ним видно, влезает ли реплика в своё окно.
# Движок и голос записываются рядом — по ним студия не даёт смешать в одной дорожке
# реплики от разных моделей, а такой шов слышен сразу.
narration["lines"] = [
    {**l, "seconds": next((d["seconds"] for d in done if d["n"] == i), l.get("seconds")),
     "state": "voiced" if any(d["n"] == i for d in done) else l.get("state", "draft")}
    for i, l in enumerate(narration["lines"], 1)
]
narration["voiceId"] = voice["id"]
narration["engine"] = ENGINE_ID
# Полная переозвучка меняет движок легально — вся дорожка новая, шва не будет. Сервер
# при смене движка требует подтверждения, и здесь оно осознанное, а не обход защиты.
if not ONLY:
    narration["force"] = True
api("/api/narration", narration)
api("/api/status", {"state": "listening", "text": "Реплики озвучены", "step": None, "of": None})
print(json.dumps({"ok": True, "voiced": len(done), "of": len(lines),
                  "engine": engine.NAME}, ensure_ascii=False))
