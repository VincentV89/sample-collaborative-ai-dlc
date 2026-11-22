import { GetParameterCommand } from '@aws-sdk/client-ssm';

export const awsTestInfrastructureParameter = (prefix) => `${prefix}/aws-test-infrastructure`;
const role = /^arn:(aws(?:-us-gov|-cn)?):iam::(\d{12}):role\/[\w+=,.@/-]+$/;

export function validAwsTestInfrastructure(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { projectId, roleArn, cleanupRoleArn, region } = value;
  if (![projectId, roleArn, cleanupRoleArn, region].every((item) => typeof item === 'string'))
    return false;
  const identity = roleArn.match(role);
  const cleanup = cleanupRoleArn.match(role);
  return (
    Object.keys(value).length === 4 &&
    /^[\w-]{1,128}$/.test(projectId) &&
    /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region) &&
    !!identity &&
    !!cleanup &&
    roleArn !== cleanupRoleArn &&
    identity[1] === cleanup[1] &&
    identity[2] === cleanup[2]
  );
}

export function parseAwsTestInfrastructure(text) {
  if (text === undefined) return null;
  const value = JSON.parse(text);
  if (!validAwsTestInfrastructure(value))
    throw new Error('Invalid AWS test infrastructure settings');
  return value;
}

export async function readAwsTestInfrastructure(ssm, prefix) {
  if (!prefix) return null;
  try {
    const result = await ssm.send(
      new GetParameterCommand({
        Name: awsTestInfrastructureParameter(prefix),
      }),
    );
    return parseAwsTestInfrastructure(result?.Parameter?.Value);
  } catch (error) {
    if (error.name === 'ParameterNotFound') return null;
    throw error;
  }
}
