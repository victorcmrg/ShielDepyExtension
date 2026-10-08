import { createApp } from './app';

createApp().listen(Number(process.env.PORT ?? 3000));
