import type { Clock } from '../domain/ports/clock';
import type { ScheduleItem, SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import { salesEndAtOf } from '../domain/sales-cutoff';
import type { SponsorshipConfig } from '../domain/sponsorship-config';

/** Janela da agenda entregue à arena (FR-03). */
export const SCHEDULE_WINDOW_MS = 10 * 60_000;

/**
 * Agenda: `scheduled` com `endsAt > agora` e `startsAt < agora + 10 min` (FR-03, AC-10), mais o
 * fim das vendas para o botão da home (sponsorship-sales-cutoff FR-03, FR-06).
 */
export class GetSchedule {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
    private readonly config: Pick<SponsorshipConfig, 'electionDay'>,
  ) {}

  async execute(): Promise<{ serverTime: Date; salesEndAt: Date; items: ScheduleItem[] }> {
    const now = this.clock.now();
    const items = await this.repository.scheduleWindow(
      now,
      new Date(now.getTime() + SCHEDULE_WINDOW_MS),
    );
    return { serverTime: now, salesEndAt: salesEndAtOf(this.config.electionDay), items };
  }
}
