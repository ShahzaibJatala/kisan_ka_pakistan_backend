import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

const refreshTokenExtractor = (req: Request): string | null => {
  // 1. Try extracting from cookies
  if (req.cookies && req.cookies['refresh_token']) {
    return req.cookies['refresh_token'];
  }

  // 2. Try extracting from custom 'refresh_token' header
  if (req.headers['refresh_token']) {
    return req.headers['refresh_token'] as string;
  }

  // 3. Try extracting from body
  if (req.body && req.body.refresh_token) {
    return req.body.refresh_token;
  }

  // 4. Try extracting from Authorization header (Bearer token)
  if (req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
  }

  return null;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: refreshTokenExtractor,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const userId = payload.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    const token = refreshTokenExtractor(req);
    if (!token) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    const tokenMatches = await bcrypt.compare(token, user.refreshToken);
    if (!tokenMatches) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    return user;
  }
}
