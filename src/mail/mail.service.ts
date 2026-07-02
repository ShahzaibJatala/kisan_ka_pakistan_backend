import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'Gmail',
      port: 465,
      secure: true,
      auth: {
        user: process.env.USER_EMAIL,
        pass: process.env.USER_PASSWORD, // Use an App Password if using Gmail
      },
    });
  }

  async sendOtpMail(to: string, otp: string) {
    try {
      await this.transporter.sendMail({
        from: `"ClinicWeb Support" <${process.env.USER_EMAIL}>`,
        to,
        subject: 'LMS Reset Password',
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
            <h2>Password Reset Request</h2>
            <p>Your OTP for Reset Password is:</p>
            <h1 style="color: #4A90E2; letter-spacing: 5px;">${otp}</h1>
            <p>This code <b>expires in 5 minutes</b>.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
        `,
      });
      return { success: true };
    } catch (error) {
      console.error('Mail Error:', error);
      throw new InternalServerErrorException('Failed to send reset email');
    }
  }
}
