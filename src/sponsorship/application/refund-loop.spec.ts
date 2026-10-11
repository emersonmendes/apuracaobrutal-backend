import { REFUND_INTERVAL_MS, runRefundLoop } from './refund-loop';

describe('runRefundLoop — spec asaas-payment FR-05', () => {
  it('executa ao iniciar, espera 60 s entre execuções e para no abort', async () => {
    const controller = new AbortController();
    const waits: number[] = [];
    let runs = 0;
    const refunds = {
      execute: async () => {
        runs++;
        if (runs === 2) throw new Error('banco fora');
        return { done: 1, retried: 0, failed: 0 };
      },
    };
    const logs: string[] = [];
    const errors: string[] = [];
    await runRefundLoop(
      refunds,
      controller.signal,
      { log: (m) => logs.push(m), error: (m) => errors.push(m) },
      async (ms) => {
        waits.push(ms);
        if (waits.length === 3) controller.abort();
      },
    );
    expect(runs).toBe(3);
    expect(waits).toEqual([REFUND_INTERVAL_MS, REFUND_INTERVAL_MS, REFUND_INTERVAL_MS]);
    expect(logs).toEqual([
      'estornos: 1 concluídos, 0 adiados, 0 desistidos',
      'estornos: 1 concluídos, 0 adiados, 0 desistidos',
    ]);
    expect(errors).toHaveLength(1);
  });
});
