// Loads the same env files the app uses so tests talk to a real database.
// Point them at a throwaway DB (a local Postgres or a dedicated Aurora DSQL
// test cluster) that has had `npm run db:migrate` applied. Tests that need a
// database skip themselves cleanly when none is configured — see tests/db.ts.
import { config } from "dotenv";

config({ path: ".env.test" });
config({ path: ".env.local" });
