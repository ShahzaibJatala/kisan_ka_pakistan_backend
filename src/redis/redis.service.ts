import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = parseInt(this.configService.get<string>('REDIS_PORT') || '6379', 10);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const tls = host === 'localhost' ? undefined : {};

    this.client = new Redis({
      host,
      port,
      username: 'default',
      password,
      tls,
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (e) {
      console.error(`[RedisService] Get error for key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (e) {
      console.error(`[RedisService] Set error for key ${key}:`, e);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (e) {
      console.error(`[RedisService] Del error for key ${key}:`, e);
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (e) {
      console.error(`[RedisService] Incr error for key ${key}:`, e);
      throw e;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (e) {
      console.error(`[RedisService] Expire error for key ${key}:`, e);
      throw e;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (e) {
      console.error(`[RedisService] TTL error for key ${key}:`, e);
      return -1;
    }
  }

  /**
   * Delete all keys matching a glob pattern using SCAN (non-blocking).
   * Example: delByPattern('artia:profile:*')
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (e) {
      console.error(`[RedisService] DelByPattern error for pattern ${pattern}:`, e);
    }
  }
}

