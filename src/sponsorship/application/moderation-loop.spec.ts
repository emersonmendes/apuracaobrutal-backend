import { runModerationLoop } from './moderation-loop';

describe('runModerationLoop — spec sponsorship-image-moderation FR-05', () => {
  it('emenda execuções enquanto há trabalho, dorme quando a fila esvazia e para no abort', async () => {
    const controller = new AbortController();
    const results = [
      { processed: 1 },
      { processed: 1 },
      { processed: 0 },
      { processed: 0 },
    ] as const;
    let calls = 0;
    const sleeps: number[] = [];
    const errors: string[] = [];
    const loop = runModerationLoop(
      {
        execute: async () => {
          const result = results[Math.min(calls, results.length - 1)];
          calls++;
          if (calls === 5) throw new Error('banco fora');
          if (calls === 6) controller.abort();
          return result;
        },
      },
      controller.signal,
      { error: (m) => errors.push(m) },
      async (ms) => {
        sleeps.push(ms);
      },
      2_000,
    );
    await loop;
    expect(calls).toBe(6);
    expect(sleeps).toEqual([2_000, 2_000, 2_000, 2_000]);
    expect(errors).toEqual(['moderação de imagens falhou: Error: banco fora']);
  });
});
