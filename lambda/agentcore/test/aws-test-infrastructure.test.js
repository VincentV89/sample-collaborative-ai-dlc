import { describe, expect, it, vi } from 'vitest';
import { createTestStack, validateTestTemplate } from '../aws-test-infrastructure.js';
import { withAwsTestStage, currentAwsTestStage } from '../aws-test-infrastructure-session.js';

const config = {
  projectId: 'space-a',
  region: 'us-east-1',
  roleArn: 'arn:aws:iam::123456789012:role/test-deploy',
  cleanupRoleArn: 'arn:aws:iam::123456789012:role/test-cleanup',
};
const template = JSON.stringify({ Resources: { Test: { Type: 'AWS::SQS::Queue' } } });

describe('AWS test infrastructure', () => {
  it('refuses resources that CloudFormation would retain during teardown', () => {
    expect(() => validateTestTemplate(template)).not.toThrow();
    expect(() =>
      validateTestTemplate(
        JSON.stringify({
          Resources: { Test: { Type: 'AWS::SQS::Queue', DeletionPolicy: 'Retain' } },
        }),
      ),
    ).toThrow('deletion enabled');
  });

  it('does not create resources unless the independent cleanup schedule is accepted', async () => {
    const reserve = vi.fn();
    const stack = { send: vi.fn() };
    const scheduler = { send: vi.fn().mockRejectedValue(new Error('denied')) };
    await expect(
      createTestStack(config, 'aidlc-test-example', template, {
        reserve,
        aws: { stack, scheduler },
        now: 0,
      }),
    ).rejects.toThrow('denied');
    expect(reserve).toHaveBeenCalledOnce();
    expect(stack.send).not.toHaveBeenCalled();
    expect(scheduler.send.mock.calls[0][0].input.Target).toMatchObject({
      RoleArn: config.cleanupRoleArn,
      Input: JSON.stringify({ StackName: 'aidlc-test-example' }),
    });
  });

  const payload = {
    awsTestInfrastructure: config,
    stageId: 'aws-infrastructure-test',
    projectId: 'space-a',
    stageCallbackId: 'callback',
  };

  it('withholds the role from other stages and spaces', async () => {
    for (const override of [{ stageId: 'code-generation' }, { projectId: 'space-b' }]) {
      await withAwsTestStage({ ...payload, ...override }, () =>
        expect(currentAwsTestStage()).toBeUndefined(),
      );
    }
  });

  it('awaits teardown for a parked stage and surfaces teardown failures', async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error('DELETE_FAILED'));
    await expect(
      withAwsTestStage(payload, () => {
        currentAwsTestStage().registerCleanup(cleanup);
        return { state: 'PARKED' };
      }),
    ).rejects.toMatchObject({ code: 'aws_test_cleanup_unverified' });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
