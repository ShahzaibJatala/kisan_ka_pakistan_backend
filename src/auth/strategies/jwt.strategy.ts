import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, UserStatus } from '@prisma/client';

const cookieOrHeaderExtractor = (req: Request): string | null => {
  console.log('[JwtStrategy] Extracting token from request...');
  // 1. Try extracting from Authorization header (Bearer token)
  if (req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      console.log('[JwtStrategy] Extracted Bearer token from Authorization header');
      return parts[1];
    }
  }

  // 2. Try extracting from custom 'access_token' header
  if (req.headers['access_token']) {
    console.log('[JwtStrategy] Extracted token from custom access_token header');
    return req.headers['access_token'] as string;
  }

  // 3. Try extracting from cookies
  if (req.cookies && req.cookies['access_token']) {
    console.log('[JwtStrategy] Extracted token from access_token cookie');
    return req.cookies['access_token'];
  }

  console.log('[JwtStrategy] No token found in headers, custom header, or cookies');
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: cookieOrHeaderExtractor,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, phone: true, email: true, role: true, status: true } });
    if (!user) throw new ForbiddenException('Account not found. Please sign in again.');
    if (user.status === UserStatus.SUSPENDED) throw new ForbiddenException('Your account is suspended. Please contact the officials.');
    if (user.role === Role.SADAR && user.status !== UserStatus.VERIFIED) throw new ForbiddenException('Your Sadar account is pending verification. Please contact the officials.');
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      role: user.role,
    };
  }
}
