import { InvalidModerationConfigError, parseModerationConfig } from './moderation-config.factory';

describe('parseModerationConfig — spec sponsorship-image-moderation FR-01 (AC-01)', () => {
  it('padrões com rekognition', () => {
    expect(parseModerationConfig({})).toEqual({
      analyzer: 'rekognition',
      region: 'us-east-1',
      profile: null,
      timeoutMs: 15_000,
      labelMinConfidence: 60,
      celebrityMinConfidence: 90,
    });
  });

  it('lê região, profile, timeout e limiares', () => {
    expect(
      parseModerationConfig({
        AWS_REGION: 'sa-east-1',
        AWS_PROFILE: 'puoro',
        REKOGNITION_TIMEOUT_MS: '2000',
        SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE: '75',
        SPONSORSHIP_MODERATION_CELEBRITY_MIN_CONFIDENCE: '50',
      }),
    ).toEqual({
      analyzer: 'rekognition',
      region: 'sa-east-1',
      profile: 'puoro',
      timeoutMs: 2_000,
      labelMinConfidence: 75,
      celebrityMinConfidence: 50,
    });
  });

  it('simulated ignora AWS_*/REKOGNITION_* e nunca lê ANTHROPIC_*', () => {
    expect(
      parseModerationConfig({
        SPONSORSHIP_MODERATION: 'simulated',
        AWS_REGION: 'inválida',
        REKOGNITION_TIMEOUT_MS: 'abc',
        SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE: '1',
        ANTHROPIC_API_KEY: 'sk-ant-x',
        SPONSORSHIP_MODERATION_MIN_CONFIDENCE: '0.1',
      }),
    ).toEqual({
      analyzer: 'simulated',
      region: 'us-east-1',
      profile: null,
      timeoutMs: 15_000,
      labelMinConfidence: 60,
      celebrityMinConfidence: 90,
    });
  });

  it.each([
    ['SPONSORSHIP_MODERATION', 'claude'],
    ['SPONSORSHIP_MODERATION', 'gpt'],
    ['AWS_REGION', 'xx'],
    ['AWS_REGION', 'US-EAST-1'],
    ['REKOGNITION_TIMEOUT_MS', '1999'],
    ['REKOGNITION_TIMEOUT_MS', 'dez'],
    ['SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE', '49'],
    ['SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE', '101'],
    ['SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE', '0.8'],
    ['SPONSORSHIP_MODERATION_CELEBRITY_MIN_CONFIDENCE', '49'],
    ['SPONSORSHIP_MODERATION_CELEBRITY_MIN_CONFIDENCE', 'alta'],
  ])('%s=%s impede a inicialização', (name, raw) => {
    expect(() => parseModerationConfig({ [name]: raw })).toThrow(InvalidModerationConfigError);
  });

  it('simulated em produção não sobe', () => {
    expect(() =>
      parseModerationConfig({ SPONSORSHIP_MODERATION: 'simulated', NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });

  it('mensagens de erro não ecoam credenciais', () => {
    try {
      parseModerationConfig({ AWS_REGION: 'ruim', AWS_SECRET_ACCESS_KEY: 'SEGREDO123' });
      throw new Error('deveria falhar');
    } catch (error) {
      expect(String(error)).not.toContain('SEGREDO123');
    }
  });
});
