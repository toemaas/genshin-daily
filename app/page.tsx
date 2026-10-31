"use client";

/**
 * The one game screen: prompt, countdown, input, result, final total.
 * Everything authoritative comes from the server as GameStateView; the page
 * never sees the accepted list. The countdown here is display only — the
 * server enforces the real deadline from prompt_serves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerApiResponse, GameStateView } from "../lib/api-types.ts";

type Notice =
  | { kind: "accepted"; answer: string; typo: boolean; points: number }
  | { kind: "rejected"; message: string }
  | { kind: "timeout" };

const POINT_STYLES: Record<number, string> = {
  0: "bg-slate-800 text-slate-400",
  10: "bg-slate-600 text-white",
  30: "bg-emerald-700 text-white",
  60: "bg-sky-600 text-white",
  85: "bg-violet-600 text-white",
  100: "bg-amber-400 text-slate-950",
};

function pointStyle(points: number): string {
  return POINT_STYLES[points] ?? POINT_STYLES[0];
}

export default function Home() {
  const [state, setState] = useState<GameStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** This browser's clock, null with no prompt open. */
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutSentFor = useRef<number | null>(null);

  // The countdown starts from when each response arrives, so a device clock
  // that is minutes off still shows the right time left.
  const show = useCallback((next: GameStateView) => {
    const arrived = Date.now();
    setState(next);
    setNow(arrived);
    setDeadlineAt(next.current ? arrived + next.current.msLeft : null);
  }, []);

  useEffect(() => {
    fetch("/api/puzzle")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: GameStateView) => show(data))
      .catch((cause: Error) => setError(`Could not load today's puzzle (${cause.message})`));
  }, [show]);

  // Display clock, 5 ticks a second while a prompt is open.
  useEffect(() => {
    if (!state?.current) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [state?.current]);

  const submit = useCallback(
    async (typed: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const response = await fetch("/api/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: typed }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: AnswerApiResponse = await response.json();
        show(data.state);
        if (data.accepted) {
          setNotice({ kind: "accepted", answer: data.answer, typo: data.typo, points: data.points });
          setText("");
        } else if (data.reason === "timeout") {
          setNotice({ kind: "timeout" });
          setText("");
        } else if (data.reason !== "done") {
          setNotice({ kind: "rejected", message: data.message });
          inputRef.current?.select();
        }
      } catch (cause) {
        setNotice({ kind: "rejected", message: `Could not reach the server (${(cause as Error).message})` });
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, show],
  );

  // When the local clock runs out, one empty POST lets the server record the timeout.
  // It waits for an answer still in flight, which the server may yet accept inside its grace.
  const currentIndex = state?.current?.index;
  const timeUp = deadlineAt !== null && now >= deadlineAt;
  useEffect(() => {
    if (!timeUp || busy || currentIndex === undefined || timeoutSentFor.current === currentIndex) return;
    timeoutSentFor.current = currentIndex;
    void submit("");
  }, [timeUp, busy, currentIndex, submit]);

  // The input is disabled at 0 and loses focus, so take it back when the next prompt opens.
  useEffect(() => {
    if (!timeUp) inputRef.current?.focus();
  }, [timeUp, currentIndex]);

  // Streak lives only in this browser.
  useEffect(() => {
    if (!state || state.current || state.results.length < state.promptCount) return;
    try {
      const raw = localStorage.getItem("streak");
      const previous = raw ? (JSON.parse(raw) as { date: string; streak: number }) : null;
      if (previous?.date === state.date) {
        setStreak(previous.streak);
        return;
      }
      const yesterday = new Date(Date.parse(state.date) - 86_400_000).toISOString().slice(0, 10);
      const next = previous?.date === yesterday ? previous.streak + 1 : 1;
      localStorage.setItem("streak", JSON.stringify({ date: state.date, streak: next }));
      setStreak(next);
    } catch {
      // Blocked storage only loses the streak display.
    }
  }, [state]);

  if (error) return <p className="pt-20 text-center text-rose-400">{error}</p>;
  if (!state) return <p className="pt-20 text-center text-slate-400">Loading…</p>;

  const secondsLeft = deadlineAt !== null ? Math.max(0, Math.ceil((deadlineAt - now) / 1000)) : 0;
  const fraction = deadlineAt !== null ? Math.max(0, Math.min(1, (deadlineAt - now) / (state.promptSeconds * 1000))) : 0;

  return (
    <div className="flex flex-col gap-6 pt-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Teyvat Daily</h1>
        <span className="text-sm text-slate-400">{state.date}</span>
      </header>

      <ol className="flex gap-1.5" aria-label="progress">
        {Array.from({ length: state.promptCount }, (_, i) => {
          const result = state.results[i];
          const active = state.current?.index === i;
          return (
            <li
              key={i}
              className={`flex h-8 flex-1 items-center justify-center rounded text-xs font-semibold ${
                result ? pointStyle(result.points) : active ? "bg-slate-700 text-slate-200 ring-1 ring-slate-400" : "bg-slate-900 text-slate-600"
              }`}
            >
              {result ? result.points : i + 1}
            </li>
          );
        })}
      </ol>

      {state.current ? (
        <section className="flex flex-col gap-4">
          <div className="h-1.5 overflow-hidden rounded bg-slate-800">
            <div
              className={`h-full rounded transition-[width] duration-200 ease-linear ${secondsLeft <= 5 ? "bg-rose-500" : "bg-sky-500"}`}
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">{state.current.prompt}</h2>
            <span className={`text-xl font-bold tabular-nums ${secondsLeft <= 5 ? "text-rose-400" : "text-slate-300"}`}>{secondsLeft}</span>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) void submit(text);
            }}
          >
            <input
              ref={inputRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
              disabled={timeUp}
              placeholder={timeUp ? "Time's up" : "Type your answer…"}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none placeholder:text-slate-600 focus:border-sky-500 disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={busy || timeUp || !text.trim()}
              className="rounded-lg bg-sky-600 px-5 font-semibold text-white disabled:opacity-40"
            >
              Go
            </button>
          </form>
          <NoticeLine notice={notice} />
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Done for today</h2>
          <ul className="flex flex-col gap-2">
            {state.results.map((result) => (
              <li key={result.index} className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3">
                <div>
                  <p className="text-sm text-slate-400">{result.prompt}</p>
                  <p className="font-medium">{result.answer ?? "Ran out of time"}</p>
                </div>
                <span className={`rounded px-2 py-1 text-sm font-bold ${pointStyle(result.points)}`}>{result.points}</span>
              </li>
            ))}
          </ul>
          <p className="text-center text-xl">
            Total <span className="font-bold text-amber-300">{state.total}</span>
            {streak !== null && <span className="ml-3 text-sm text-slate-400">🔥 {streak}-day streak</span>}
          </p>
          <p className="text-center text-sm text-slate-500">Come back tomorrow for seven new prompts.</p>
        </section>
      )}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return <p className="h-6" />;
  if (notice.kind === "accepted") {
    return (
      <p className="h-6 text-emerald-400">
        Counted as <span className="font-semibold">{notice.answer}</span>
        {notice.typo && " (typo fixed)"} — {notice.points} pts
      </p>
    );
  }
  if (notice.kind === "timeout") return <p className="h-6 text-rose-400">Time&apos;s up — 0 pts</p>;
  return <p className="h-6 text-amber-400">{notice.message}</p>;
}
