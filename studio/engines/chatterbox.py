"""
Chatterbox Multilingual — второй движок, на всех платформах через PyTorch.

Держим его рядом с Qwen не для полноты списка: на конкретном голосе один клонирует
заметно лучше другого, и услышать это можно только сравнив. Сравнение делается на одной
реплике, а не переозвучкой ролика.

Транскрипт эталона ему не нужен — он работает zero-shot от одного образца. Поэтому тем,
кто пользуется только Chatterbox, распознавание речи не ставится вовсе.
"""
NAME = "Chatterbox Multilingual"
NEEDS_REF_TEXT = False


def available():
    try:
        import torch, chatterbox  # noqa: F401
        return True
    except ImportError:
        return False


def device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    # На Apple Silicon Metal заметно быстрее процессора, но доступен не в каждой сборке.
    return "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"


def load():
    from chatterbox.tts import ChatterboxTTS
    return ChatterboxTTS.from_pretrained(device=device())


def synth(model, text, ref_wav, ref_text, out_dir):
    import os
    import torchaudio
    # ref_text приходит и остаётся неиспользованным: контракт общий для всех движков, а
    # знание о том, кому нужен транскрипт, живёт в NEEDS_REF_TEXT — иначе вызывающая
    # сторона обрастала бы ветками про каждый движок.
    wav = model.generate(text, audio_prompt_path=ref_wav)
    torchaudio.save(os.path.join(out_dir, "line.wav"), wav, model.sr)
