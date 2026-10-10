import { PingController } from './ping.controller';

describe('PingController — specs/backend-bootstrap', () => {
  it('ping() retorna "pong" (AC-01)', () => {
    expect(new PingController().ping()).toBe('pong');
  });
});
