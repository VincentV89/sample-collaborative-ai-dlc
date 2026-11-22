import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { removeTestStack } from './aws-test-infrastructure.js';
import { validAwsTestInfrastructure } from '../shared/aws-test-infrastructure-settings.js';

const stageContext = new AsyncLocalStorage();

export const AWS_TEST_STAGE_ID = 'aws-infrastructure-test';
export const currentAwsTestStage = () => stageContext.getStore();

async function cleanUpTestStacks(cleanups) {
  const results = await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  if (results.some((result) => result.status === 'rejected')) {
    throw Object.assign(
      new Error(
        'AWS test stack deletion could not be verified. Check the test account. The timed cleanup remains scheduled.',
      ),
      { code: 'aws_test_cleanup_unverified' },
    );
  }
}

export async function withAwsTestStage(payload, run) {
  const config = payload.awsTestInfrastructure;
  if (
    payload.stageId !== AWS_TEST_STAGE_ID ||
    !config ||
    !validAwsTestInfrastructure(config) ||
    config.projectId !== payload.projectId ||
    !payload.stageCallbackId
  )
    return run();

  const cleanups = [];
  const cleanup = () => cleanUpTestStacks(cleanups);
  try {
    return await stageContext.run(
      {
        config,
        cleanup,
        registerCleanup: (dispose) => cleanups.push(dispose),
      },
      run,
    );
  } finally {
    // Also cover failure, park and unexpected errors.
    await cleanup();
  }
}

export async function cleanupReservedStack(config, name, reservation) {
  try {
    await readFile(reservation);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await removeTestStack(config, name);
}
