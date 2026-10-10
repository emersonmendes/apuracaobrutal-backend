// Conversão dos valores textuais do TSE (EA20) — spec election-results-feed R-2, R-8.

const INTEGER = /^\d+$/;
const DECIMAL = /^\d+(,\d+)?$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})$/;

/** Inteiro do TSE (`"58912401"`). `null` se fora do padrão. */
export function parseTseInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !INTEGER.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decimal do TSE com vírgula (`"47,027772356"`). `null` se fora do padrão. */
export function parseTseDecimal(raw: unknown): number | null {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) return null;
  return Number(raw.replace(',', '.'));
}

/** Percentual do TSE: decimal dentro de 0–100. */
export function parseTsePct(raw: unknown): number | null {
  const n = parseTseDecimal(raw);
  return n !== null && n <= 100 ? n : null;
}

/**
 * `dd/mm/aaaa` + `hh:mm:ss` no horário de Brasília (UTC−3, sem horário de verão desde 2019) →
 * instante (R-8). Os dois vazios → `null`; inválido → `undefined`.
 */
export function parseBrasiliaDateTime(date: unknown, time: unknown): Date | null | undefined {
  if (date === '' && time === '') return null;
  if (typeof date !== 'string' || typeof time !== 'string') return undefined;
  const d = DATE.exec(date);
  const t = TIME.exec(time);
  if (!d || !t) return undefined;
  const [, dd, mm, yyyy] = d;
  const [, hh, mi, ss] = t;
  const result = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
  if (Number.isNaN(result.getTime())) return undefined;
  // Rejeita datas que o Date "corrige" (ex.: 31/02).
  const check = toBrasiliaIso(result);
  return check.startsWith(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`) ? result : undefined;
}

/** Instante → ISO-8601 no horário de Brasília (`2026-10-25T23:17:00-03:00`). */
export function toBrasiliaIso(instant: Date): string {
  const shifted = new Date(instant.getTime() - 3 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}-03:00`;
}
