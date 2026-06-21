# Running AidLockIn on real Aurora DSQL

The OCC race-demo hero feature is only fully real on Aurora DSQL — on plain
Postgres the loser is resolved by row locks, never the `40001` commit-time
conflict + connector retry that makes the demo's "exactly one winner" story
true (see `lib/db.ts`). Use this to point the app at a live DSQL cluster.

This step needs the AWS CLI and AWS credentials, which are interactive and
account-specific — it can't be automated from inside the repo. Steps:

## 1. Install + authenticate the AWS CLI

```bash
brew install awscli           # macOS
aws configure                 # enter access key, secret, default region
aws sts get-caller-identity   # confirm you're authenticated
```

## 2. Create an Aurora DSQL cluster

Console: **Aurora DSQL → Create cluster** (single-region is fine for the
demo). Or CLI:

```bash
aws dsql create-cluster --region us-east-1
# note the identifier, then fetch the endpoint:
aws dsql get-cluster --identifier <cluster-id> --region us-east-1
```

The endpoint looks like `<cluster-id>.dsql.us-east-1.on.aws`.

## 3. Configure the app

```bash
cp .env.example .env.local
```

Fill the DSQL block in `.env.local`:

```
DSQL_ENDPOINT=<cluster-id>.dsql.us-east-1.on.aws
PGUSER=admin
PGDATABASE=postgres
PGPORT=5432
AWS_REGION=us-east-1
```

No DB password — the connector signs short-lived IAM tokens from your AWS
credential chain.

## 4. Migrate, seed, run

```bash
npm install
npm run db:migrate   # creates tables; CREATE INDEX ASYNC + sys.wait_for_job
npm run db:seed      # Typhoon Nari demo event
npm run dev          # http://localhost:3000
```

`db:migrate` should pause while DSQL builds each secondary index
asynchronously, then exit clean — that pause is expected (`scripts/migrate.ts`
polls `sys.wait_for_job`).

## 5. Verify the hero path

1. Click through all pages — they should show seeded data.
2. Open **/race-demo** and run it 5×. Each run: exactly one station APPROVED,
   one DENIED_RESOURCE_TAKEN. On DSQL the loser hits `40001` and is retried by
   the connector before its clean denial — this is the behavior that does NOT
   occur on plain Postgres.
3. **/pools** → restock a pool, drain one below 25% → low-stock alert appears
   on /dashboard.
4. **/reports** → repeat duplicate-claim patterns surface for households denied
   more than once.

## 6. Run the test suite against a throwaway DB

The hero-guarantee tests (`tests/`) create and tear down their own rows. Point
them at a **separate** migrated database (a second DSQL cluster, or local
Postgres for speed) so they never touch demo data:

```bash
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aidlockin_test' > .env.test
npm run db:migrate   # against that DB (set DATABASE_URL in shell first)
npm test
```

Without any DB configured, `npm test` skips every test cleanly rather than
failing.
