import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { AiSources } from "../ai/components/ai-feedback";
import { nutritionApi, streamTarget } from "./api";
import { RunStatus, Stepper } from "./parts";
import {
  ACTIVITIES,
  kcal,
  type ProfileFields,
  type TargetProposal,
} from "./types";
import { useNutritionRun } from "./use-nutrition-run";

const STEPS = ["About you", "How you move", "Your goal", "Your target"];
const BLANK: ProfileFields = {
  age: 30,
  sex: "unspecified",
  height_cm: 170,
  weight_kg: 70,
  activity: "light",
  goal: "",
  pace: "standard",
  pregnant: false,
  read_training: true,
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="nutrition-segmented" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="nutrition-number">
      <span>{label}</span>
      <span>
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <small>{unit}</small>
      </span>
    </label>
  );
}

/** First-time setup, and Recalculate later: S01's four steps ending in the proposed target. */
export function NutritionSetup({
  initial,
  onDone,
  onCancel,
}: {
  initial: ProfileFields | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<ProfileFields>(initial ?? BLANK);
  const change = (values: Partial<ProfileFields>) =>
    setProfile((before) => ({ ...before, ...values }));
  const training = useQuery({
    queryKey: ["nutrition", "training"],
    queryFn: nutritionApi.training,
    enabled: step === 1 && profile.read_training,
  });
  const run = useNutritionRun<TargetProposal>();
  const [edits, setEdits] = useState<Partial<TargetProposal>>({});
  const ask = (fields = profile) => {
    setEdits({});
    void run.start((onEvent, signal) => streamTarget(fields, onEvent, signal));
  };
  useEffect(() => {
    if (step === 3 && run.stage === "idle") ask();
    // Asks once when the last step opens; Change my answers resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const proposal = run.output ? { ...run.output, ...edits } : null;
  const accept = useMutation({
    mutationFn: () =>
      nutritionApi.acceptTarget({
        kcal: proposal!.kcal,
        protein: proposal!.protein,
        carbs: proposal!.carbs,
        fat: proposal!.fat,
        explanation: proposal!.explanation,
        sources: run.sources,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["nutrition"] });
      toast.success("Target saved from today");
      onDone();
    },
  });
  const valid =
    profile.age >= 13 &&
    profile.age <= 110 &&
    profile.height_cm >= 100 &&
    profile.height_cm <= 250 &&
    profile.weight_kg >= 30 &&
    profile.weight_kg <= 300;

  /** Carbs follow calories, protein and fat, so the four always add up. */
  const adjust = (key: "kcal" | "protein" | "carbs" | "fat", value: number) => {
    if (!proposal) return;
    const next = { ...proposal, [key]: Math.max(0, value) };
    if (key === "carbs")
      next.kcal = next.protein * 4 + next.carbs * 4 + next.fat * 9;
    else
      next.carbs = Math.max(
        0,
        Math.round((next.kcal - next.protein * 4 - next.fat * 9) / 4 / 5) * 5,
      );
    if (next.kcal < proposal.lowest) {
      toast(proposal.reason);
      return;
    }
    if (next.kcal > proposal.highest) {
      toast(`Noted keeps targets at or under ${kcal(proposal.highest)} kcal.`);
      return;
    }
    setEdits({
      kcal: next.kcal,
      protein: next.protein,
      carbs: next.carbs,
      fat: next.fat,
    });
  };

  return (
    <div className="nutrition-setup">
      <div className="setup-card">
        <ol className="setup-steps">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={
                index === step ? "current" : index < step ? "done" : ""
              }
            >
              <span>{index < step ? <Check size={12} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <h2>{STEPS[step]}</h2>
        {step === 0 && (
          <div className="setup-fields">
            <NumberField
              label="Age"
              unit="years"
              value={profile.age}
              min={13}
              max={110}
              onChange={(age) => change({ age })}
            />
            <div className="nutrition-number">
              <span>Sex, for the formula</span>
              <Segmented
                label="Sex"
                value={profile.sex}
                options={[
                  ["male", "Male"],
                  ["female", "Female"],
                  ["unspecified", "Prefer not to say"],
                ]}
                onChange={(sex) => change({ sex })}
              />
            </div>
            <NumberField
              label="Height"
              unit="cm"
              value={profile.height_cm}
              min={100}
              max={250}
              onChange={(height_cm) => change({ height_cm })}
            />
            <NumberField
              label="Weight"
              unit="kg"
              value={profile.weight_kg}
              min={30}
              max={300}
              step={0.1}
              onChange={(weight_kg) => change({ weight_kg })}
            />
          </div>
        )}
        {step === 1 && (
          <>
            <div
              className="setup-activities"
              role="radiogroup"
              aria-label="Activity level"
            >
              {ACTIVITIES.map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={profile.activity === key}
                  onClick={() => change({ activity: key })}
                >
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
            <section className="setup-training">
              <header>
                <span>
                  <Clock size={15} />
                  <strong>From your tracked time</strong>
                  <small>Last 28 days</small>
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={profile.read_training}
                    onChange={(event) =>
                      change({ read_training: event.target.checked })
                    }
                  />
                  Use it
                </label>
              </header>
              {profile.read_training ? (
                training.data &&
                (training.data.activities.length ||
                  training.data.habits.length) ? (
                  <ul>
                    {training.data.activities.map((item) => (
                      <li key={item.name}>
                        <span>{item.name}</span>
                        <small>
                          {item.days} day{item.days === 1 ? "" : "s"} · about{" "}
                          {item.average_minutes} min
                        </small>
                      </li>
                    ))}
                    {training.data.habits.map((name) => (
                      <li key={`habit-${name}`}>
                        <span>{name}</span>
                        <small>Habit</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small>
                    {training.isPending
                      ? "Reading your tracked time…"
                      : "Nothing tracked in the last 28 days."}
                  </small>
                )
              ) : (
                <small>Only the level you pick is used.</small>
              )}
              {profile.read_training && (
                <small>
                  The AI checks this against the level you pick, and says if
                  another fits better.
                </small>
              )}
            </section>
          </>
        )}
        {step === 2 && (
          <div className="setup-fields single">
            <label className="nutrition-goal">
              <span>What do you want?</span>
              <textarea
                rows={2}
                maxLength={300}
                value={profile.goal}
                placeholder="Lose fat, gain muscle, eat more protein, keep my weight…"
                onChange={(event) => change({ goal: event.target.value })}
              />
              <small>In your own words.</small>
            </label>
            <div className="nutrition-number">
              <span>Pace</span>
              <Segmented
                label="Pace"
                value={profile.pace}
                options={[
                  ["gentle", "Gentle"],
                  ["standard", "Standard"],
                ]}
                onChange={(pace) => change({ pace })}
              />
            </div>
            <label className="nutrition-check">
              <input
                type="checkbox"
                checked={profile.pregnant}
                onChange={(event) => change({ pregnant: event.target.checked })}
              />
              Pregnant or breastfeeding
              <small>
                Noted won't suggest eating less while this is ticked.
              </small>
            </label>
          </div>
        )}
        {step === 3 && (
          <div className="setup-result">
            {run.stage === "error" ? (
              <Notice tone="error">
                {run.error}
                <Button variant="ghost" size="small" onClick={() => ask()}>
                  Try again
                </Button>
                {run.code === "limit" ||
                run.code === "auth" ||
                run.code === "model" ? (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() =>
                      window.dispatchEvent(new Event("noted:ai-settings"))
                    }
                  >
                    Open AI settings
                  </Button>
                ) : null}
              </Notice>
            ) : !proposal ? (
              <RunStatus run={run} thinking="Working out your target" />
            ) : (
              <section className="target-proposal">
                <RunStatus run={run} />
                <div className="target-math">
                  <div>
                    <span className="eyebrow">Maintenance</span>
                    <strong>{kcal(proposal.maintenance)} kcal</strong>
                    <small>
                      {kcal(proposal.resting)} resting × {proposal.factor}{" "}
                      {ACTIVITIES.find(
                        ([key]) => key === profile.activity,
                      )?.[1].toLowerCase()}
                    </small>
                  </div>
                  <div className="chosen">
                    <span className="eyebrow">Target</span>
                    <strong>{kcal(proposal.kcal)} kcal</strong>
                    <small>
                      {String(
                        Math.round(
                          (((proposal.kcal - proposal.maintenance) * 7) /
                            7700) *
                            100,
                        ) / 100,
                      ).replace("-", "−")}{" "}
                      kg a week
                      {proposal.kcal < proposal.maintenance &&
                        ` · ${Math.round((1 - proposal.kcal / proposal.maintenance) * 100)}% under`}
                    </small>
                  </div>
                </div>
                <div className="target-steppers">
                  <Stepper
                    label="Calories"
                    unit="kcal a day"
                    value={proposal.kcal}
                    step={50}
                    onChange={(value) => adjust("kcal", value)}
                  />
                  <Stepper
                    label="Protein"
                    unit="g"
                    value={proposal.protein}
                    step={5}
                    onChange={(value) => adjust("protein", value)}
                  />
                  <Stepper
                    label="Carbs"
                    unit="g"
                    value={proposal.carbs}
                    step={5}
                    onChange={(value) => adjust("carbs", value)}
                  />
                  <Stepper
                    label="Fat"
                    unit="g"
                    value={proposal.fat}
                    step={5}
                    onChange={(value) => adjust("fat", value)}
                  />
                </div>
                <p className="target-why">{proposal.explanation}</p>
                {proposal.activity !== profile.activity && (
                  <div className="target-activity">
                    <Sparkles size={14} />
                    <span>
                      From your tracked time,{" "}
                      <strong>
                        {
                          ACTIVITIES.find(
                            ([key]) => key === proposal.activity,
                          )?.[1]
                        }
                      </strong>{" "}
                      may fit better than{" "}
                      {
                        ACTIVITIES.find(
                          ([key]) => key === profile.activity,
                        )?.[1]
                      }
                      .
                    </span>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        const next = {
                          ...profile,
                          activity: proposal.activity,
                        };
                        setProfile(next);
                        ask(next);
                      }}
                    >
                      Use it
                    </Button>
                  </div>
                )}
                <AiSources sources={run.sources} />
                <p className="target-floor">
                  {proposal.reason} Not medical advice.
                </p>
                {accept.error && (
                  <Notice tone="error">{accept.error.message}</Notice>
                )}
              </section>
            )}
          </div>
        )}
        <footer className="setup-actions">
          {step > 0 && step < 3 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ChevronLeft size={14} />
              Back
            </Button>
          )}
          {step === 3 && (
            <Button
              variant="ghost"
              onClick={() => {
                run.cancel();
                setStep(0);
              }}
            >
              <ChevronLeft size={14} />
              Change my answers
            </Button>
          )}
          {step === 0 && onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <span className="spacer" />
          {step < 3 ? (
            <Button disabled={!valid} onClick={() => setStep(step + 1)}>
              {step === 2 ? (
                <>
                  <Sparkles size={14} />
                  Work out my target
                </>
              ) : (
                "Next"
              )}
            </Button>
          ) : (
            <Button
              disabled={!proposal || accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? "Saving…" : "Use this target"}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
