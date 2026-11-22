# Platform Settings

The **Admin** page holds all platform-wide settings: users, agents, source control, and issue trackers. It is visible in the sidebar only to members of the Cognito **`platform-admin`** group (see [Setup](../getting-started/setup.md#bootstrap-the-first-platform-administrator) for bootstrapping the first admin); every underlying API is independently gated on the same group.

The page is organized into five tabs.

A read-only **Deployment** strip sits above the tabs, showing the canonical application URL, environment, and region. The hostname it reports is the one the backend puts in its OAuth redirect URIs, so it is what every provider's callback URL must match. If you are browsing a hostname other than the canonical one — a deployment with a custom domain still answers on the CloudFront domain and on every alias — the strip says so, because the callback URLs shown further down deliberately use the canonical hostname rather than the one in the address bar.

The hostname itself is not editable here. It is set by the `app_domain` Terraform variable, and changing it needs a certificate, a CloudFront update, and a frontend rebuild. See [Setup → Custom domain](../getting-started/setup.md#custom-domain).

## Users

**User Management** — grant or revoke the platform-admin role for local Cognito
users. Changes apply at the user's next sign-in. Self-demotion is blocked, so
an installation cannot remove its current local administrator by accident.
Federated users show their identity provider and effective mapped roles, but
their role control is read-only because the external IdP is authoritative. See
[Enterprise SSO](../getting-started/enterprise-sso.md#role-and-access-mapping).

Day-to-day space access is _not_ managed here — it lives in each space's [Members tab](projects.md#members).

## Agents

Everything the agent runtime needs to run:

The **General** tab contains the settings below. **Sandboxing** provides the
platform-wide SRT toggle and JSON policy editor; see [Agent sandboxing](agent-sandboxing.md).

- **Platform Agent Credentials** — fallback **Bedrock Bearer Token** (used by Claude Code, OpenCode, and Codex) and **Kiro API Key** values. Platform admins manage these SecureString parameters; a personal or space credential takes precedence. See [Credential hierarchy](#credential-hierarchy) and [Prerequisites → Agent authentication](../getting-started/prerequisites.md#agent-authentication).
- **Agent CLIs** — enable or disable each agent CLI (Kiro, Claude Code, OpenCode, Codex) for the whole platform. A disabled CLI is greyed out on the intent compose page and in **Space Settings → Agent**, and the API rejects selecting it (`agent_cli_disabled`) when an intent starts, when you compose a draft with AI, or when a draft discussion assist runs. At least one CLI must stay enabled. Intents that already started on a CLI keep using it after it is disabled. All CLIs are enabled by default. Operators can pre-seed the set for a new deployment with the `disabled_clis` Terraform variable. Terraform applies that value only on first creation; after that, this switch owns it. A default model (including the `codex_model` Terraform default) only pins which model a CLI uses; it does not enable the CLI.
- **Default Models** — the platform-wide default model per CLI (Kiro, Claude Code, OpenCode, Codex), selected from a dropdown of models discovered from the runtime (or "No default — use CLI built-in"). Codex uses Bedrock's OpenAI models with exact `openai.*` IDs (e.g. `openai.gpt-5.5`) — the chosen model must be available in the deployment Region. With no Codex default, runs use `openai.gpt-6.1-sol`, the default of the pinned Codex CLI. Spaces can override these per-CLI in [Space Settings → Agent](projects.md#agent).
- **Graph Enrichment** — a switch controlling whether the platform adds LLM-generated summaries to derived artifacts in the knowledge graph (`llm` or `off`). The setting takes effect for the _next_ intent, never mid-run; enrichment spend is metered and surfaced on each intent's Audit page.

### Credential hierarchy

Bedrock and Kiro credentials are resolved independently with this precedence:

```text
personal > space > platform
```

- Users manage personal credentials in **Account Settings**.
- Space owners and admins manage shared credentials in **Space Settings → Agent**.
- Platform admins manage fallback credentials in **Admin → Agents**.

The APIs return configured state and the effective source, never secret values. When a user selects a CLI for draft AI composition, a Quorum discussion assist, or intent start, the backend resolves that user's effective credential and sends only an opaque binding to AgentCore. AgentCore reads the bound SecureString for each invocation rather than retaining secrets in the long-lived process environment.

Starting an intent pins the selected CLI and credential binding for the run's lifetime. Rotating the value at that same scope takes effect on the next invocation; clearing or invalidating it fails the run instead of falling through to another scope.

Before a key is saved or cleared, the server checks which work already uses it. If nothing that has already started is affected, the change is saved straight away and the card says what it now means. Otherwise the card asks you to confirm and names, in plain words, the work that would lose access, needs reconnecting, or could not be checked, with **Show details** for the specifics. The server rejects the save if work or configuration changed after that check; save again to repeat it.

There is no intent-level credential store in this feature. An intent binds to one of the three managed scopes above but never owns a separate API key. Dedicated per-intent secrets would require a separate lifecycle and authorization design.

## Environments

The environment area contains two administrator views:

- **Environments** — compose exact published tool versions over a protected
  base, build and scan the resulting ARM64 image, validate its AgentCore
  runtime, and publish it for space assignment.
- **Tools** — import, verify, publish, and recommend immutable tool versions.
  Java, Go, Rust, Maven, and Gradle are shipped as tool definitions rather than
  predefined environments. Administrators can add other tools such as .NET.

Only Standard is published as a system environment. Existing intents remain
pinned to their exact environment revision when assignments, bases, or
recommended tool versions change.

See [Managed tools and environments](managed-environments.md) for the complete
administrator workflow: adding a tool, source provenance, build verification,
security review, publication and recommendation, environment composition and
updates, space assignment, and intent pinning.

## Source Control

Platform-wide code-host configuration:

- **GitHub** — GitHub OAuth app status and GitHub App identity/private-key configuration are shown simultaneously. Spaces choose OAuth or App independently; there is no global mode or installation ID. See [Git integration → Space-bound authentication](git-integration.md#space-bound-authentication).
- **GitLab** — the GitLab OAuth app credentials.
- **AWS CodeCommit** — one shared connection for the whole deployment: the IAM role ARN and region every space uses. The card shows the platform principals, the deployment external ID, and the trust and permissions policies to hand to the AWS admin who owns the repositories; paste the role ARN and region and click **Test & save** to verify the trust and store the connection. Spaces then pick CodeCommit repositories from the usual list, with no ARN or IAM to supply. There is no per-user external ID. See [Git integration → CodeCommit](git-integration.md#codecommit) and [Setup → CodeCommit](../getting-started/setup.md#codecommit-code-host).
- **Default PR strategy** — **Intent PR** opens only the final intent-to-base review; **PR per unit** also opens draft unit-to-intent reviews and integrates them in dependency order. Spaces may inherit or override this default. The default is **Intent PR**.

## Trackers

Issue-tracker OAuth apps and data migrations:

- **Jira Cloud** — the Atlassian OAuth 2.0 integration credentials.
- **Source-control trackers** — configuration status of GitHub Issues and GitLab Issues (these reuse the Source Control OAuth apps).
- **Tracker Migration** — the one-time bulk migration for installs with pre-#194 data; shows a live count of legacy records and a **Migrate all** action. See [Git integration → Migrating from legacy issue integration](git-integration.md#migrating-from-legacy-issue-integration).

Until a provider shows **Configured** here, its **Connect** buttons across the product stay disabled with a hint pointing back to this page.

## Related operator surfaces

Not everything operator-facing lives on the Admin page:

- **Workflow and block authoring** — the [Workflows](workflows.md) area, also gated on `platform-admin`.
- **Infrastructure-level settings** — the upstream methodology pin (`aidlc_repo_ref`), the custom domain (`app_domain`), and the rest of the deployment configuration live in Terraform; see [Setup](../getting-started/setup.md).

## AWS test infrastructure

Platform admins can configure one optional connection under **Admin → Agents → AWS test infrastructure**. Select a space by its ID and provide a test AWS region, a deployment role ARN and a scheduled cleanup role ARN. Both roles belong to the test account. New intents in that space capture the connection at creation. Removing it from the console affects new intents. To revoke access for existing intents, revoke the deployment role trust or remove it from the Terraform allowlist after cleaning up any active stacks.

Before saving the connection, add the exact deployment role ARN to the platform Terraform input `aws_test_role_arns` and apply the platform update. Configure the roles as follows:

| Role              | Trust and permissions                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test deployment   | Trust the platform's AgentCore runtime role. Permit CloudFormation create, describe and delete for `aidlc-test-*` stacks in the target region, plus the underlying resource operations needed by the test templates. Permit `scheduler:CreateSchedule` for `schedule/default/aidlc-test-*` in that region and `iam:PassRole` for the cleanup role with `iam:PassedToService` limited to `scheduler.amazonaws.com`. |
| Scheduled cleanup | Trust EventBridge Scheduler, restricted to the test account and its default schedule group. Permit CloudFormation deletion of `aidlc-test-*` stacks in the target region and the underlying resource deletion operations.                                                                                                                                                                                          |

Use an isolated AWS account and restrict both roles to the resources needed by the test. The roles cannot be provisioned by the test template itself.

In **Workflows → Blocks**, create a stage with ID `aws-infrastructure-test` and add it after integration in the desired workflow. Instruct the stage to call `provision_aws_test_stack` with a JSON CloudFormation template, poll `aws_test_stack_status` until `CREATE_COMPLETE`, exercise the deployed service using its stack outputs, call `delete_aws_test_stack`, and provide the actual test results. If the tool is unavailable or provisioning fails, record live tests as unverified. Choose a stage artifact and review policy to fit the workflow.

Each lead stage session can request one stack. The tool accepts inline JSON templates up to 51,200 bytes. The tool excludes IAM resources, nested stacks, custom resources, Scheduler resources and retain policies. The runtime uses short-lived IAM credentials internally. Agents receive stack outputs through the tool and can use those outputs to test the application without AWS CLI credentials.

The runtime verifies deletion before the stage result is returned, including when the agent parks or fails. Run provisioning and testing in the same session. A resumed session needs a fresh stack. Before creating a stack, the tool registers an EventBridge schedule to request deletion after two hours if the runtime stops unexpectedly. The scheduled request does not verify that asynchronous deletion completed. Investigate `DELETE_FAILED` in CloudFormation, especially for resources that require application-specific cleanup such as non-empty buckets. The stage fails if its normal deletion check cannot confirm cleanup.
