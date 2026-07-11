import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { InternalServerErrorException } from '@nestjs/common';

@Processor('mail-queue')
export class MailProcessor extends WorkerHost {
  private transporter: nodemailer.Transporter;

  constructor() {
    super();
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.USER_EMAIL,
        pass: process.env.USER_PASSWORD,
      },
    });
  }

  async process(job: Job<any>): Promise<any> {
    try {
      console.log(`[MailProcessor] Processing job: ${job.name}`);
      switch (job.name) {
        case 'sendOtpMail':
          return await this.handleSendOtpMail(job.data);
        case 'sendVerificationRequestMail':
          return await this.handleSendVerificationRequestMail(job.data);
        case 'sendVerificationSuccessMail':
          return await this.handleSendVerificationSuccessMail(job.data);
        case 'sendSuperAdminOtpMail':
          return await this.handleSendSuperAdminOtpMail(job.data);
        case 'sendGoogleSignupAlert':
          return await this.handleSendGoogleSignupAlert(job.data);
        default:
          console.warn(`[MailProcessor] Unknown job name: ${job.name}`);
      }
    } catch (error) {
      console.error(`[MailProcessor] Error processing ${job.name}:`, error);
      throw error;
    }
  }

  private async handleSendOtpMail(data: { to: string; otp: string }) {
    const { to, otp } = data;
    const subject = 'Kisan ka Pakistan - Password Reset OTP';
    const text = `Password Reset Request. Your OTP code is: ${otp}. It expires in 5 minutes.`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; max-width: 600px; margin: auto;">
        <h2 style="color: #2E7D32;">Password Reset Request</h2>
        <p>Your verification code for resetting your password is:</p>
        <h1 style="color: #2E7D32; letter-spacing: 5px; text-align: center; background: #fafafa; padding: 15px; border-radius: 4px;">${otp}</h1>
        <p>This code <b>expires in 5 minutes</b>.</p>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">If you didn't request this, please ignore this email.</p>
      </div>
    `;

    await this.transporter.sendMail({
      from: `"Kisan ka Pakistan Support" <${process.env.USER_EMAIL}>`,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
      },
    });
  }

  private async handleSendVerificationRequestMail(data: { to: string; requester: any; verifyUrl: string }) {
    const { to, requester, verifyUrl } = data;
    const subject = `Verification Request: ${requester.role} - ${requester.name}`;
    
    let docRowsText = '';
    let docRowsHtml = '';
    
    if (requester.role === 'FARMER') {
      docRowsText = `Role: Farmer\nName: ${requester.name}\nEmail: ${requester.email || 'N/A'}\nCNIC: ${requester.cnic || 'N/A'}\nAddress: ${requester.address || 'N/A'}`;
      docRowsHtml = `
        <tr><td><b>Role:</b></td><td>Farmer</td></tr>
        <tr><td><b>Name:</b></td><td>${requester.name}</td></tr>
        <tr><td><b>Email:</b></td><td>${requester.email || 'N/A'}</td></tr>
        <tr><td><b>CNIC:</b></td><td>${requester.cnic || 'N/A'}</td></tr>
        <tr><td><b>Address:</b></td><td>${requester.address || 'N/A'}</td></tr>
      `;
    } else {
      docRowsText = `Role: ${requester.role}\nName: ${requester.name}\nEmail: ${requester.email || 'N/A'}\nPhone: ${requester.phone || 'N/A'}\nCNIC: ${requester.cnic || 'N/A'}\nAddress: ${requester.address || 'N/A'}\nCity: ${requester.city || 'N/A'}`;
      docRowsHtml = `
        <tr><td><b>Role:</b></td><td>${requester.role}</td></tr>
        <tr><td><b>Name:</b></td><td>${requester.name}</td></tr>
        <tr><td><b>Email:</b></td><td>${requester.email || 'N/A'}</td></tr>
        <tr><td><b>Phone:</b></td><td>${requester.phone || 'N/A'}</td></tr>
        <tr><td><b>CNIC:</b></td><td>${requester.cnic || 'N/A'}</td></tr>
        <tr><td><b>Address:</b></td><td>${requester.address || 'N/A'}</td></tr>
        <tr><td><b>City:</b></td><td>${requester.city || 'N/A'}</td></tr>
        <tr><td><b>Profile Image:</b></td><td>${requester.profileImage ? `<img src="${requester.profileImage}" width="100" />` : 'N/A'}</td></tr>
      `;
    }

    const text = `New Verification Request.\n\n${docRowsText}\n\nVerify this account using the link below:\n${verifyUrl}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; max-width: 600px; margin: auto;">
        <h2 style="color: #2E7D32;">New Verification Request</h2>
        <p>A verification request has been submitted with the following details:</p>
        <table cellpadding="8" style="width: 100%; border-collapse: collapse;">
          ${docRowsHtml}
        </table>
        <div style="margin-top: 30px; text-align: center;">
          <a href="${verifyUrl}" style="background-color: #2E7D32; color: white; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">Verify Account Now</a>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          If the button doesn't work, copy and paste this link in your browser:<br/>
          <a href="${verifyUrl}">${verifyUrl}</a>
        </p>
      </div>
    `;

    console.log('--- LOCAL TESTING (Verify URL) ---\n', verifyUrl, '\n---------------------------------');
    await this.transporter.sendMail({
      from: `"Kisan ka Pakistan Support" <${process.env.USER_EMAIL}>`,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
      },
    });
  }

  private async handleSendVerificationSuccessMail(data: { to: string; dashboardUrl: string; role: string }) {
    const { to, dashboardUrl, role } = data;
    const subject = 'Account Verified Successfully - Kisan ka Pakistan';
    const text = `Congratulations! Your account as ${role} has been verified successfully.\n\nAccess your account using the link below:\n${dashboardUrl}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; max-width: 600px; margin: auto;">
        <h2 style="color: #2E7D32;">Congratulations! Your Account is Verified</h2>
        <p>Your account as <b>${role}</b> has been verified by the respective authority.</p>
        <p>You can now log in and access all the features of your role.</p>
        <div style="margin-top: 30px; text-align: center;">
          <a href="${dashboardUrl}" style="background-color: #2E7D32; color: white; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">Login to your Account</a>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          If the button doesn't work, copy and paste this link in your browser:<br/>
          <a href="${dashboardUrl}">${dashboardUrl}</a>
        </p>
      </div>
    `;

    console.log('--- LOCAL TESTING (Dashboard URL) ---\n', dashboardUrl, '\n------------------------------------');
    await this.transporter.sendMail({
      from: `"Kisan ka Pakistan Support" <${process.env.USER_EMAIL}>`,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
      },
    });
  }

  private async handleSendSuperAdminOtpMail(data: { to: string; otp: string }) {
    const { to, otp } = data;
    const subject = 'Super Admin Login - 2FA Verification Code';
    const text = `Super Admin Login Verification. Your 2FA code is: ${otp}. It expires in 5 minutes.`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; max-width: 600px; margin: auto;">
        <h2 style="color: #d32f2f;">Super Admin Login Verification</h2>
        <p>A login request was made for your Super Admin account.</p>
        <p>Your 2FA verification code is:</p>
        <h1 style="color: #d32f2f; letter-spacing: 5px; font-size: 32px; text-align: center; border: 1px dashed #ccc; padding: 10px; background-color: #fafafa;">${otp}</h1>
        <p>This code <b>expires in 5 minutes</b>.</p>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          If you did not request this login, please change your credentials immediately.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: `"Kisan ka Pakistan Security" <${process.env.USER_EMAIL}>`,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
      },
    });
  }

  private async handleSendGoogleSignupAlert(data: { to: string; user: any }) {
    const { to, user } = data;
    const subject = 'New User Registration (Google OAuth) - Kisan ka Pakistan';
    const text = `A new user has registered using Google OAuth:\n\nName: ${user.name}\nEmail: ${user.email}\nRole: FARMER\n\nThis user's status is PENDING and requires verification.`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; max-width: 600px; margin: auto;">
        <h2 style="color: #2E7D32;">New User Registration (Google OAuth)</h2>
        <p>A new user has registered on the platform using Google OAuth:</p>
        <table cellpadding="8" style="width: 100%; border-collapse: collapse;">
          <tr><td><b>Name:</b></td><td>${user.name}</td></tr>
          <tr><td><b>Email:</b></td><td>${user.email || 'N/A'}</td></tr>
          <tr><td><b>Role:</b></td><td>FARMER</td></tr>
        </table>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          This user has been created with a PENDING state and requires standard verification.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: `"Kisan ka Pakistan System" <${process.env.USER_EMAIL}>`,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
      },
    });
  }
}
