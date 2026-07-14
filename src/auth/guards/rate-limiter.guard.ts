import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * RateLimiterGuard — General API Rate Limiter
 * Limits: 100 requests per minute per userId (authenticated) or IP (unauthenticated)
 * Registered as APP_GUARD in AppModule so it applies globally with DI support.
 *
 * Also used directly on sensitive endpoints (e.g. POST /auth/login)
 * where a stricter per-route limit is needed.
 */
@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly LIMIT = 100;
  private readonly WINDOW_SECONDS = 60; // 1 minute

  // In-memory fallback if Redis is unavailable
  private localStore = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Prefer userId for authenticated requests; fall back to IP
    const userId = request.user?.id;
    const ip =
      request.ip ||
      request.headers['x-forwarded-for'] ||
      request.connection?.remoteAddress ||
      'unknown';

    const identifier = userId ? `user:${userId}` : `ip:${ip}`;
    const key = `rate:api:${identifier}`;

    try {
      const count = await this.redisService.incr(key);
      if (count === 1) {
        await this.redisService.expire(key, this.WINDOW_SECONDS);
      }
      if (count > this.LIMIT) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Maximum ${this.LIMIT} requests per minute allowed.`,
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;

      // Fallback to in-memory store if Redis is unavailable
      const now = Date.now();
      const record = this.localStore.get(key);
      if (!record || now > record.expiresAt) {
        this.localStore.set(key, {
          count: 1,
          expiresAt: now + this.WINDOW_SECONDS * 1000,
        });
      } else {
        record.count++;
        if (record.count > this.LIMIT) {
          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message: `Rate limit exceeded. Maximum ${this.LIMIT} requests per minute allowed.`,
              error: 'Too Many Requests',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
    }

    return true;
  }
}
