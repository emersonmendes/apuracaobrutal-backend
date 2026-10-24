import type { ElectionDay } from './sponsorship-config';

const MINUTE_MS = 60_000;

/**
 * Fim das vendas (spec sponsorship-sales-cutoff R-1): nenhum patrocínio pode ser comprado se a
 * janela prevista passar do fim do dia da eleição. Puro: recebe só instantes, nunca lê o relógio.
 */
export function salesEndAtOf(electionDay: Pick<ElectionDay, 'endsAt'>): Date {
  return electionDay.endsAt;
}

/** Venda encerrada: `agora ≥ salesEndAt` (R-5). */
export function salesClosed(now: Date, salesEndAt: Date): boolean {
  return now.getTime() >= salesEndAt.getTime();
}

/**
 * Minutos que ainda cabem num local antes do corte (R-2):
 * `min(maxMinutes, max(0, floor((salesEndAt − max(agora, fim da fila)) / 60 s)))`.
 */
export function availableMinutes(
  now: Date,
  queueEndsAt: Date | null,
  salesEndAt: Date,
  maxMinutes: number,
): number {
  const start = Math.max(now.getTime(), queueEndsAt?.getTime() ?? 0);
  const fit = Math.floor((salesEndAt.getTime() - start) / MINUTE_MS);
  return Math.min(maxMinutes, Math.max(0, fit));
}

/** A janela passa do corte? Terminar exatamente em `salesEndAt` não passa (R-1, R-3). */
export function exceedsSalesEnd(window: { endsAt: Date }, salesEndAt: Date): boolean {
  return window.endsAt.getTime() > salesEndAt.getTime();
}
