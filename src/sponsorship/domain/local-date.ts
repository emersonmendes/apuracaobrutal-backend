/** Fuso das datas comerciais do projeto (sponsorship-election-pricing R-1; asaas-payment R-3). */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/** Data civil `AAAA-MM-DD` de um instante no fuso (base de fusos real, sem offset fixo). */
export function localDateOf(instant: Date, timeZone = BUSINESS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
