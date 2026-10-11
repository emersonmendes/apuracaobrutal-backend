import { Module } from '@nestjs/common';
import { ModerateImage } from './application/moderate-image';
import { IMAGE_ANALYZER, type ImageAnalyzer } from './domain/ports/image-analyzer';
import { ClaudeImageAnalyzer } from './infra/adapters/claude-image-analyzer';
import { SimulatedImageAnalyzer } from './infra/adapters/simulated-image-analyzer';
import {
  MODERATION_CONFIG,
  parseModerationConfig,
  type ModerationConfig,
} from './infra/config/moderation-config.factory';

/**
 * Moderação automática de imagens (spec sponsorship-image-moderation FR-04). Só o worker importa
 * este módulo: o backend HTTP nunca lê a chave da API (FR-01).
 */
@Module({
  providers: [
    { provide: MODERATION_CONFIG, useFactory: () => parseModerationConfig(process.env) },
    {
      provide: IMAGE_ANALYZER,
      useFactory: (config: ModerationConfig): ImageAnalyzer =>
        config.analyzer === 'claude'
          ? new ClaudeImageAnalyzer(config)
          : new SimulatedImageAnalyzer(),
      inject: [MODERATION_CONFIG],
    },
    {
      provide: ModerateImage,
      useFactory: (analyzer: ImageAnalyzer, config: ModerationConfig) =>
        new ModerateImage(analyzer, config.timeoutMs),
      inject: [IMAGE_ANALYZER, MODERATION_CONFIG],
    },
  ],
  exports: [MODERATION_CONFIG, IMAGE_ANALYZER, ModerateImage],
})
export class ModerationModule {}
