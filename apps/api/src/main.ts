import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });
  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  console.log(`MagicClaw API listening on http://localhost:${port}`);

  return app;
}
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
