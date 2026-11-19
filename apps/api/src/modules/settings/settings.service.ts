import type { PrismaClient } from "@prisma/client";
import { SETTING_DEFAULTS, SettingsSchema, type Settings } from "@taxi/shared";

export async function getSettings(db: PrismaClient): Promise<Settings> {
  const rows = await db.setting.findMany();
  const merged: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS) merged[r.key] = r.value;
  // Fall back to defaults for any value that became invalid.
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : SETTING_DEFAULTS;
}

export async function updateSettings(db: PrismaClient, patch: Partial<Settings>, actorId: string): Promise<Settings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db.setting.upsert({
      where: { key },
      update: { value, updatedById: actorId },
      create: { key, value, updatedById: actorId },
    });
  }
  await db.auditLog.create({ data: { actorId, action: "settings.update", entityType: "settings", data: patch } });
  return getSettings(db);
}
