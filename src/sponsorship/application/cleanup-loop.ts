/** Intervalo da limpeza do worker (spec sponsorships FR-05). */
export const CLEANUP_INTERVAL_MS = 10 * 60_000;

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

interface Logger {
  log(message: string): void;
  error(message: string): void;
}

/** Espera `ms` ou até o sinal abortar, o que vier primeiro. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/**
 * Laço da limpeza (FR-05): executa ao iniciar e depois a cada 10 min até `signal` abortar. Uma
 * execução que falha é logada e o laço segue; o estado vem sempre do banco.
 */
export async function runCleanupLoop(
  cleanup: { execute(): Promise<{ expired: number; imagesRemoved: number }> },
  signal: AbortSignal,
  logger: Logger,
  sleep: Sleep = abortableSleep,
  intervalMs = CLEANUP_INTERVAL_MS,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const { expired, imagesRemoved } = await cleanup.execute();
      if (expired > 0 || imagesRemoved > 0) {
        logger.log(`patrocínios: ${expired} expirados, ${imagesRemoved} imagens removidas`);
      }
    } catch (error) {
      logger.error(`limpeza de patrocínios falhou: ${String(error)}`);
    }
    await sleep(intervalMs, signal);
  }
}
