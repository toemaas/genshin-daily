/**
 * Shapes the API routes send to the page. Types only, imported by both sides.
 * Nothing here may carry answer ids or the accepted list.
 */

export interface ResultView {
  index: number;
  prompt: string;
  /** The accepted answer's display name, or null on a timeout. */
  answer: string | null;
  points: number;
}

export interface CurrentPromptView {
  index: number;
  prompt: string;
  /**
   * Ms left on the server's clock when it built this view, 0 once past the
   * deadline. The client counts down from when the response arrives, so its
   * own clock's offset never matters.
   */
  msLeft: number;
}

export interface GameStateView {
  date: string;
  promptCount: number;
  promptSeconds: number;
  total: number;
  /** Finished prompts, in order. */
  results: ResultView[];
  /** Null once the day is finished. */
  current: CurrentPromptView | null;
}

export type AnswerApiResponse =
  | { accepted: true; answer: string; typo: boolean; points: number; state: GameStateView }
  | {
      accepted: false;
      reason: "ambiguous" | "off-prompt" | "unknown" | "timeout" | "done";
      message: string;
      state: GameStateView;
    };
