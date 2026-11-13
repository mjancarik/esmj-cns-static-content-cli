import { run } from 'jest';

if (process.env.NODE_ENV == null) process.env.NODE_ENV = 'test';
await run();
