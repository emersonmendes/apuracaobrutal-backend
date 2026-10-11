import { InvalidModerationConfigError, parseModerationConfig } from './moderation-config.factory';

const KEY = 'sk-ant-test-0123456789';

describe('parseModerationConfig — spec sponsorship-image-moderation FR-01 (AC-01)', () => {
  it('padrões com claude', () => {
    expect(parseModerationConfig({ ANTHROPIC_API_KEY: KEY })).toEqual({
      analyzer: 'claude',
      model: 'claude-opus-5-5',
      effort: 'medium',
      timeoutMs: 60_000,
      apiKey: KEY,
    });
  });

  it('lê modelo, effort e timeout', () => {
    expect(
      parseModerationConfig({
        ANTHROPIC_API_KEY: KEY,
        ANTHROPIC_MODERATION_MODEL: 'claude-sonnet-5-5',
        ANTHROPIC_MODERATION_EFFORT: 'low',
        ANTHROPIC_TIMEOUT_MS: '15000',
      }),
    ).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low', timeoutMs: 15_000 });
  });

  it('simulated ignora as ANTHROPIC_* e não guarda chave', () => {
    expect(
      parseModerationConfig({
        SPONSORSHIP_MODERATION: 'simulated',
        ANTHROPIC_TIMEOUT_MS: 'abc',
        ANTHROPIC_MODERATION_EFFORT: 'turbo',
      }),
    ).toEqual({
      analyzer: 'simulated',
      model: 'claude-opus-5-5',
      effort: 'medium',
      timeoutMs: 60_000,
      apiKey: null,
    });
  });

  it.each([
    ['sem chave', {}],
    ['analisador desconhecido', { SPONSORSHIP_MODERATION: 'gpt', ANTHROPIC_API_KEY: KEY }],
    ['simulated em produção', { SPONSORSHIP_MODERATION: 'simulated', NODE_ENV: 'production' }],
    ['modelo inválido', { ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODERATION_MODEL: 'Opus 5.5!' }],
    ['effort desconhecido', { ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODERATION_EFFORT: 'xhigh' }],
    ['timeout < 5000', { ANTHROPIC_API_KEY: KEY, ANTHROPIC_TIMEOUT_MS: '4999' }],
    ['timeout não inteiro', { ANTHROPIC_API_KEY: KEY, ANTHROPIC_TIMEOUT_MS: '1e4' }],
  ])('%s → não sobe', (_, env) => {
    expect(() => parseModerationConfig(env)).toThrow(InvalidModerationConfigError);
  });

  it('a mensagem de erro nunca ecoa a chave', () => {
    try {
      parseModerationConfig({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_TIMEOUT_MS: '1' });
      throw new Error('deveria falhar');
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY);
    }
  });
});
