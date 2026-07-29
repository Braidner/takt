"""
Движки синтеза речи: выбор по голосу и по машине.

Движок — сменная деталь за одним контрактом, и это не абстракция ради абстракции. Модель
у нас одна и та же на всех платформах (Qwen3-TTS), но бэкенд разный: на Apple Silicon это
MLX, на остальных машинах PyTorch. MLX на Windows не существует; PyTorch на Apple Silicon
работает, но медленнее и потребовал бы второй копии весов — они у MLX и у torch разные
файлы.

Chatterbox стоит рядом вторым движком: на конкретном голосе он иногда клонирует лучше, и
человек должен иметь возможность сравнить, а не верить на слово.

КОНТРАКТ. Каждый движок предоставляет:

    NAME            имя для человека
    NEEDS_REF_TEXT  нужна ли расшифровка эталона (Qwen — да, Chatterbox — нет)
    available()     установлен ли; проверяется до работы, чтобы сказать это внятно
    load()          загрузить модель, вернуть объект
    synth(model, text, ref_wav, ref_text, out_dir)   синтезировать реплику в out_dir

Всё остальное — раскладка реплик, проверка длительности, повторы при срыве — общее и
живёт в narrate.py. Движок отвечает только за «текст плюс образец голоса → wav».
"""
import platform
import sys

APPLE_SILICON = sys.platform == "darwin" and platform.machine() == "arm64"


def _engines():
    from . import mlx_qwen, torch_qwen, chatterbox
    return {
        "qwen": mlx_qwen if APPLE_SILICON else torch_qwen,
        "chatterbox": chatterbox,
    }


def pick(name=None):
    """
    Движок по имени из голоса. Имя — это МОДЕЛЬ («qwen», «chatterbox»), а не бэкенд:
    человек выбирает, чьим голосом и какой моделью говорить, а на чём она посчитается —
    свойство его машины, и спрашивать об этом незачем.
    """
    engines = _engines()
    engine = engines.get(name or "qwen")
    if engine is None:
        raise SystemExit(f"Неизвестный движок «{name}». Есть: {', '.join(engines)}")
    return engine


def describe():
    """Что установлено — для внятного сообщения вместо стека ImportError."""
    return {name: {"name": e.NAME, "available": e.available()} for name, e in _engines().items()}
