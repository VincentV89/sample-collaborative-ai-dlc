import { randomUUID } from 'node:crypto';
import {
  cleanupReservedStack,
  currentAwsTestStage,
  AWS_TEST_STAGE_ID,
} from '../aws-test-infrastructure-session.js';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INFERENCE_CREDENTIAL_ENV } from '../cli/environment.js';
import { CREDENTIAL_ADAPTER_ENV_NAMES } from '../credential-material-registry.js';

// The CLI only speaks MCP over an invocation-scoped socket. The runtime starts
// the actual server with its application identity and immutable trusted scope.
// Same-UID processes are not a host sandbox; this boundary prevents accidental
// credential forwarding, not arbitrary hostile native code on the host.
export const createRuntimeMcpBridge = async ({
  entry,
  trustedEnv,
  runtimeEnv = process.env,
  spawnFn = spawn,
}) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidlc-mcp-'));
  await chmod(directory, 0o700);
  const socketPath = path.join(directory, 'bridge.sock');
  const children = new Set();
  const sockets = new Set();
  // Provider-controlled names are dropped from ambient env only: the trusted scope (its
  // AWS_REGION included) is runtime-owned and must reach the server as built.
  const ambient = { ...runtimeEnv };
  for (const key of CREDENTIAL_ADAPTER_ENV_NAMES) delete ambient[key];
  const serverEnv = { ...ambient, ...trustedEnv };
  const testStage = currentAwsTestStage();
  const name = `aidlc-test-${randomUUID()}`;
  const reservation = path.join(directory, 'aws-test-stack');
  const testConfig =
    testStage &&
    trustedEnv.V2_STAGE_ID === AWS_TEST_STAGE_ID &&
    trustedEnv.V2_MCP_ROLE === 'author' &&
    trustedEnv.V2_MCP_MODE === 'stage' &&
    trustedEnv.V2_CHECKPOINT_OWNER !== '0' &&
    trustedEnv.V2_DESCRIBE_CHANGES === '1'
      ? testStage.config
      : null;
  delete serverEnv.AIDLC_AWS_TEST_CONFIG;
  delete serverEnv.AIDLC_AWS_TEST_STACK;
  delete serverEnv.AIDLC_AWS_TEST_RESERVATION;
  if (testConfig) {
    serverEnv.AIDLC_AWS_TEST_CONFIG = JSON.stringify(testConfig);
    serverEnv.AIDLC_AWS_TEST_STACK = name;
    serverEnv.AIDLC_AWS_TEST_RESERVATION = reservation;
  }

  for (const key of INFERENCE_CREDENTIAL_ENV) delete serverEnv[key];
  const server = createServer((socket) => {
    sockets.add(socket);
    let child;
    try {
      child = spawnFn(process.execPath, [entry], {
        env: serverEnv,
        shell: false,
        stdio: ['pipe', 'pipe', 'inherit'],
      });
    } catch {
      socket.destroy();
      return;
    }
    children.add(child);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    socket.on('error', () => socket.destroy());
    child.stdin.on('error', () => socket.destroy());
    child.stdout.on('error', () => socket.destroy());
    child.on('error', () => socket.destroy());
    child.on('close', () => {
      children.delete(child);
      socket.destroy();
    });
    socket.on('close', () => {
      sockets.delete(socket);
      child.kill('SIGTERM');
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let disposed = false;
  const bridge = {
    socketPath,
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const socket of sockets) socket.destroy();
      for (const child of children) child.kill('SIGKILL');
      await new Promise((resolve) => server.close(resolve));
      try {
        if (testConfig) await cleanupReservedStack(testConfig, name, reservation);
      } catch (error) {
        console.error(
          `[aws-test-infrastructure] Could not verify deletion of ${name} (${error.name})`,
        );
        throw error;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
  if (testConfig) testStage.registerCleanup(() => bridge.dispose());
  return bridge;
};
