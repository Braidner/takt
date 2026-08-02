/**
 * Кривые движения камеры.
 *
 * Единственное, что композиция брала у Remotion, — interpolate и Easing.bezier.
 * Свои сорок строк дешевле пятисот мегабайт optionalDependencies: ролик — артефакт
 * сборки, и сборка обязана работать на голом Playwright + ffmpeg.
 *
 * Без импортов Node: модуль грузит и браузер (плеер), и node:test.
 */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function interpolate(t, [a, b], [va, vb], { easing = (x) => x } = {}) {
  if (b === a) return va;
  const x = clamp((t - a) / (b - a), 0, 1);
  return va + (vb - va) * easing(x);
}

/**
 * Кубическая кривая Безье как в CSS: по x подбирается параметр, отдаётся y.
 * Двоичный поиск вместо производных: 24 итерации дают точность лучше 1e-6,
 * а понять его можно с первого взгляда.
 */
export function cubicBezier(x1, y1, x2, y2) {
  const at = (u, p1, p2) => 3 * u * (1 - u) * (1 - u) * p1 + 3 * u * u * (1 - u) * p2 + u ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid, x1, x2) < x) lo = mid; else hi = mid;
    }
    return at((lo + hi) / 2, y1, y2);
  };
}

/** Проезд камеры: разгон и торможение, снято с утверждённого прототипа панорамы. */
export const ride = cubicBezier(0.45, 0, 0.25, 1);
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
