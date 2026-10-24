import { availableMinutes, exceedsSalesEnd, salesClosed, salesEndAtOf } from './sales-cutoff';
import { schedule } from './scheduling';

// Fim do dia da eleição 2026-10-25 em São Paulo (sponsorship-election-pricing R-1).
const SALES_END = new Date('2026-10-26T03:00:00.000Z');
const at = (iso: string) => new Date(iso);
const MIN = 60_000;

describe('sales-cutoff — spec sponsorship-sales-cutoff R-1, R-2, R-5 (AC-01)', () => {
  it('o corte é o fim do dia da eleição já configurado (R-1)', () => {
    expect(salesEndAtOf({ endsAt: SALES_END })).toBe(SALES_END);
  });

  it('local livre: minutos até o corte, limitados ao máximo por pedido', () => {
    expect(availableMinutes(at('2026-10-26T02:00:00Z'), null, SALES_END, 60)).toBe(60); // 23:00
    expect(availableMinutes(at('2026-10-26T02:30:00Z'), null, SALES_END, 60)).toBe(30); // 23:30
    expect(availableMinutes(at('2026-10-26T02:59:30Z'), null, SALES_END, 60)).toBe(0); // 23:59:30
  });

  it('fila ocupada: conta a partir do fim da fila', () => {
    const queueEnd = at('2026-10-26T02:50:00Z'); // fila até 23:50
    expect(availableMinutes(at('2026-10-26T01:00:00Z'), queueEnd, SALES_END, 60)).toBe(10);
    // Fila no passado não conta.
    expect(
      availableMinutes(at('2026-10-26T02:30:00Z'), at('2026-10-26T01:00:00Z'), SALES_END, 60),
    ).toBe(30);
  });

  it('no corte ou depois: zero minutos e venda encerrada (R-5)', () => {
    expect(availableMinutes(SALES_END, null, SALES_END, 60)).toBe(0);
    expect(salesClosed(SALES_END, SALES_END)).toBe(true);
    expect(salesClosed(at('2026-10-26T02:59:59Z'), SALES_END)).toBe(false);
    expect(availableMinutes(at('2026-10-27T12:00:00Z'), null, SALES_END, 60)).toBe(0);
  });

  it('janela que termina exatamente no corte não passa; um minuto a mais passa (R-1, R-3)', () => {
    const now = at('2026-10-26T02:30:00Z');
    expect(exceedsSalesEnd(schedule(now, 30, null), SALES_END)).toBe(false);
    expect(exceedsSalesEnd(schedule(now, 31, null), SALES_END)).toBe(true);
  });

  it('invariante: N ≤ availableMinutes ⇔ a janela prevista não passa do corte (R-2)', () => {
    const now = at('2026-10-26T02:17:30Z'); // 23:17:30 → cabem 42 minutos inteiros
    const queueEnd = at('2026-10-26T02:20:00Z'); // fila até 23:20 → cabem 40
    for (const queue of [null, queueEnd]) {
      const limit = availableMinutes(now, queue, SALES_END, 60);
      expect(limit).toBe(queue ? 40 : 42);
      for (let n = 1; n <= 60; n++) {
        expect(n <= limit).toBe(!exceedsSalesEnd(schedule(now, n, queue), SALES_END));
      }
    }
    // O máximo por pedido prevalece quando sobra mais tempo.
    expect(availableMinutes(at('2026-10-25T20:00:00Z'), null, SALES_END, 60)).toBe(60);
    expect(exceedsSalesEnd(schedule(at('2026-10-25T20:00:00Z'), 60, null), SALES_END)).toBe(false);
    expect(SALES_END.getTime() - at('2026-10-25T20:00:00Z').getTime()).toBeGreaterThan(60 * MIN);
  });
});
