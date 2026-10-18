import type { Page } from '@cassandra-orm/core';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Message } from './message.entity.js';
import { MessagesService } from './messages.service.js';

interface MessageInput {
  author?: string;
  body?: string;
}

@Controller('rooms/:roomId/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  post(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() input: MessageInput,
  ): Promise<Message> {
    if (!input.author || !input.body) {
      throw new BadRequestException('author and body are required');
    }
    return this.messages.post(roomId, input.author, input.body);
  }

  /** Newest first. Pass the returned pageState back to get the next page. */
  @Get()
  list(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('pageState') pageState?: string,
  ): Promise<Page<Message>> {
    return this.messages.list(roomId, pageState);
  }

  @Patch(':messageId')
  @HttpCode(204)
  edit(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() input: MessageInput,
  ): Promise<void> {
    if (!input.body) throw new BadRequestException('body is required');
    return this.messages.edit(roomId, messageId, input.body);
  }

  @Delete(':messageId')
  @HttpCode(204)
  remove(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.messages.remove(roomId, messageId);
  }
}
