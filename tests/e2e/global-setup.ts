import { startE2EServer } from './e2e-server.js';

export default async function globalSetup() {
  await startE2EServer();
}
