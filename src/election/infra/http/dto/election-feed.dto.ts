// DTOs de documentação do contrato ElectionFeedResponse (spec election-results-feed FR-07).
// Espelham `domain/election-snapshot.ts`; só anotações de Swagger.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COMBAT_MOVES, type CombatMove } from '../../../domain/election-snapshot';

export class ElectionInfoDto {
  @ApiProperty({ example: 2026 }) year!: number;
  @ApiProperty({ example: 'PRESIDENTE' }) office!: string;
  @ApiProperty({ example: 'BRASIL' }) scope!: string;
  @ApiProperty({ enum: [1, 2], example: 2 }) round!: 1 | 2;
}

export class CandidateDto {
  @ApiProperty({ description: 'Sequencial do candidato no TSE (sqcand)' }) id!: string;
  @ApiProperty({ description: 'Nome de urna, como o TSE publica', example: 'LULA' }) name!: string;
  @ApiProperty({ example: 'PT' }) party!: string;
  @ApiProperty({ enum: ['red', 'blue'] }) side!: 'red' | 'blue';
  @ApiProperty() votes!: number;
  @ApiProperty({ description: 'Percentual de votos válidos (pvapn do TSE)' })
  validVotesPct!: number;
  @ApiPropertyOptional({ description: 'Foto oficial do TSE' }) imageUrl?: string;
}

export class StateResultDto {
  @ApiProperty({ example: 'SP' }) uf!: string;
  @ApiProperty() countedSectionsPct!: number;
  @ApiProperty({ type: Number, nullable: true }) redPct!: number | null;
  @ApiProperty({ type: Number, nullable: true }) bluePct!: number | null;
}

export class TimelinePointDto {
  @ApiProperty({ description: 'ISO-8601 (horário de Brasília)' }) at!: string;
  @ApiProperty() redPct!: number;
  @ApiProperty() bluePct!: number;
}

export class ElectionEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'ISO-8601 (horário de Brasília)' }) at!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: ['red', 'blue', 'neutral'] }) side!: 'red' | 'blue' | 'neutral';
}

export class CombatEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'ISO-8601 (horário de Brasília) do evento de apuração de origem' })
  at!: string;
  @ApiProperty({ enum: COMBAT_MOVES, description: 'Estado pedido ao lutador vermelho' })
  red!: CombatMove;
  @ApiProperty({ enum: COMBAT_MOVES, description: 'Estado pedido ao lutador azul' })
  blue!: CombatMove;
}

export class ElectionSnapshotDto {
  @ApiProperty({ enum: ['simulated', 'official'] }) origin!: 'simulated' | 'official';
  @ApiProperty({ type: ElectionInfoDto }) election!: ElectionInfoDto;
  @ApiProperty({ enum: ['not_started', 'partial', 'final'] })
  status!: 'not_started' | 'partial' | 'final';
  @ApiProperty({ description: 'Horário de totalização publicado pelo TSE (ISO-8601)' })
  updatedAt!: string;
  @ApiProperty() countedSectionsPct!: number;
  @ApiProperty({ type: [CandidateDto], minItems: 2, maxItems: 2 }) candidates!: CandidateDto[];
  @ApiProperty({ type: String, nullable: true }) winnerId!: string | null;
  @ApiProperty({ type: [StateResultDto] }) states!: StateResultDto[];
  @ApiProperty({ type: [String] }) featuredStates!: string[];
  @ApiProperty({ type: [TimelinePointDto] }) timeline!: TimelinePointDto[];
  @ApiProperty({ type: [ElectionEventDto] }) events!: ElectionEventDto[];
  @ApiProperty({
    type: [CombatEventDto],
    description: 'Os 20 golpes mais recentes, do mais antigo para o mais novo (combat-events)',
  })
  combatEvents!: CombatEventDto[];
}

export class ElectionFeedResponseDto {
  @ApiProperty({ enum: ['ok', 'failed'], description: 'Saúde da fonte oficial (R-10)' })
  sourceStatus!: 'ok' | 'failed';
  @ApiProperty({ type: ElectionSnapshotDto, nullable: true })
  snapshot!: ElectionSnapshotDto | null;
}
