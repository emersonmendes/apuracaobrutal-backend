import { TEST_CONFIG } from '../domain/__fixtures__/scope-result.builder';
import { ALL_SCOPES, type ElectionConfig, type Scope } from '../domain/election-config';
import type { Clock } from '../domain/ports/clock';
import type { FetchScopeResult, ResultsSource } from '../domain/ports/results-source';
import { InMemoryElectionRepository } from './__fakes__/in-memory-election-repository';
import { signedFile, TEST_JWK, type FileOptions } from './__fakes__/signed-tse-file';
import { PollOfficialResults } from './poll-official-results';

const CONFIG: ElectionConfig = { ...TEST_CONFIG, jwk: TEST_JWK };

class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-25T23:00:00Z')) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Fonte falsa: cada escopo responde com o arquivo configurado; mede concorrência. */
class FakeSource implements ResultsSource {
  responses = new Map<Scope, FetchScopeResult>();
  calls: Scope[] = [];
  inFlight = 0;
  maxInFlight = 0;
  etagsSent = new Map<Scope, string | null>();

  setAll(options: FileOptions = {}) {
    for (const scope of ALL_SCOPES) this.setFile(scope, options);
  }
  setFile(scope: Scope, options: FileOptions = {}, etag: string | null = null) {
    this.responses.set(scope, { kind: 'ok', body: signedFile({ scope, ...options }), etag });
  }
  async fetchScope(scope: Scope, etag: string | null): Promise<FetchScopeResult> {
    this.calls.push(scope);
    this.etagsSent.set(scope, etag);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    this.inFlight--;
    return this.responses.get(scope) ?? { kind: 'error', reason: 'sem resposta' };
  }
}

const silent = { log: () => undefined, warn: () => undefined };

function setup() {
  const source = new FakeSource();
  const repository = new InMemoryElectionRepository();
  const clock = new FakeClock();
  const poll = new PollOfficialResults(source, repository, clock, CONFIG, silent);
  return { source, repository, clock, poll };
}

