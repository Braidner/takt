"""
Рабочий процесс Chatterbox. Запускается ВНУТРИ venv-chatterbox — у него свой Python:
chatterbox отстаёт от версии Python на одну-две, и в рабочую MLX-venv он не встаёт.

Протокол — строки JSON через stdin/stdout, по одной на реплику:

    → {"text": "...", "ref_wav": "/path/ref.wav", "out_dir": "/path"}
    ← {"ok": true, "file": "line.wav"}         или {"ok": false, "error": "..."}

Процесс живёт всю озвучку: модель грузится секунды, и поднимать её на каждую реплику
значило бы удесятерить время работы. Родитель (engines/chatterbox.py в venv-tts) держит
процесс и закрывает stdin, когда реплики кончились.
"""
import json
import os
import sys

# Рядом с этим файлом лежит chatterbox.py — наш модуль движка. Python ставит каталог
# скрипта первым в путь, и «import chatterbox» находил бы его, а не установленный пакет.
# Каталог скрипта убираем: worker не импортирует ничего своего.
sys.path = [p for p in sys.path if os.path.abspath(p or ".") != os.path.dirname(os.path.abspath(__file__))]

# Протокол идёт по stdout, но stdout здесь ничей: chatterbox печатает туда свой лог
# («loaded PerthNet…»), и одна такая строка ломает родителю разбор JSON. Поэтому канал
# протокола забираем себе до первого чужого импорта, а sys.stdout отправляем в stderr —
# чужие print остаются видимыми, но в протокол попасть не могут.
PIPE = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr


def say(obj):
    PIPE.write(json.dumps(obj, ensure_ascii=False) + "\n")
    PIPE.flush()


def device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    return "mps" if mps and mps.is_available() else "cpu"


try:
    # Именно многоязычная модель: английская ChatterboxTTS на русском тексте нестабильна
    # вплоть до тихого падения посреди сэмплинга — без traceback, просто выход.
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    import torchaudio
    model = ChatterboxMultilingualTTS.from_pretrained(device=device())
except Exception as e:  # noqa: BLE001 — причина любая, родителю нужна строка
    say({"ok": False, "fatal": True, "error": str(e)})
    sys.exit(1)

say({"ok": True, "ready": True, "device": device()})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        wav = model.generate(req["text"], audio_prompt_path=req["ref_wav"],
                             language_id=req.get("lang", "ru"))
        out = os.path.join(req["out_dir"], "line.wav")
        torchaudio.save(out, wav, model.sr)
        say({"ok": True, "file": "line.wav"})
    except Exception as e:  # noqa: BLE001 — одна плохая реплика не должна ронять остальные
        say({"ok": False, "error": str(e)})
