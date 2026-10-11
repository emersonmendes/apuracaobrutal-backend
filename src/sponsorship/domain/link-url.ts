// Link opcional do anúncio (spec sponsor-link R-1). Puro: só validação de forma.

export const LINK_URL_MAX_LENGTH = 2048;

export type LinkUrlResult = { ok: true; value: string | null } | { ok: false };

/**
 * Ausente/vazio → `null`. Válido = URL absoluta `http(s)` com host, sem credenciais, ≤ 2048
 * caracteres após `trim`; guardado como veio. Qualquer outra coisa → inválido.
 */
export function normalizeLinkUrl(raw: unknown): LinkUrlResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  if (text.length > LINK_URL_MAX_LENGTH) return { ok: false };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false };
  if (url.hostname === '' || url.username !== '' || url.password !== '') return { ok: false };
  return { ok: true, value: text };
}
