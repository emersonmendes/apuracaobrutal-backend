import { abortableSleep } from './cleanup-loop';

/** Intervalo do laço de estornos do worker (spec asaas-payment FR-05). */
export const REFUND_INTERVAL_MS = 60_000;

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

interface Logger {
  log(message: string): void;
  error(message: string): void;
}

/**
 * Laço dos estornos (FR-05): executa ao iniciar e depois a cada 60 s até `signal` abortar. Uma
 * execução que falha é logada e o laço segue; o estado vem sempre do banco.
 */
export async function runRefundLoop(
  refunds: { execute(): Promise<{ done: number; retried: number; failed: number }> },
  signal: AbortSignal,
  logger: Logger,
  sleep: Sleep = abortableSleep,
  intervalMs = REFUND_INTERVAL_MS,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const { done, retried, failed } = await refunds.execute();
      if (done > 0 || retried > 0 || failed > 0) {
        logger.log(`estornos: ${done} concluídos, ${retried} adiados, ${failed} desistidos`);
      }
    } catch (error) {
      logger.error(`processamento de estornos falhou: ${String(error)}`);
    }
    await sleep(intervalMs, signal);
  }
}
