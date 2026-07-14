import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class MailService {
  constructor(
    @InjectQueue('mail-queue') private readonly mailQueue: Queue,
  ) {}

  async sendOtpMail(to: string, otp: string) {
    try {
      await this.mailQueue.add('sendOtpMail', { to, otp });
      return { success: true };
    } catch (error) {
      console.error('Mail Queue Error:', error);
      throw new InternalServerErrorException('Failed to enqueue reset email');
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
