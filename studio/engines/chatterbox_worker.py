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


def say(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    return "mps" if mps and mps.is_available() else "cpu"


try:
    from chatterbox.tts import ChatterboxTTS
    import torchaudio
    model = ChatterboxTTS.from_pretrained(device=device())
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
        wav = model.generate(req["text"], audio_prompt_path=req["ref_wav"])
        out = os.path.join(req["out_dir"], "line.wav")
        torchaudio.save(out, wav, model.sr)
        say({"ok": True, "file": "line.wav"})
    except Exception as e:  # noqa: BLE001 — одна плохая реплика не должна ронять остальные
        say({"ok": False, "error": str(e)})
