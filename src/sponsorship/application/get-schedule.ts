import type { Clock } from '../domain/ports/clock';
import type { ScheduleItem, SponsorshipRepository } from '../domain/ports/sponsorship-repository';

/** Janela da agenda entregue à arena (FR-03). */
export const SCHEDULE_WINDOW_MS = 10 * 60_000;

/** Agenda: `scheduled` com `endsAt > agora` e `startsAt < agora + 10 min` (FR-03, AC-10). */
export class GetSchedule {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{ serverTime: Date; items: ScheduleItem[] }> {
    const now = this.clock.now();
    const items = await this.repository.scheduleWindow(
      now,
      new Date(now.getTime() + SCHEDULE_WINDOW_MS),
    );
    return { serverTime: now, items };
  }
}
