import { buildApp } from './app';

buildApp().listen({ port: Number(process.env.PORT ?? 3000) });
