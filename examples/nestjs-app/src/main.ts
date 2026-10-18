import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
// Lets CassandraModule close the driver cleanly on SIGTERM / Ctrl+C.
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3000);
console.log(`Listening on ${await app.getUrl()}`);
