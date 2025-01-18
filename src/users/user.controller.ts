import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UserService } from './services/user.service';
import { User } from './entities/user.entity';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async createUser(@Body() user: User): Promise<void> {
    await this.userService.createUser(user);
  }

  @Get()
  async getAllUsers(): Promise<User[]> {
    return this.userService.getAllUsers(1, 1);
  }

  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<User | null> {
    return this.userService.findUserById(id);
  }
}
