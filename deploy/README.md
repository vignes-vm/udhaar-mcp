# Deploying Udhaar to AWS App Runner

This deploys the Docker image built from the repo `Dockerfile` to [AWS App
Runner](https://docs.aws.amazon.com/apprunner/) via Amazon ECR. The Dockerfile
has been built and smoke-tested locally (`docker build`, non-root user, `npm
ci`, `/health` responds, `/mcp` responds).

None of the commands below have been run against your AWS account. Review
each one before running it yourself — several create billable resources.

## 0. Prerequisites

- AWS CLI v2 configured (`aws configure` or `AWS_PROFILE`) with an account
  that has ECR + App Runner + IAM permissions.
- Docker running locally.
- Bedrock model access already enabled (see the main README's Bedrock setup
  section) if you want `record_from_speech` / `collection_plan` to use the
  `bedrock` engine in production.

Set these once in your shell:

```bash
export AWS_REGION=ap-south-1        # pick your region
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=udhaar-mcp
```

## 1. Push the image to ECR

```bash
# Create the repository (one-time)
aws ecr create-repository --repository-name "$ECR_REPO" --region "$AWS_REGION"

# Build for linux/amd64 (App Runner runs on amd64)
docker build --platform linux/amd64 -t "$ECR_REPO:latest" .

# Authenticate Docker to ECR
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Tag and push
docker tag "$ECR_REPO:latest" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest"
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest"
```

## 2. Create the IAM role App Runner's instances use at runtime

This is the role the *running container* assumes, used only for the
`bedrock:InvokeModel` call — scope it to the exact model/inference-profile
you're using, nothing broader.

`deploy/apprunner-instance-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

`deploy/apprunner-bedrock-policy.json` (replace `BEDROCK_MODEL_ID` with the
exact ID or inference-profile ARN from your `.env`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:*::foundation-model/BEDROCK_MODEL_ID"
    }
  ]
}
```

```bash
aws iam create-role \
  --role-name udhaar-apprunner-instance-role \
  --assume-role-policy-document file://deploy/apprunner-instance-trust-policy.json

aws iam put-role-policy \
  --role-name udhaar-apprunner-instance-role \
  --policy-name udhaar-bedrock-invoke \
  --policy-document file://deploy/apprunner-bedrock-policy.json
```

## 3. Create the App Runner service

Via console (simplest for a hackathon demo): App Runner → **Create service** →
**Container registry** → **Amazon ECR** → pick the `udhaar-mcp:latest` image →
**Deployment trigger: Manual** (so pushing new images doesn't auto-redeploy
mid-demo) → configure:

- **Port**: `3000`
- **Environment variables**:
  - `UDHAAR_API_KEY` = a strong random value (generate with `openssl rand -hex 32`)
  - `AWS_REGION` = same region as above
  - `BEDROCK_MODEL_ID` = your model/inference-profile ID
- **Instance role**: `udhaar-apprunner-instance-role` (from step 2)
- **Health check path**: `/health`

Or via CLI:

```bash
aws apprunner create-service \
  --service-name udhaar-mcp \
  --source-configuration "{
    \"ImageRepository\": {
      \"ImageIdentifier\": \"$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest\",
      \"ImageRepositoryType\": \"ECR\",
      \"ImageConfiguration\": {
        \"Port\": \"3000\",
        \"RuntimeEnvironmentVariables\": {
          \"AWS_REGION\": \"$AWS_REGION\",
          \"BEDROCK_MODEL_ID\": \"<your-model-id>\"
        },
        \"RuntimeEnvironmentSecrets\": {
          \"UDHAAR_API_KEY\": \"arn:aws:secretsmanager:...\"
        }
      }
    },
    \"AutoDeploymentsEnabled\": false
  }" \
  --instance-configuration "InstanceRoleArn=arn:aws:iam::$AWS_ACCOUNT_ID:role/udhaar-apprunner-instance-role" \
  --health-check-configuration "Protocol=HTTP,Path=/health"
```

(Putting `UDHAAR_API_KEY` in Secrets Manager and referencing it via
`RuntimeEnvironmentSecrets` keeps it out of the App Runner service
configuration's plaintext env list; a plain `RuntimeEnvironmentVariables`
entry works too for a quick demo, it's just visible in the console/CLI output
to anyone with describe-service access.)

App Runner gives you a public URL like
`https://xxxxxxxx.ap-south-1.awsapprunner.com`.

## 4. Verify

```bash
curl https://<your-service-url>/health

curl -X POST https://<your-service-url>/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $UDHAAR_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

MCP_URL="https://<your-service-url>/mcp" UDHAAR_API_KEY="..." npm test
```

## Persisting the ledger

`UDHAAR_DATA_FILE=/data/ledger.json` (set in the Dockerfile) writes to the
container's local filesystem. **App Runner containers are ephemeral** — a
redeploy, scale-out, or restart loses this data. That's fine for a hackathon
demo (reset = redeploy), but not for anything real.

### Swapping to DynamoDB (optional, not implemented)

To make the ledger durable, `src/ledger.ts` would change its storage layer
only — the exported functions (`addEntry`, `balanceOf`, `listDues`,
`summaryForDay`) and their signatures stay the same, so `server.ts` and every
MCP tool need no changes. Roughly:

- One table, partition key `customer` (normalized key), sort key `entryId`
  for ledger entries; a second item per customer (e.g. sort key `#meta`)
  storing `displayName`.
- `addEntry` → `PutItem`.
- `balanceOf` → `Query` by partition key, sum client-side (or maintain a
  running balance attribute updated via `UpdateItem` with an atomic counter
  to avoid summing on every read).
- `listDues` → requires a secondary access pattern (e.g. a GSI on
  `balance > 0`, or just `Scan` + filter for a small shop's customer count).
- Credentials: same AWS SDK credential chain already used for Bedrock: add
  `dynamodb:PutItem`, `dynamodb:Query`, `dynamodb:Scan` on the table's ARN to
  the instance role from step 2.

## Cost note

- **App Runner**: billed per vCPU-second and GB-second while running, plus a
  small provisioned-concurrency minimum even at zero traffic. The smallest
  instance size (0.25 vCPU / 0.5 GB) for a few hours of demo/judging is
  low-single-digit-dollars.
- **Bedrock**: billed per input/output token on the Converse calls
  (`record_from_speech`, `collection_plan`). A hackathon demo's worth of
  calls is a trivial fraction of a dollar; check current per-model pricing at
  https://aws.amazon.com/bedrock/pricing/.
- **ECR**: storage for one small image, a few cents a month at most.

### Shutting everything down after the hackathon

```bash
aws apprunner delete-service --service-arn <service-arn-from-create-service-output>
aws ecr batch-delete-image --repository-name "$ECR_REPO" --image-ids imageTag=latest
aws ecr delete-repository --repository-name "$ECR_REPO" --force
aws iam delete-role-policy --role-name udhaar-apprunner-instance-role --policy-name udhaar-bedrock-invoke
aws iam delete-role --role-name udhaar-apprunner-instance-role
docker rmi "$ECR_REPO:latest" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest"
```

Bedrock model access itself has no standing cost to revoke — you're only
billed for calls actually made.
