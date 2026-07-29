"""
Qwen3-TTS через PyTorch — путь для Windows и Linux.

Модель та же, что на Маке, и это принципиально: разные модели дают разный голос из одного
образца, и переозвучка одной реплики на другой машине оставила бы слышимый шов посреди
дорожки — ровно в том сценарии, ради которого точечная переозвучка и делается.

Устройство выбирается само: карта NVIDIA, если есть, иначе процессор. На процессоре
работает, но заметно медленнее — предупредить об этом должен интерфейс, а не молчание
во время долгого ожидания.
"""
import os

NAME = "Qwen3-TTS (PyTorch)"
NEEDS_REF_TEXT = True

REPO = os.environ.get("TTS_REPO", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")


def available():
    try:
        import torch, qwen3_tts  # noqa: F401
        return True
    except ImportError:
        return False


def device():
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def load():
    from qwen3_tts import Qwen3TTS
    # FlashAttention на Windows конфликтует с CUDA-сборками и роняет загрузку, поэтому
    # там его не просим: на скорость это влияет, на результат — нет.
    kwargs = {"device": device()}
    if os.name == "nt":
        kwargs["attn_implementation"] = "eager"
    return Qwen3TTS.from_pretrained(REPO, **kwargs)


def synth(model, text, ref_wav, ref_text, out_dir):
    import soundfile as sf
    wav = model.generate(text=text, ref_audio=ref_wav, ref_text=ref_text,
                         language="ru", temperature=0.3)
    # Общая часть ищет в каталоге любой .wav — так же, как его кладёт MLX-ветка.
    sf.write(os.path.join(out_dir, "line.wav"), wav, model.sample_rate)
