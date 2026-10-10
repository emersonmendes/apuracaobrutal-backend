import {
  InvalidElectionConfigError,
  OFFICIAL_TSE_JWK,
  parseElectionConfig,
} from './election-config.factory';

describe('parseElectionConfig (FR-01, AC-01)', () => {
  it('aplica os padrões', () => {
    expect(parseElectionConfig({})).toEqual({
      resultsUrl: 'https://resultados.tse.jus.br/oficial',
      cycle: 'ele2026',
      electionCode: '6258',
      jwk: OFFICIAL_TSE_JWK,
      sides: { red: 13, blue: 22 },
      pollIntervalSeconds: 15,
      staleAfterSeconds: 90,
      feedRefreshMs: 2000,
      sseMaxClients: 5000,
    });
  });

  it('lê os valores do ambiente, aceitando campos extras na JWK', () => {
    const config = parseElectionConfig({
      TSE_RESULTS_URL: 'https://resultados-sim.tse.jus.br/simulado/simulado2026',
      TSE_ELECTION_CODE: '21270',
      TSE_JWS_PUBLIC_JWK:
        '{"kty":"OKP","use":"sig","alg":"EdDSA","kid":"k","crv":"Ed25519","x":"abc"}',
      ELECTION_RED_CANDIDATE_NUMBER: '57',
      ELECTION_BLUE_CANDIDATE_NUMBER: '89',
      TSE_POLL_INTERVAL_SECONDS: '5',
      SOURCE_STALE_AFTER_SECONDS: '10',
    });
    expect(config).toMatchObject({
      electionCode: '21270',
      jwk: { kty: 'OKP', crv: 'Ed25519', kid: 'k', x: 'abc' },
      sides: { red: 57, blue: 89 },
      pollIntervalSeconds: 5,
      staleAfterSeconds: 10,
    });
  });

  it.each<[string, Record<string, string>]>([
    ['URL http', { TSE_RESULTS_URL: 'http://resultados.tse.jus.br/oficial' }],
    ['URL com barra final', { TSE_RESULTS_URL: 'https://resultados.tse.jus.br/oficial/' }],
    ['ciclo inválido', { TSE_CYCLE: '2026' }],
    ['código com letras', { TSE_ELECTION_CODE: '62a8' }],
    ['código longo', { TSE_ELECTION_CODE: '1234567' }],
    ['JWK não-JSON', { TSE_JWS_PUBLIC_JWK: 'abc' }],
    ['JWK RSA', { TSE_JWS_PUBLIC_JWK: '{"kty":"RSA","kid":"k","x":"a","crv":"Ed25519"}' }],
    ['lados iguais', { ELECTION_RED_CANDIDATE_NUMBER: '13', ELECTION_BLUE_CANDIDATE_NUMBER: '13' }],
    ['intervalo < 5', { TSE_POLL_INTERVAL_SECONDS: '4' }],
    ['frescor < 2 × intervalo', { SOURCE_STALE_AFTER_SECONDS: '29' }],
    ['refresh < 500', { FEED_REFRESH_MS: '100' }],
    ['limite SSE 0', { SSE_MAX_CLIENTS: '0' }],
    ['número não inteiro', { ELECTION_RED_CANDIDATE_NUMBER: '1.5' }],
  ])('%s → erro', (_label, env) => {
    expect(() => parseElectionConfig(env)).toThrow(InvalidElectionConfigError);
  });

  it('lista todas as variáveis inválidas de uma vez', () => {
    try {
      parseElectionConfig({ TSE_CYCLE: 'x', SSE_MAX_CLIENTS: '0' });
      fail('deveria lançar');
    } catch (error) {
      expect((error as InvalidElectionConfigError).problems).toHaveLength(2);
    }
  });
});
