import type { FeedVersion, GetElectionFeed } from '../../application/get-election-feed';
import { FeedPublisher, KEEP_ALIVE_MS, MAX_PENDING_BYTES, type SseClient } from './feed-publisher';

class FakeGetFeed {
  version: FeedVersion = { feedVersion: 1, sourceStatus: 'ok' };
  feedCalls = 0;
  async getVersion() {
    return { ...this.version };
  }
  async getFeed() {
    this.feedCalls++;
    return { ...this.version, snapshot: null };
  }
}

function fakeClient(onWrite: (chunk: string) => void = () => undefined, pending = 0) {
  const client: SseClient & { closed: boolean; pending: number } = {
    closed: false,
    pending,
    write: onWrite,
    pendingBytes: () => client.pending,
    close: () => {
      client.closed = true;
    },
  };
  return client;
}

function setup(maxClients = 10) {
  const getFeed = new FakeGetFeed();
  const publisher = new FeedPublisher(getFeed as unknown as GetElectionFeed, 2000, maxClients);
  const messages: string[] = [];
  const client = fakeClient((chunk) => messages.push(chunk));
  return { getFeed, publisher, messages, client };
}

describe('FeedPublisher (FR-07, Fluxo 4; AC-15)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('monta o feed na primeira leitura', async () => {
    const { publisher, getFeed } = setup();
    expect(await publisher.currentFeed()).toEqual({
      version: 1,
      feed: { sourceStatus: 'ok', snapshot: null },
    });
    expect(getFeed.feedCalls).toBe(1);
  });

  it('transmite só quando a versão ou o sourceStatus mudam, montando o feed uma vez', async () => {
    const { publisher, getFeed, messages, client } = setup();
    await publisher.currentFeed();
    publisher.addClient(client);
    publisher.addClient(fakeClient());
    publisher.onModuleInit();

    await jest.advanceTimersByTimeAsync(2000);
    expect(messages).toEqual([]);
    expect(getFeed.feedCalls).toBe(1);

    getFeed.version = { feedVersion: 2, sourceStatus: 'ok' };
    await jest.advanceTimersByTimeAsync(2000);
    expect(getFeed.feedCalls).toBe(2);
    expect(messages).toEqual([
      'event: feed\nid: 2\ndata: {"sourceStatus":"ok","snapshot":null}\n\n',
    ]);

    getFeed.version = { feedVersion: 2, sourceStatus: 'failed' };
    await jest.advanceTimersByTimeAsync(2000);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain('"sourceStatus":"failed"');
    publisher.onModuleDestroy();
  });

  it('keep-alive a cada 15 s', async () => {
    const { publisher, messages, client } = setup();
    await publisher.currentFeed();
    publisher.addClient(client);
    publisher.onModuleInit();
    await jest.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
    expect(messages).toContain(': ping\n\n');
    publisher.onModuleDestroy();
  });

  it('respeita o limite de clientes e libera ao remover', () => {
    const { publisher } = setup(1);
    const a = fakeClient();
    expect(publisher.addClient(a)).toBe(true);
    expect(publisher.addClient(fakeClient())).toBe(false);
    publisher.removeClient(a);
    expect(publisher.addClient(fakeClient())).toBe(true);
  });

  it('falha de leitura não derruba o processo e o feed anterior continua valendo', async () => {
    const { publisher, getFeed } = setup();
    await publisher.currentFeed();
    getFeed.getVersion = async () => {
      throw new Error('banco fora');
    };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    publisher.onModuleInit();
    await jest.advanceTimersByTimeAsync(2000);
    expect((await publisher.currentFeed()).version).toBe(1);
    publisher.onModuleDestroy();
  });

  it('desconecta o cliente que não está lendo (buffer > 1 MB), sem afetar os demais (H-1)', async () => {
    const { publisher, getFeed, messages, client } = setup();
    await publisher.currentFeed();
    const stalled = fakeClient(() => undefined, MAX_PENDING_BYTES + 1);
    publisher.addClient(client);
    publisher.addClient(stalled);
    publisher.onModuleInit();

    getFeed.version = { feedVersion: 2, sourceStatus: 'ok' };
    await jest.advanceTimersByTimeAsync(2000);

    expect(stalled.closed).toBe(true);
    expect(publisher.clientCount).toBe(1);
    expect(messages).toHaveLength(1);
    publisher.onModuleDestroy();
  });
});
