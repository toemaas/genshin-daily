/**
 * GET /api/puzzle — today's state for this player: finished results, the current
 * prompt with its server-side deadline, and nothing about the accepted answers.
 * Sets the anonymous player cookie on first visit.
 */
import { NextRequest, NextResponse } from "next/server";
import { gameStateFor, PLAYER_COOKIE, validPlayerId } from "../../../lib/server/game.ts";

export function GET(request: NextRequest) {
  const existing = validPlayerId(request.cookies.get(PLAYER_COOKIE)?.value);
  const playerId = existing ?? crypto.randomUUID();
  const response = NextResponse.json(gameStateFor(playerId));
  if (!existing) {
    response.cookies.set(PLAYER_COOKIE, playerId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 400,
      path: "/",
    });
  }
  return response;
}
