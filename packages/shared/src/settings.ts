import { z } from "zod";

// Admin-editable settings (stored in the `settings` collection, one document per key).
export const SettingsSchema = z.object({
  "loyalty.pointsPerTrip": z.number().int().min(0).max(10000),
  "loyalty.pointsPerVoucher": z.number().int().min(1).max(1000000),
  "loyalty.voucherPercent": z.number().int().min(1).max(100),
  "loyalty.maxEarningTripsPerDay": z.number().int().min(0).max(100),
  "referral.bonusPoints": z.number().int().min(0).max(100000),
  "orders.unacceptedAlertMinutes": z.number().int().min(1).max(1440),
  "support.contact": z.string().trim().max(100),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  "loyalty.pointsPerTrip": 10,
  "loyalty.pointsPerVoucher": 100,
  "loyalty.voucherPercent": 10,
  "loyalty.maxEarningTripsPerDay": 2,
  "referral.bonusPoints": 20,
  "orders.unacceptedAlertMinutes": 15,
  "support.contact": "",
};

export const SettingsUpdateInput = SettingsSchema.partial();
