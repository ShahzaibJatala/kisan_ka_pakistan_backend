import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * PriceRateLimiterGuard
 * Limits: 5 price posts per user per hour (3600s sliding window)
 * Apply on: POST /prices
 */
@Injectable()
export class PriceRateLimiterGuard implements CanActivate {
  private readonly LIMIT = 5;
  private readonly WINDOW_SECONDS = 3600; // 1 hour

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      // No user ID means unauthenticated — let auth guard handle it
      return true;
    }

    const key = `rate:price-post:${userId}`;

    try {
      const count = await this.redisService.incr(key);
      if (count === 1) {
        // First request in this window — set TTL
        await this.redisService.expire(key, this.WINDOW_SECONDS);
      }
      if (count > this.LIMIT) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Price posting limit reached. You can post at most ${this.LIMIT} prices per hour.`,
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis failure — fail open (allow request through)
      console.error('[PriceRateLimiterGuard] Redis error, failing open:', err);
    }

    return true;
  }
}
