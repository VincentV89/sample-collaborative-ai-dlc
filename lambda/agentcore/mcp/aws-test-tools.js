import { writeFile } from 'node:fs/promises';
import { createTestStack, describeTestStack, removeTestStack } from '../aws-test-infrastructure.js';
import { validAwsTestInfrastructure } from '../../shared/aws-test-infrastructure-settings.js';

// These values come from the host-side bridge, never an MCP tool argument.
export function registerAwsTestTools(server, z, env) {
  if (!env.AIDLC_AWS_TEST_CONFIG) return;
  const config = JSON.parse(env.AIDLC_AWS_TEST_CONFIG);
  const name = env.AIDLC_AWS_TEST_STACK;
  const reservation = env.AIDLC_AWS_TEST_RESERVATION;
  if (!validAwsTestInfrastructure(config) || !config || !name || !reservation) return;

  server.registerTool(
    'provision_aws_test_stack',
    {
      description:
        'Create the temporary AWS CloudFormation test stack. Provide a JSON template and call aws_test_stack_status until CREATE_COMPLETE to get its outputs. The runtime deletes the stack when this stage session ends.',
      inputSchema: { template: z.string() },
    },
    async ({ template }) => {
      try {
        const result = await createTestStack(config, name, template, {
          reserve: () => writeFile(reservation, '', { flag: 'wx', mode: 0o600 }),
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        const reason =
          error.code === 'EEXIST'
            ? 'This session already requested a stack. Retry the stage to provision a new one.'
            : `Stack provisioning failed (${error.name}). Check CloudFormation and Scheduler in the test account.`;
        return { isError: true, content: [{ type: 'text', text: reason }] };
      }
    },
  );

  server.registerTool(
    'aws_test_stack_status',
    {
      description:
        'Read the test stack status and its CloudFormation outputs. Start live testing only after CREATE_COMPLETE.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await describeTestStack(config, name);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Could not read test stack status.' }],
        };
      }
    },
  );

  server.registerTool(
    'delete_aws_test_stack',
    {
      description:
        'Request deletion of the temporary AWS test stack after testing. The runtime verifies cleanup before the stage result is returned.',
      inputSchema: {},
    },
    async () => {
      try {
        await removeTestStack(config, name, { wait: false });
        return { content: [{ type: 'text', text: 'Test stack deletion requested.' }] };
      } catch {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Could not verify test stack deletion.' }],
        };
      }
    },
  );
}
