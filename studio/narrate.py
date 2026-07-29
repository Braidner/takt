"""
Озвучка ролика голосом из каталога.

    studio/venv-tts/bin/python studio/narrate.py

Весь опыт прошлой озвучки собран здесь, и каждое решение стоило отдельной отладки:

  * РАЗМЕТКА УДАРЕНИЙ НЕ ПРИМЕНЯЕТСЯ. Qwen не понимает её ни в каком виде: комбинирующий
    знак он читает как посторонний символ и растягивает речь на 57%, а удвоение ударной
    гласной даёт долготу вместо ударения — «домеен» звучит как «домиена». Без разметки
    он читает русский правильно сам. Проверять такое можно только ухом: замер темпа
    показывал безобидные +10%, а ролик выходил неслушаемым.
  * ref_text ОБЯЗАТЕЛЕН. Без него генерация обрывается молча за доли секунды, и при
    verbose=False это выглядит как «ничего не произошло».
  * lang_code по умолчанию 'en' — русский текст читается английскими правилами.
  * ПРОВЕРКА ДЛИТЕЛЬНОСТИ. Примерно один прогон из десяти не останавливается вовремя и
    выдаёт вместо десяти секунд девяносто шесть, упираясь в потолок токенов. Настройками
    это не лечится: тот же эталон с теми же параметрами в следующий раз отрабатывает
    нормально. Сорвавшаяся реплика уезжает в дорожку молча, и найти её иначе можно
    только переслушав весь ролик.
"""
import json
import os
import subprocess
import sys
import time
import wave

DIR = os.path.dirname(os.path.abspath(__file__))
JOURNAL = os.path.join(DIR, "journal")
info = json.load(open(os.path.join(JOURNAL, "server.json"), encoding="utf-8"))
BASE = f"http://localhost:{info['port']}"

# Точечная переозвучка: правят обычно одну фразу, и гонять из-за неё весь ролик —
# это минуты ожидания на ровном месте.
ONLY = [int(x) for x in sys.argv[1:] if x.isdigit()]

RATE = 13.0        # символов в секунду — замеренный темп
MAX_TRIES = 4      # при частоте срыва ~1/10 хватает с большим запасом
REPO = os.environ.get("TTS_REPO", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")


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

ref_wav = os.path.join(JOURNAL, "voices", f"{voice['id']}-ref.wav")
ref_txt = os.path.join(JOURNAL, "voices", f"{voice['id']}-ref.txt")
if not os.path.exists(ref_wav):
    sys.exit(f"Эталон не подготовлен: {ref_wav}")

# Расшифровка эталона обязательна для клонирования, и она должна быть точной: модель
# сопоставляет звук с текстом, и ошибки распознавания смазывают портрет голоса.
if not os.path.exists(ref_txt):
    print("расшифровываю эталон…", flush=True)
    # Распознаём faster-whisper, а не встроенным в mlx-audio: тамошний whisper требует
    # HuggingFace-процессор, которого в опубликованных mlx-весах нет, и падает на
    # определении языка. Здесь же large-v3 работает на процессоре и без затей.
    from faster_whisper import WhisperModel
    stt = WhisperModel("large-v3", device="cpu", compute_type="int8")
    segments, _ = stt.transcribe(ref_wav, language="ru", beam_size=5)
    text = " ".join(s.text.strip() for s in segments).strip()
    open(ref_txt, "w", encoding="utf-8").write(text)
ref_text = open(ref_txt, encoding="utf-8").read().strip()

from mlx_audio.tts.utils import load_model
from mlx_audio.tts.generate import generate_audio

OUT = os.path.join(JOURNAL, "narration")
os.makedirs(OUT, exist_ok=True)

api("/api/status", {"state": "busy", "text": "Загружаю модель голоса", "step": None, "of": None})
model = load_model(REPO)

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
        generate_audio(model=model, text=text, ref_audio=ref_wav, ref_text=ref_text,
                       lang_code="ru", temperature=0.3, output_path=sub, verbose=False)
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
narration["lines"] = [
    {**l, "seconds": next((d["seconds"] for d in done if d["n"] == i), l.get("seconds")),
     "state": "voiced" if any(d["n"] == i for d in done) else l.get("state", "draft")}
    for i, l in enumerate(narration["lines"], 1)
]
api("/api/narration", narration)
api("/api/status", {"state": "listening", "text": "Реплики озвучены", "step": None, "of": None})
print(json.dumps({"ok": True, "voiced": len(done), "of": len(lines)}))
