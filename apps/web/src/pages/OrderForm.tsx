import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDot, MapPin, MessageSquare, Phone, Star, User, Users, Zap, Clock } from "lucide-react";
import { MAX_PASSENGERS, type OrderDto, type RouteDto } from "@taxi/shared";
import { ApiError, newIdempotencyKey, nextQuarterHour, tashkentInstant } from "@taxi/web-core";
import { api, useApp, type Prefill } from "../core";
import { Page } from "../components";
import { Button, Card, Field, Segmented, Stepper, cx, inputClass, toast } from "../ui";

export function OrderForm({ routeId, prefill }: { routeId: string; prefill?: Prefill | undefined }) {
  const { me, t, city, reset, push, errorText } = useApp();
  const qc = useQueryClient();
  const routes = useQuery({ queryKey: ["routes"], queryFn: () => api.get<RouteDto[]>("/routes") });
  const route = routes.data?.find((r) => r.id === routeId);

  const [pickup, setPickup] = useState(prefill?.pickup ?? "");
  const [dropoff, setDropoff] = useState(prefill?.dropoff ?? "");
  const [passengers, setPassengers] = useState(prefill?.passengers ?? 1);
  const [timeMode, setTimeMode] = useState<"now" | "pick">("now");
  const [day, setDay] = useState<0 | 1>(0);
  const [time, setTime] = useState(nextQuarterHour());
  const [comment, setComment] = useState(prefill?.comment ?? "");
  const [name, setName] = useState(me.firstName ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [saveFav, setSaveFav] = useState(false);
  const [touched, setTouched] = useState(false);
  // One key per form instance: double taps / retries never create two orders.
  const idempotencyKey = useRef(newIdempotencyKey()).current;

  const errors = useMemo(
    () => ({
      pickup: pickup.trim().length < 2 ? " " : undefined,
      dropoff: dropoff.trim().length < 2 ? " " : undefined,
      name: name.trim().length < 1 ? " " : undefined,
    }),
    [pickup, dropoff, name],
  );
  const valid = !errors.pickup && !errors.dropoff && !errors.name;

  const submit = useMutation({
    mutationFn: async () => {
      const order = await api.post<OrderDto>("/orders", {
        routeId,
        pickup: pickup.trim(),
        dropoff: dropoff.trim(),
        passengers,
        isNow: timeMode === "now",
        ...(timeMode === "pick" ? { departureAt: tashkentInstant(day, time) } : {}),
        comment: comment.trim() || undefined,
        contactName: name.trim(),
        contactPhone: phone.trim() && phone.trim() !== me.phone ? phone.trim() : undefined,
        idempotencyKey,
      });
      if (saveFav) {
        await api.post("/favorites", { routeId, pickup: pickup.trim(), dropoff: dropoff.trim() }).catch((e: unknown) => {
          if (!(e instanceof ApiError && e.code === "favorite_exists")) throw e;
        });
      }
      return order;
    },
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["favorites"] });
      reset({ name: "home" });
      push({ name: "order", id: order.id });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Page title={t.newOrder} subtitle={route ? `${city(route.fromCity)} → ${city(route.toCity)}` : " "}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) submit.mutate();
        }}
        className="space-y-4"
      >
        <Card className="space-y-3">
          <Field icon={<CircleDot className="size-5" />} error={touched ? errors.pickup : undefined}>
            <input
              className={inputClass}
              placeholder={`${t.from}: ${t.pickupPlaceholder}`}
              value={pickup}
              maxLength={200}
              onChange={(e) => setPickup(e.target.value)}
            />
          </Field>
          <Field icon={<MapPin className="size-5 text-brand-strong" />} error={touched ? errors.dropoff : undefined}>
            <input
              className={inputClass}
              placeholder={`${t.to}: ${t.dropoffPlaceholder}`}
              value={dropoff}
              maxLength={200}
              onChange={(e) => setDropoff(e.target.value)}
            />
          </Field>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-surface-2">
                <Users className="size-5" />
              </span>
              <div className="font-semibold">{t.passengers}</div>
            </div>
            <Stepper value={passengers} min={1} max={MAX_PASSENGERS} onChange={setPassengers} />
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="px-1 text-[13px] font-medium text-muted">{t.time}</div>
          <Segmented
            value={timeMode}
            onChange={setTimeMode}
            options={[
              { value: "now", label: <><Zap className="size-4" /> {t.now}</> },
              { value: "pick", label: <><Clock className="size-4" /> {t.pickTime}</> },
            ]}
          />
          {timeMode === "pick" && (
            <div className="grid grid-cols-2 gap-3 animate-rise">
              <Segmented
                value={String(day) as "0" | "1"}
                onChange={(v) => setDay(Number(v) as 0 | 1)}
                options={[
                  { value: "0", label: t.today },
                  { value: "1", label: t.tomorrow },
                ]}
              />
              <input
                type="time"
                value={time}
                step={300}
                onChange={(e) => setTime(e.target.value)}
                className="h-[52px] rounded-2xl bg-surface-2 px-4 text-center text-lg font-bold tabular-nums text-ink outline-none"
              />
            </div>
          )}
        </Card>

        <Field label={t.comment} icon={<MessageSquare className="size-5" />}>
          <input className={inputClass} placeholder={t.commentPlaceholder} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
        </Field>

        <Card className="space-y-3">
          <div className="px-1 text-[13px] font-medium text-muted">{t.contact}</div>
          <Field icon={<User className="size-5" />} error={touched ? errors.name : undefined}>
            <input className={inputClass} placeholder={t.name} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field icon={<Phone className="size-5" />}>
            <input className={inputClass} type="tel" inputMode="tel" placeholder="+998 90 123 45 67" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </Card>

        <button
          type="button"
          onClick={() => setSaveFav((v) => !v)}
          className={cx(
            "flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[15px] font-medium transition",
            saveFav ? "border-brand bg-brand/10" : "border-line bg-surface",
          )}
        >
          <Star className={cx("size-5", saveFav ? "fill-brand text-brand-strong" : "text-muted")} />
          {t.saveFavorite}
        </button>

        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-bg/90 px-4 pt-3 backdrop-blur-xl">
          <div className="mx-auto max-w-lg">
            <Button type="submit" block loading={submit.isPending} disabled={!route}>
              {submit.isPending ? t.sending : t.submitOrder}
            </Button>
          </div>
        </div>
      </form>
    </Page>
  );
}
