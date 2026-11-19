import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { INDEXES, ensureIndexes } from "../src/db/indexes.js";
import { testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.$disconnect());

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

describe("indexes", () => {
  it("every @unique / @@unique in schema.prisma has a matching (non-partial) unique index", () => {
    const missing: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const collection = model.dbName ?? model.name;
      const dbName = (field: string) => model.fields.find((f) => f.name === field)?.dbName ?? field;
      const uniques = [
        ...model.fields.filter((f) => f.isUnique && !f.isId).map((f) => [f.name]),
        ...model.uniqueFields.map((u) => [...u]),
      ];
      for (const fields of uniques) {
        const keys = fields.map(dbName);
        const found = INDEXES.some(
          (ix) =>
            ix.collection === collection &&
            ix.unique === true &&
            !ix.partialFilterExpression &&
            sameKeys(Object.keys(ix.key), keys),
        );
        if (!found) missing.push(`${collection}(${keys.join(",")})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every index targets a real collection and real fields", () => {
    const bad: string[] = [];
    for (const ix of INDEXES) {
      const model = Prisma.dmmf.datamodel.models.find((m) => (m.dbName ?? m.name) === ix.collection);
      if (!model) {
        bad.push(`unknown collection ${ix.collection}`);
        continue;
      }
      const fields = new Set(model.fields.map((f) => f.dbName ?? f.name));
      for (const k of Object.keys(ix.key)) if (!fields.has(k)) bad.push(`${ix.collection}.${k}`);
    }
    expect(bad).toEqual([]);
  });

  it("index names are unique per collection", () => {
    const names = INDEXES.map((ix) => `${ix.collection}/${ix.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ensureIndexes is idempotent", async () => {
    await expect(ensureIndexes(db)).resolves.toBeUndefined();
    await expect(ensureIndexes(db)).resolves.toBeUndefined();
  });
});
