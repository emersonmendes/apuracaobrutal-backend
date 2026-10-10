import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { FeedVersion, GetElectionFeed } from '../../application/get-election-feed';
import type { ElectionFeedResponse } from '../../domain/election-snapshot';

export const KEEP_ALIVE_MS = 15_000;
/** Acima disso pendente de envio, o cliente não está lendo e é desconectado (FR-07). */
export const MAX_PENDING_BYTES = 1024 * 1024;

/** Destino de mensagens SSE (a resposta HTTP de um cliente). */
export interface SseClient {
  write(chunk: string): void;
  /** Bytes ainda não enviados ao cliente. */
  pendingBytes(): number;
  close(): void;
}

export interface CurrentFeed {
  version: number;
  feed: ElectionFeedResponse;
}

export function feedMessage(current: CurrentFeed): string {
  return `event: feed\nid: ${current.version}\ndata: ${JSON.stringify(current.feed)}\n\n`;
}

/**
 * Mantém o feed atual e o transmite aos clientes SSE (spec election-results-feed FR-07; Fluxo 4).
 * Lê só a versão a cada `refreshMs` e remonta o snapshot uma vez por mudança.
 */
export class FeedPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedPublisher.name);
  private readonly clients = new Set<SseClient>();
  private current: CurrentFeed | null = null;
  private lastVersion: FeedVersion | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly getElectionFeed: GetElectionFeed,
    private readonly refreshMs: number,
    private readonly maxClients: number,
  ) {}

  onModuleInit(): void {
    // Falhas já foram registradas no log em doRefresh; o próximo tick tenta de novo.
    this.refreshTimer = setInterval(() => this.refresh().catch(() => undefined), this.refreshMs);
    this.keepAliveTimer = setInterval(() => this.broadcast(': ping\n\n'), KEEP_ALIVE_MS);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.clients.clear();
  }

  /** Feed atual; monta na hora se ainda não houver. */
  async currentFeed(): Promise<CurrentFeed> {
    if (!this.current) await this.refresh(true);
    return this.current!;
  }

  /** Registra um cliente; `false` quando o limite de conexões foi atingido. */
  addClient(client: SseClient): boolean {
    if (this.clients.size >= this.maxClients) return false;
    this.clients.add(client);
    return true;
  }

  removeClient(client: SseClient): void {
    this.clients.delete(client);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Lê a versão; se ela ou o `sourceStatus` mudaram, remonta o feed e transmite. */
  refresh(force = false): Promise<void> {
    // Uma leitura por vez: chamadas concorrentes aguardam a mesma.
    if (!this.refreshing) {
      this.refreshing = this.doRefresh(force).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(force: boolean): Promise<void> {
    try {
      const version = await this.getElectionFeed.getVersion();
      const changed =
        !this.lastVersion ||
        version.feedVersion !== this.lastVersion.feedVersion ||
        version.sourceStatus !== this.lastVersion.sourceStatus;
      if (!changed && !force && this.current) return;

      const { feedVersion, ...feed } = await this.getElectionFeed.getFeed();
      const hadFeed = this.current !== null;
      this.current = { version: feedVersion, feed };
      this.lastVersion = { feedVersion, sourceStatus: feed.sourceStatus };
      if (hadFeed || !force) this.broadcast(feedMessage(this.current));
    } catch (error) {
      this.logger.warn(`falha ao atualizar o feed: ${(error as Error).message}`);
      if (!this.current) throw error;
    }
  }

  private broadcast(chunk: string): void {
    for (const client of this.clients) {
      if (client.pendingBytes() > MAX_PENDING_BYTES) {
        // Cliente lento ou parado: desconecta para a memória não crescer sem limite.
        this.clients.delete(client);
        client.close();
        continue;
      }
      try {
        client.write(chunk);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
