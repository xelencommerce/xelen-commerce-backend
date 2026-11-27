import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
const app = await NestFactory.create(AppModule, { bodyParser: false, logger: false });
try {
  const document = configureApplication(app);
  if (!document) throw new Error('Generate documentation in development with DOCS_ENABLED=true.');
  await mkdir('docs', { recursive: true });
  await writeFile('docs/openapi.json', JSON.stringify(document, null, 2) + '\n');
  console.log('Generated docs/openapi.json.');
} finally {
  await app.close();
}
