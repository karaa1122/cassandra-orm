import type { Page, Repository } from '@cassandra-orm/core';
import { InjectRepository } from '@cassandra-orm/nestjs';
import { Injectable, NotFoundException } from '@nestjs/common';
import { types } from 'cassandra-driver';
import { Message } from './message.entity.js';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
  ) {}

  async post(roomId: string, author: string, body: string): Promise<Message> {
    const message = Object.assign(new Message(), {
      roomId,
      messageId: types.TimeUuid.now().toString(),
      author,
      body,
      sentAt: new Date(),
    });
    await this.messages.insert(message);
    return message;
  }

  list(roomId: string, pageState?: string): Promise<Page<Message>> {
    return this.messages.findPage({ roomId }, { pageSize: 20, pageState });
  }

  async edit(roomId: string, messageId: string, body: string): Promise<void> {
    // ifExists turns this into a lightweight transaction, so a deleted
    // message is not silently resurrected by the update.
    const { applied } = await this.messages.update(
      { roomId, messageId },
      { body },
      { ifExists: true },
    );
    if (!applied) throw new NotFoundException('Message not found');
  }

  async remove(roomId: string, messageId: string): Promise<void> {
    await this.messages.delete({ roomId, messageId });
  }
}
