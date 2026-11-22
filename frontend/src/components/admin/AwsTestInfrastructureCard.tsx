import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { agentsService, type AwsTestInfrastructure } from '@/services/agents';

const empty = { projectId: '', roleArn: '', cleanupRoleArn: '', region: '' };
const fields = [
  ['projectId', 'Space ID'],
  ['region', 'AWS region'],
  ['roleArn', 'Test deployment role ARN'],
  ['cleanupRoleArn', 'Scheduled cleanup role ARN'],
] as const;

export function AwsTestInfrastructureCard() {
  const [form, setForm] = useState<AwsTestInfrastructure>(empty);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    agentsService.getSettings().then(
      (settings) => {
        if (cancelled) return;
        setForm(settings.awsTestInfrastructure ?? empty);
        setReady(true);
      },
      () => {
        if (!cancelled) setError('Could not load AWS test infrastructure settings.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(value: AwsTestInfrastructure | null) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await agentsService.updateSettings({ awsTestInfrastructure: value });
      setForm(value ?? empty);
      setMessage(value ? 'Saved for new intents in this space.' : 'Disabled for new intents.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save AWS test infrastructure settings.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          projectId: form.projectId.trim(),
          roleArn: form.roleArn.trim(),
          cleanupRoleArn: form.cleanupRoleArn.trim(),
          region: form.region.trim(),
        });
      }}
    >
      <h3 className="font-semibold">AWS test infrastructure</h3>
      <p className="text-sm text-muted-foreground">
        Connect a test AWS account for the aws-infrastructure-test workflow stage. The stage can
        provision a temporary CloudFormation stack and deletes it when the stage session ends.
      </p>
      <fieldset disabled={!ready || saving} className="space-y-3">
        {fields.map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`aws-test-${key}`}>{label}</Label>
            <Input
              id={`aws-test-${key}`}
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              required
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button type="submit">Save connection</Button>
          <Button type="button" variant="outline" onClick={() => void save(null)}>
            Disable for new intents
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
