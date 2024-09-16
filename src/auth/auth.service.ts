import { compareSync } from 'bcrypt';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { Auth } from './entities/auth.entity';
import { EmailService } from '../email/email.service';
import { InjectRepository } from '@nestjs/typeorm';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto';
import { FindOptions } from './interfaces/find-options.interface';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Auth)
    private readonly authRepository: Repository<Auth>,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerUserDto: RegisterDto) {
    const auth = this.authRepository.create(registerUserDto);

    try {
      await this.authRepository.save(auth);
      const token = this.jwtService.sign({ email: auth.email });
      const confirmationUrl = `${process.env.HOST}:${process.env.PORT}/api/auth/confirm?token=${token}`;

      this.emailService.sendEmail(
        auth.email,
        'Confirma tu registro',
        'confirmation',
        { name: auth.email, url: confirmationUrl },
      );

      return {
        message: 'Registered user. Please check your email to confirm.',
      };
    } catch (error) {
      this.handleErrors(error);
    }
  }

  async findById(id: string, options?: FindOptions): Promise<Auth> {
    const auth = await this.authRepository.findOne({ where: { id } });
    if (!auth)
      throw new UnauthorizedException(
        options?.notFoundMessage || 'Auth id not found',
      );
    return auth;
  }

  async findByEmail(email: string, options?: FindOptions): Promise<Auth> {
    const auth: Auth = await this.authRepository.findOne({ where: { email } });
    if (!auth)
      throw new UnauthorizedException(
        options?.notFoundMessage || 'Email not found',
      );
    return auth;
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const auth = await this.findByEmail(email, {
      notFoundMessage: 'Invalid credentials',
    });

    if (!compareSync(password, auth.password))
      throw new UnauthorizedException('Invalid credentials');

    if (!auth.isEmailConfirmed)
      throw new UnauthorizedException('Email not confirmed');

    const payload = { id: auth.id };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async recoverPassword(email: string) {
    const auth = await this.findByEmail(email);

    const token = this.jwtService.sign({ id: auth.id });
    const resetUrl = `${process.env.HOST}:${process.env.PORT}/api/auth/reset-password?token=${token}`;

    this.emailService.sendEmail(
      auth.email,
      'Recupera tu contraseña',
      'recover-password',
      { name: auth.email, url: resetUrl },
    );

    return { message: 'Check your email to reset your password.' };
  }

  async confirmEmail(token: string) {
    const { email } = this.jwtService.verify(token);
    const auth = await this.findByEmail(email);

    if (auth.isEmailConfirmed)
      throw new BadRequestException('Email already confirmed');

    auth.isEmailConfirmed = true;
    await this.authRepository.save(auth);
    return { message: `Email ${auth.email} confirmed successfully.` };
  }

  private handleErrors(error: any) {
    if (error.code === '23505') {
      throw new UnauthorizedException(error.detail);
    }

    throw new InternalServerErrorException(
      'Please check your server error log',
    );
  }
}
