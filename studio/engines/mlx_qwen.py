"""
Qwen3-TTS через MLX — путь для Apple Silicon.

Быстрее torch на этом железе и не требует отдельной сборки под видеокарту. Веса лежат в
формате MLX и с оригинальными не взаимозаменяемы, поэтому на одной машине держат либо
один бэкенд, либо два комплекта весов — второе бессмысленно.
"""
import os

NAME = "Qwen3-TTS (MLX)"

# Расшифровка эталона обязательна: без ref_text генерация обрывается молча за доли
# секунды, и при verbose=False это выглядит как «ничего не произошло».
NEEDS_REF_TEXT = True

REPO = os.environ.get("TTS_REPO", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")


def available():
    try:
        import mlx_audio  # noqa: F401
        return True
    except ImportError:
        return False


def load():
    from mlx_audio.tts.utils import load_model
    return load_model(REPO)


def synth(model, text, ref_wav, ref_text, out_dir):
    from mlx_audio.tts.generate import generate_audio
    # lang_code по умолчанию 'en' — русский текст читается английскими правилами.
    # temperature 0.3: выше даёт разброс интонации между дублями одной реплики.
    generate_audio(model=model, text=text, ref_audio=ref_wav, ref_text=ref_text,
                   lang_code="ru", temperature=0.3, output_path=out_dir, verbose=False)
