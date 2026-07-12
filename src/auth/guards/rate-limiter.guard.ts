import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private localStore = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.headers['x-forwarded-for'] || request.connection?.remoteAddress || 'unknown';
    
    const path = request.route?.path || request.url;
    const key = `rate-limit:${path}:${ip}`;

    try {
      // 1. Try Redis first
      const count = await this.redisService.incr(key);
      if (count === 1) {
        await this.redisService.expire(key, 60);
      }
      if (count > 6) {
        throw new HttpException('Too many requests. Please try again after a minute.', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      
      // 2. Fallback to in-memory store if Redis throws/fails
      const now = Date.now();
      const record = this.localStore.get(key);
      if (!record || now > record.expiresAt) {
        this.localStore.set(key, { count: 1, expiresAt: now + 60000 });
      } else {
        record.count++;
        if (record.count > 6) {
          throw new HttpException('Too many requests. Please try again after a minute.', HttpStatus.TOO_MANY_REQUESTS);
        }
      }
    }

    return true;
  }
}
