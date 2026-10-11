import { CLEANUP_INTERVAL_MS, runCleanupLoop } from './cleanup-loop';

describe('runCleanupLoop — spec sponsorships FR-05', () => {
  it('executa ao iniciar, espera 10 min entre execuções e para no abort', async () => {
    const controller = new AbortController();
    const waits: number[] = [];
    let runs = 0;
    const cleanup = {
      execute: async () => {
        runs++;
        if (runs === 2) throw new Error('banco fora');
        return { expired: 0, imagesRemoved: 0 };
      },
    };
    const errors: string[] = [];
    await runCleanupLoop(
      cleanup,
      controller.signal,
      { log: () => undefined, error: (m) => errors.push(m) },
      async (ms) => {
        waits.push(ms);
        if (waits.length === 3) controller.abort();
      },
    );
    expect(runs).toBe(3);
    expect(waits).toEqual([CLEANUP_INTERVAL_MS, CLEANUP_INTERVAL_MS, CLEANUP_INTERVAL_MS]);
    expect(errors).toHaveLength(1);
  });
});
