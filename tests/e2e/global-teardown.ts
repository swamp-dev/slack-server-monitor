import { stopE2EServer } from './e2e-server.js';

export default async function globalTeardown() {
  await stopE2EServer();
}
