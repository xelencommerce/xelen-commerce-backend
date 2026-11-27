import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import { Configuration } from './config/environment.js';
async function main() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  configureApplication(app);
  await app.listen(app.get(Configuration).values.PORT, app.get(Configuration).values.HOST);
}
void main().catch(() => {
  process.stderr.write(
    'Backend startup failed. Check validated environment, database permissions and migrations.\n',
  );
  process.exitCode = 1;
});
