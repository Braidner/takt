"""
Chatterbox Multilingual — второй движок, через рабочий процесс в собственной venv.

Держим его рядом с Qwen не для полноты списка: на конкретном голосе один клонирует
заметно лучше другого, и услышать это можно только сравнив. Сравнение делается на одной
реплике, а не переозвучкой ролика.

Своя venv — не прихоть. Синтез запускается интерпретатором venv-tts, где живёт MLX на
свежем Python; chatterbox же отстаёт от Python на версию-две и в это окружение не встаёт.
Поэтому здесь не import, а процесс: chatterbox_worker.py поднимается интерпретатором
venv-chatterbox, грузит модель один раз и синтезирует реплики по протоколу строк JSON.

Транскрипт эталона не нужен — движок работает zero-shot от одного образца. Тем, кто
пользуется только Chatterbox, распознавание речи не ставится вовсе.
"""
import json
import os
import subprocess
import sys

NAME = "Chatterbox Multilingual"
NEEDS_REF_TEXT = False

DIR = os.path.dirname(os.path.abspath(__file__))
BIN = "Scripts" if os.name == "nt" else "bin"
WORKER_PY = os.path.join(os.path.dirname(DIR), "venv-chatterbox", BIN,
                         "python.exe" if os.name == "nt" else "python3")


def available():
    if not os.path.exists(WORKER_PY):
        return False
    return subprocess.run([WORKER_PY, "-c", "import chatterbox"],
                          capture_output=True).returncode == 0


def load():
    proc = subprocess.Popen(
        [WORKER_PY, os.path.join(DIR, "chatterbox_worker.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=sys.stderr, text=True, encoding="utf-8",
    )
    # Первая строка — готовность или причина отказа. Ждать её обязательно: иначе первый
    # же synth уйдёт процессу, который ещё минуту грузит модель, и таймауты поплывут.
    first = json.loads(proc.stdout.readline() or '{"ok": false, "error": "worker умер молча"}')
    if not first.get("ok"):
        raise SystemExit(f"{NAME}: {first.get('error', 'не поднялся')}")
    return proc


def synth(proc, text, ref_wav, ref_text, out_dir):
    # ref_text приходит и остаётся неиспользованным: контракт общий для всех движков, а
    # знание о том, кому нужен транскрипт, живёт в NEEDS_REF_TEXT.
    proc.stdin.write(json.dumps(
        {"text": text, "ref_wav": ref_wav, "out_dir": out_dir}, ensure_ascii=False) + "\n")
    proc.stdin.flush()
    resp = json.loads(proc.stdout.readline() or '{"ok": false, "error": "worker умер"}')
    if not resp.get("ok"):
        # Файл не создан — общая часть увидит пустой каталог и посчитает попытку неудачной,
        # это её штатная ветка. Причину печатаем здесь, ближе всего к источнику.
        print(f"    chatterbox: {resp.get('error')}", flush=True)
