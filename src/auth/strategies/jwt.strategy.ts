import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

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
  constructor() {
    super({
      jwtFromRequest: cookieOrHeaderExtractor,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
    });
  }

  async validate(payload: any) {
    console.log('[JwtStrategy] Validating payload:', payload);
    return {
      id: payload.sub,
      phone: payload.phone,
      email: payload.email,
      role: payload.role,
    };
  }
}
