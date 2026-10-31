/**
 * POST /api/answer { text } — one attempt at the player's current prompt.
 * Only a matched answer is accepted and advances; a rejection returns a message
 * and leaves everything unchanged. Empty text past the deadline records the timeout.
 */
import { NextRequest, NextResponse } from "next/server";
import { PLAYER_COOKIE, submitAnswer, validPlayerId } from "../../../lib/server/game.ts";

export async function POST(request: NextRequest) {
  const playerId = validPlayerId(request.cookies.get(PLAYER_COOKIE)?.value);
  if (!playerId) {
    return NextResponse.json({ error: "No player cookie. Load the puzzle first." }, { status: 400 });
  }
  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { text }" }, { status: 400 });
  }
  if (typeof text !== "string" || text.length > 100) {
    return NextResponse.json({ error: "text must be a string of at most 100 characters" }, { status: 400 });
  }
  return NextResponse.json(submitAnswer(playerId, text));
}
