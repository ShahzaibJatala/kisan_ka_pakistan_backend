import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private otpTransporter?: nodemailer.Transporter;
  constructor(
    @InjectQueue('mail-queue') private readonly mailQueue: Queue,
  ) {}

  async sendOtpMail(to: string, otp: string) {
    const user = process.env.USER_EMAIL;
    const pass = process.env.USER_PASSWORD;
    if (!user || !pass) throw new InternalServerErrorException('Email delivery is not configured. Please contact support.');
    try {
      this.otpTransporter ??= nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        auth: { user, pass },
      });
      await this.otpTransporter.sendMail({
        from: `"Kisan ka Pakistan Support" <${user}>`, to, replyTo: user,
        subject: `Your Kisan ka Pakistan Verification Code: ${otp}`,
        text: `Your password reset verification code is ${otp}. It expires in 5 minutes. If you did not request it, you can ignore this email.`,
      });
      return { success: true };
    } catch (error) {
      console.error('OTP email delivery error:', error);
      throw new InternalServerErrorException('We could not send the verification email. Please try again in a moment.');
    }
  }

  async sendVerificationRequestMail(to: string, requester: any, verifyUrl: string) {
    try {
      await this.mailQueue.add('sendVerificationRequestMail', { to, requester, verifyUrl });
      return { success: true };
    } catch (error) {
      console.error('Mail Queue Error:', error);
      throw new InternalServerErrorException('Failed to enqueue verification request email');
    }
  }

  async sendVerificationSuccessMail(to: string, dashboardUrl: string, role: string) {
    try {
      await this.mailQueue.add('sendVerificationSuccessMail', { to, dashboardUrl, role });
      return { success: true };
    } catch (error) {
      console.error('Mail Queue Error:', error);
      throw new InternalServerErrorException('Failed to enqueue verification success email');
    }
  }

  async sendSuperAdminOtpMail(to: string, otp: string) {
    try {
      await this.mailQueue.add('sendSuperAdminOtpMail', { to, otp });
      return { success: true };
    } catch (error) {
      console.error('Mail Queue Error:', error);
      throw new InternalServerErrorException('Failed to enqueue Super Admin 2FA email');
    }
  }

  async sendGoogleSignupAlert(to: string, user: any, verifyUrl: string) {
    try {
      await this.mailQueue.add('sendGoogleSignupAlert', { to, user, verifyUrl });
      return { success: true };
    } catch (error) {
      console.error('Mail Queue Error:', error);
      throw new InternalServerErrorException('Failed to enqueue Google signup alert email');
    }
  }

  async sendArtiaProfileUpdateMail(to: string, artiaName: string, shopDetails: any) {
    try {
      await this.mailQueue.add('sendArtiaProfileUpdateMail', { to, artiaName, shopDetails });
      return { success: true };
    } catch (error) {
      console.error('Mail Queue Error:', error);
      throw new InternalServerErrorException('Failed to enqueue Artia profile update email');
    }
  }
}
