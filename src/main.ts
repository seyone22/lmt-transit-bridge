import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import http from 'http';
import https from 'https';
import axios from 'axios';

axios.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`LMT Transit Bridge Service running on port: ${port}`);
}
bootstrap();
