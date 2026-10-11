import { abortableSleep } from './cleanup-loop';
import type { ModerationRunResult } from './moderate-pending-sponsorships';

/** Intervalo do laço de moderação quando não há trabalho (spec sponsorship-image-moderation FR-05). */
export const MODERATION_INTERVAL_MS = 2_000;

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

interface Logger {
  error(message: string): void;
}

/**
 * Laço de moderação (FR-05): executa ao iniciar; emenda a próxima execução quando acabou de
 * processar um pedido e dorme 2 s quando a fila está vazia, até `signal` abortar. Uma execução que
 * falha é logada e o laço segue; o estado vem sempre do banco.
 */
export async function runModerationLoop(
  moderation: { execute(): Promise<ModerationRunResult> },
  signal: AbortSignal,
  logger: Logger,
  sleep: Sleep = abortableSleep,
  intervalMs = MODERATION_INTERVAL_MS,
): Promise<void> {
  while (!signal.aborted) {
    let processed = 0;
    try {
      processed = (await moderation.execute()).processed;
    } catch (error) {
      logger.error(`moderação de imagens falhou: ${String(error)}`);
    }
    if (processed === 0) await sleep(intervalMs, signal);
  }
}
