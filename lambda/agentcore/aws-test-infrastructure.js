import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  waitUntilStackDeleteComplete,
} from '@aws-sdk/client-cloudformation';
import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

const MAX_CREATE_MINUTES = 10;

function clients(config, name) {
  const options = {
    region: config.region,
    credentials: fromTemporaryCredentials({
      clientConfig: { region: config.region },
      params: { RoleArn: config.roleArn, RoleSessionName: name, DurationSeconds: 900 },
    }),
  };
  return { stack: new CloudFormationClient(options), scheduler: new SchedulerClient(options) };
}

function hasTransform(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.entries(value).some(
      ([key, child]) => key === 'Transform' || key === 'Fn::Transform' || hasTransform(child),
    )
  );
}

export function validateTestTemplate(body) {
  if (Buffer.byteLength(body) > 51_200) throw new Error('Template exceeds 51,200 bytes');
  const template = JSON.parse(body);
  if (
    !template?.Resources ||
    Array.isArray(template.Resources) ||
    typeof template.Resources !== 'object' ||
    !Object.keys(template.Resources).length ||
    hasTransform(template)
  ) {
    throw new Error('Provide a JSON CloudFormation template with resources and no transforms');
  }
  for (const resource of Object.values(template.Resources)) {
    if (
      !resource ||
      !/^AWS::\w+::\w+$/.test(resource.Type ?? '') ||
      /^(AWS::(?:IAM|CloudFormation|Scheduler)::)/.test(resource.Type) ||
      (resource.DeletionPolicy && resource.DeletionPolicy !== 'Delete') ||
      (resource.UpdateReplacePolicy && resource.UpdateReplacePolicy !== 'Delete')
    ) {
      throw new Error(
        'Test stacks require native resources with deletion enabled. IAM, nested stacks and schedules are excluded.',
      );
    }
  }
}

export async function createTestStack(
  config,
  name,
  templateBody,
  { reserve, now = Date.now(), aws = clients(config, name) },
) {
  validateTestTemplate(templateBody);
  // Reserve before any AWS mutations. The bridge will clean up even if CreateStack
  // is accepted but its response is lost.
  await reserve();
  const expiration = new Date(now + 2 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const partition = config.roleArn.split(':')[1];
  await aws.scheduler.send(
    new CreateScheduleCommand({
      Name: name,
      ClientToken: name,
      ScheduleExpression: `at(${expiration})`,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: `arn:${partition}:scheduler:::aws-sdk:cloudformation:deleteStack`,
        RoleArn: config.cleanupRoleArn,
        Input: JSON.stringify({ StackName: name }),
        RetryPolicy: { MaximumEventAgeInSeconds: 86400, MaximumRetryAttempts: 185 },
      },
    }),
  );
  const created = await aws.stack.send(
    new CreateStackCommand({
      StackName: name,
      ClientRequestToken: name,
      TemplateBody: templateBody,
      TimeoutInMinutes: MAX_CREATE_MINUTES,
      OnFailure: 'DELETE',
      Tags: [{ Key: 'aidlc:purpose', Value: 'intent-test' }],
    }),
  );
  return { stackName: name, stackId: created.StackId, status: 'CREATE_REQUESTED' };
}

export async function describeTestStack(config, name, aws = clients(config, name)) {
  let result;
  try {
    result = await aws.stack.send(new DescribeStacksCommand({ StackName: name }));
  } catch (error) {
    if (!missingStack(error)) throw error;
    return { stackName: name, status: 'NOT_FOUND' };
  }
  return {
    stackName: name,
    status: result.Stacks?.[0]?.StackStatus ?? 'NOT_FOUND',
    outputs: (result.Stacks?.[0]?.Outputs ?? []).map(({ OutputKey, OutputValue }) => ({
      key: OutputKey,
      value: OutputValue,
    })),
  };
}

const missingStack = (error) =>
  error.name === 'ValidationError' && /does not exist/i.test(error.message);

export async function removeTestStack(
  config,
  name,
  { wait = true, aws = clients(config, name) } = {},
) {
  try {
    await aws.stack.send(new DeleteStackCommand({ StackName: name }));
  } catch (error) {
    if (!missingStack(error)) throw error;
    return;
  }
  if (!wait) return;
  await waitUntilStackDeleteComplete({ client: aws.stack, maxWaitTime: 300 }, { StackName: name });
}
