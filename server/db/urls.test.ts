import { describe, expect, it } from "vitest";
import { deriveMigrationsUrl } from "./urls";

describe("deriveMigrationsUrl", () => {
  it("strips Neon's -pooler suffix", () => {
    expect(deriveMigrationsUrl("postgresql://u:p%40ss@ep-spring-poetry-b79y534k-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require")).toBe(
      "postgresql://u:p%40ss@ep-spring-poetry-b79y534k.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require",
    );
  });
  it("switches Supabase's transaction pooler port to session mode", () => {
    expect(deriveMigrationsUrl("postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")).toBe(
      "postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    );
  });
  it("leaves other URLs alone", () => {
    expect(deriveMigrationsUrl("pglite://.data/dev")).toBe("pglite://.data/dev");
    expect(deriveMigrationsUrl("postgresql://u:p@db.example.com:5432/app")).toBe("postgresql://u:p@db.example.com:5432/app");
    expect(deriveMigrationsUrl("")).toBe("");
  });
});
