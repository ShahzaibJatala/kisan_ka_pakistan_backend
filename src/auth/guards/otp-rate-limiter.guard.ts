import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * OtpRateLimiterGuard
 * Limits: 5 OTP requests per email per hour (3600s sliding window)
 * Apply on: POST /auth/send-otp
 */
@Injectable()
export class OtpRateLimiterGuard implements CanActivate {
  private readonly LIMIT = 5;
  private readonly WINDOW_SECONDS = 3600; // 1 hour

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const email: string | undefined = request.body?.email;

    if (!email) {
      // No email in body — let validation pipe handle it
      return true;
    }

    const safeEmail = email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, '');
    const key = `rate:otp:${safeEmail}`;

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
            message: `OTP request limit reached. You can request at most ${this.LIMIT} OTPs per hour. Please try again later.`,
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis failure — fail open (allow request through)
      console.error('[OtpRateLimiterGuard] Redis error, failing open:', err);
    }

    return true;
  }
}
