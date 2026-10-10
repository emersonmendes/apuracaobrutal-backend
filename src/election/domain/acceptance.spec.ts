import { brt, makeResult } from './__fixtures__/scope-result.builder';
import { contentHash } from './content-hash';
import { decideAcceptance } from './scope-acceptance';

describe('contentHash (R-7)', () => {
  it('ignora idg e horário de geração', () => {
    const a = makeResult({ generationId: '1', generatedAt: brt('2026-10-25T20:00:00') });
    const b = makeResult({ generationId: '2', generatedAt: brt('2026-10-25T20:05:00') });
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('não depende da ordem dos candidatos', () => {
    const a = makeResult();
    const b = { ...a, candidates: [...a.candidates].reverse() };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('um voto a mais muda o hash', () => {
    const a = makeResult();
    const b = makeResult();
    b.candidates[0] = { ...b.candidates[0], votes: b.candidates[0].votes + 1 };
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

describe('decideAcceptance (R-3, R-7, AC-05)', () => {
  const at = brt('2026-10-25T20:00:00');

  it('sem anterior → changed', () => {
    expect(
      decideAcceptance({ lastGeneratedAt: null, lastHash: null }, { generatedAt: at, hash: 'h' }),
    ).toBe('changed');
  });

  it('gerado antes do último aceito → stale (mesmo com conteúdo diferente)', () => {
    expect(
      decideAcceptance(
        { lastGeneratedAt: brt('2026-10-25T20:00:01'), lastHash: 'h' },
        { generatedAt: at, hash: 'outro' },
      ),
    ).toBe('stale');
  });

  it('mesmo horário e mesmo hash → unchanged', () => {
    expect(
      decideAcceptance({ lastGeneratedAt: at, lastHash: 'h' }, { generatedAt: at, hash: 'h' }),
    ).toBe('unchanged');
  });

  it('posterior com hash diferente → changed', () => {
    expect(
      decideAcceptance(
        { lastGeneratedAt: at, lastHash: 'h' },
        { generatedAt: brt('2026-10-25T20:01:00'), hash: 'novo' },
      ),
    ).toBe('changed');
  });
});
