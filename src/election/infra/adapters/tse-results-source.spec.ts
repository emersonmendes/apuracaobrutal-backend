import { TEST_CONFIG } from '../../domain/__fixtures__/scope-result.builder';
import { scopeFileUrl, TseResultsSource, type FetchFn } from './tse-results-source';

function source(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return {
    calls,
    adapter: new TseResultsSource(TEST_CONFIG, 'apuracaobrutal-worker/0.0.1', fetchFn),
  };
}

describe('TseResultsSource (FR-02, R-11, AC-12)', () => {
  it('monta a URL do .jws de Presidente com código de 6 dígitos', () => {
    expect(scopeFileUrl(TEST_CONFIG, 'br')).toBe(
      'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.jws',
    );
    expect(scopeFileUrl(TEST_CONFIG, 'sp')).toBe(
      'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-c0001-e006258-u.jws',
    );
  });

  it('200 → ok com corpo e ETag; envia User-Agent, If-None-Match, sem seguir redirect', async () => {
    const { adapter, calls } = source(
      () => new Response('a.b.c', { status: 200, headers: { etag: '"e2"' } }),
    );
    expect(await adapter.fetchScope('br', '"e1"')).toEqual({
      kind: 'ok',
      body: 'a.b.c',
      etag: '"e2"',
    });
    expect(calls[0].init.headers).toEqual({
      'User-Agent': 'apuracaobrutal-worker/0.0.1',
      'If-None-Match': '"e1"',
    });
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.signal).toBeDefined();
  });

  it('sem ETag anterior não envia If-None-Match', async () => {
    const { adapter, calls } = source(() => new Response('x', { status: 200 }));
    await adapter.fetchScope('br', null);
    expect(calls[0].init.headers).toEqual({ 'User-Agent': 'apuracaobrutal-worker/0.0.1' });
  });

  it.each([
    [304, { kind: 'not_modified' }],
    [404, { kind: 'not_found' }],
    [403, { kind: 'blocked' }],
    [429, { kind: 'blocked' }],
    [500, { kind: 'error', reason: 'HTTP 500' }],
    [301, { kind: 'error', reason: 'HTTP 301' }],
  ])('HTTP %i', async (status, expected) => {
    const { adapter } = source(() => new Response(null, { status }));
    expect(await adapter.fetchScope('br', null)).toEqual(expected);
  });

  it('corpo acima de 2 MB → erro', async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const { adapter } = source(() => new Response(big, { status: 200 }));
    expect(await adapter.fetchScope('br', null)).toEqual({
      kind: 'error',
      reason: 'corpo acima de 2 MB',
    });
  });

  it('falha de rede/timeout → erro', async () => {
    const { adapter } = source(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const result = await adapter.fetchScope('br', null);
    expect(result).toEqual({ kind: 'error', reason: expect.stringMatching(/falha de rede/) });
  });
});