describe('PollOfficialResults (FR-03; Fluxos 1–3)', () => {
  it('fluxo feliz: 28 escopos aceitos, eventos e sucesso do br (AC-05, AC-09)', async () => {
    const { source, repository, clock, poll } = setup();
    source.setAll();

    const summary = await poll.runCycle();

    expect(source.calls).toHaveLength(28);
    expect(summary.brSuccess).toBe(true);
    expect(summary.outcomes.every((o) => o.kind === 'accepted')).toBe(true);
    expect(repository.results).toHaveLength(28);
    expect(repository.events.map((e) => e.dedupeKey)).toEqual([
      'counting_started',
      'update:2026-10-25T19:59:00-03:00',
      'milestone:25',
      'lead:1',
    ]);
    expect(repository.status).toMatchObject({
      lastSuccessAt: clock.now(),
      lastError: null,
      feedVersion: 28,
    });
  });

  it('nunca mais de 4 requisições simultâneas (R-11, AC-12)', async () => {
    const { source, poll } = setup();
    source.setAll();
    await poll.runCycle();
    expect(source.maxInFlight).toBe(4);
  });

  it('mesmo arquivo de novo (ou regenerado sem mudança) não gera histórico nem eventos (R-7)', async () => {
    const { source, repository, poll } = setup();
    source.setAll();
    await poll.runCycle();
    const events = repository.events.length;

    source.setAll({ idg: '2', generated: '25/10/2026 20:05:00' });
    const summary = await poll.runCycle();

    expect(summary.outcomes.every((o) => o.kind === 'unchanged')).toBe(true);
    expect(repository.results).toHaveLength(28);
    expect(repository.events).toHaveLength(events);
    expect(repository.status?.feedVersion).toBe(28);
    expect(repository.scopeStates.get('br')?.lastGeneratedAt).toEqual(
      new Date('2026-10-25T20:05:00-03:00'),
    );
  });

  it('versão atrasada da CDN é descartada e conta como sucesso do br (R-3, R-10)', async () => {
    const { source, repository, poll } = setup();
    source.setFile('br', { generated: '25/10/2026 20:10:00', pst: '50,000000000' });
    await poll.runCycle();

    source.setFile('br', { idg: '0', generated: '25/10/2026 20:05:00', pst: '45,000000000' });
    const summary = await poll.runCycle();

    expect(summary.outcomes.find((o) => o.scope === 'br')?.kind).toBe('stale');
    expect(summary.brSuccess).toBe(true);
    expect(repository.results.filter((r) => r.result.scope === 'br')).toHaveLength(1);
  });

  it('nova totalização gera update e reaproveita o anterior do banco', async () => {
    const { source, repository, poll } = setup();
    source.setFile('br');
    await poll.runCycle();
    source.setFile('br', {
      idg: '2',
      generated: '25/10/2026 20:10:00',
      totalized: '25/10/2026 20:09:00',
      pst: '55,000000000',
      redPct: '49,000000000',
      bluePct: '51,000000000',
    });
    await poll.runCycle();
    expect(repository.events.map((e) => e.text).slice(-3)).toEqual([
      'Atualização do TSE: 55,0% das urnas apuradas',
      '50% das urnas apuradas',
      'FLAVIO BOLSONARO assume a liderança com 51,00%',
    ]);
  });

  it('reiniciar o worker (novo processo, mesmo banco) não duplica nada', async () => {
    const { source, repository, clock } = setup();
    source.setAll();
    await new PollOfficialResults(source, repository, clock, CONFIG, silent).runCycle();
    await new PollOfficialResults(source, repository, clock, CONFIG, silent).runCycle();
    expect(repository.results).toHaveLength(28);
    expect(repository.events).toHaveLength(4);
    expect(repository.combatEvents).toHaveLength(1);
  });

  describe('golpes (combat-events Fluxo 1; AC-05)', () => {
    const moves = (repository: InMemoryElectionRepository) =>
      repository.combatEvents.map(({ dedupeKey, red, blue }) => ({ dedupeKey, red, blue }));

    it('início da divulgação: um golpe só, do lead_change (R-4)', async () => {
      const { source, repository, poll } = setup();
      source.setAll();
      await poll.runCycle();
      expect(moves(repository)).toEqual([
        { dedupeKey: 'lead:1', red: 'attack', blue: 'knockback' },
      ]);
    });

    it('nova totalização com variação pequena → golpe do update', async () => {
      const { source, repository, poll } = setup();
      source.setFile('br');
      await poll.runCycle();
      source.setFile('br', {
        idg: '2',
        generated: '25/10/2026 20:10:00',
        totalized: '25/10/2026 20:09:00',
        redPct: '52,300000000',
        bluePct: '47,700000000',
      });
      await poll.runCycle();
      expect(moves(repository)).toEqual([
        { dedupeKey: 'lead:1', red: 'attack', blue: 'knockback' },
        { dedupeKey: 'update:2026-10-25T20:09:00-03:00', red: 'hit', blue: 'attack' },
      ]);
    });

    it('arquivo sem mudança ou reprocessado não grava golpe novo', async () => {
      const { source, repository, poll } = setup();
      source.setAll();
      await poll.runCycle();
      source.setAll({ idg: '2', generated: '25/10/2026 20:05:00' });
      await poll.runCycle();
      expect(repository.combatEvents).toHaveLength(1);
    });
  });

  it('assinatura inválida → falha e nada gravado (R-1)', async () => {
    const { source, repository, poll } = setup();
    const [h, p] = signedFile().split('.');
    source.responses.set('br', { kind: 'ok', body: `${h}.${p}.AAAA`, etag: null });

    const summary = await poll.runCycle();

    expect(summary.outcomes.find((o) => o.scope === 'br')).toEqual({
      scope: 'br',
      kind: 'failed',
      reason: 'assinatura JWS inválida',
    });
    expect(summary.brSuccess).toBe(false);
    expect(repository.results).toHaveLength(0);
    expect(repository.status?.lastError).toBe('assinatura JWS inválida');
  });

  it('payload inválido (outra eleição) → rejeitado (R-2)', async () => {
    const { source, repository, poll } = setup();
    source.setFile('br', { ele: '6257' });
    await poll.runCycle();
    expect(repository.results).toHaveLength(0);
    expect(repository.status?.lastError).toMatch(/payload inválido/);
  });

  it('404 → recuo de 300 s no escopo (R-11, AC-12)', async () => {
    const { source, clock, poll } = setup();
    source.setAll();
    source.responses.set('ac', { kind: 'not_found' });
    await poll.runCycle();

    source.calls = [];
    clock.advance(299_000);
    await poll.runCycle();
    expect(source.calls).not.toContain('ac');
    expect(source.calls).toHaveLength(27);

    source.calls = [];
    clock.advance(2_000);
    await poll.runCycle();
    expect(source.calls).toContain('ac');
  });

  it('404 no br → falha da fonte registrada', async () => {
    const { source, repository, poll } = setup();
    source.responses.set('br', { kind: 'not_found' });
    const summary = await poll.runCycle();
    expect(summary.brSuccess).toBe(false);
    expect(repository.status?.lastError).toBe('not_found');
  });

  it('403/429 → nenhuma requisição até blockedUntil (R-11, AC-12)', async () => {
    const { source, clock, poll } = setup();
    source.setAll();
    source.responses.set('br', { kind: 'blocked' });

    const first = await poll.runCycle();
    expect(first.blocked).toBe(true);
    // Só as requisições já em voo terminam; nenhuma nova começa depois do bloqueio.
    expect(source.calls.length).toBeLessThanOrEqual(4);

    source.calls = [];
    clock.advance(10 * 60 * 1000);
    expect((await poll.runCycle()).blocked).toBe(true);
    expect(source.calls).toEqual([]);

    clock.advance(61 * 1000);
    source.setFile('br');
    await poll.runCycle();
    expect(source.calls).toHaveLength(28);
  });

  it('erro de rede num escopo não impede os demais', async () => {
    const { source, repository, poll } = setup();
    source.setAll();
    source.responses.set('sp', { kind: 'error', reason: 'HTTP 500' });
    const summary = await poll.runCycle();
    expect(summary.brSuccess).toBe(true);
    expect(repository.results).toHaveLength(27);
  });

  it('304 conta como sucesso sem gravar; ETag é reenviado', async () => {
    const { source, repository, poll } = setup();
    source.setFile('br', {}, '"etag-1"');
    await poll.runCycle();
    source.responses.set('br', { kind: 'not_modified' });
    const summary = await poll.runCycle();
    expect(source.etagsSent.get('br')).toBe('"etag-1"');
    expect(summary.brSuccess).toBe(true);
    expect(repository.results).toHaveLength(1);
  });

  it('falha no meio da gravação não deixa nada pela metade (FR-05)', async () => {
    const { source, repository, poll } = setup();
    source.setFile('br');
    repository.failNextEventInsert = true;
    const summary = await poll.runCycle();
    expect(summary.outcomes[0]).toEqual({
      scope: 'br',
      kind: 'failed',
      reason: 'erro ao processar: falha simulada ao gravar evento',
    });
    expect(repository.results).toHaveLength(0);
    expect(repository.events).toHaveLength(0);
    expect(repository.status?.feedVersion ?? 0).toBe(0);

    await poll.runCycle();
    expect(repository.results).toHaveLength(1);
  });

  it('run(): ciclos não se sobrepõem e param ao abortar', async () => {
    jest.useFakeTimers();
    try {
      const { source, poll } = setup();
      source.setFile('br');
      let running = 0;
      let overlapped = false;
      const original = poll.runCycle.bind(poll);
      jest.spyOn(poll, 'runCycle').mockImplementation(async () => {
        running++;
        if (running > 1) overlapped = true;
        try {
          return await original();
        } finally {
          running--;
        }
      });
      const controller = new AbortController();
      const done = poll.run(controller.signal);
      for (let i = 0; i < 3; i++) await jest.advanceTimersByTimeAsync(15_000);
      controller.abort();
      await jest.advanceTimersByTimeAsync(0);
      await done;
      expect(overlapped).toBe(false);
      expect((poll.runCycle as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
