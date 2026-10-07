import type { LoopEvent, SceneProject, VisualLoop } from "./types";

const beatsFromMusical = (value: { bars?: number; beats?: number }) => (value.bars ?? 0) * 4 + (value.beats ?? 0);

export type EventPlacement = { at: number; duration: number; lane: number };

export function laneOf(event: LoopEvent): number {
  return Number.isInteger(event.lane) && Number(event.lane) >= 0 ? Number(event.lane) : 0;
}

export function overlaps(first: EventPlacement, second: EventPlacement): boolean {
  return first.lane === second.lane &&
    first.at < second.at + second.duration - 0.0001 &&
    second.at < first.at + first.duration - 0.0001;
}

export function canPlaceEvent(events: LoopEvent[], eventId: string | null, placement: EventPlacement): boolean {
  if (!Number.isInteger(placement.lane) || placement.lane < 0 || placement.at < 0 || placement.duration <= 0) return false;
  return events.every((event) => event.id === eventId || !overlaps(placement, {
    at: beatsFromMusical(event.at),
    duration: beatsFromMusical(event.duration),
    lane: laneOf(event),
  }));
}

export function firstAvailableLane(events: LoopEvent[], at: number, duration: number): number {
  let lane = 0;
  while (!canPlaceEvent(events, null, { at, duration, lane })) lane += 1;
  return lane;
}

export function normalizeProjectLanes(project: SceneProject): SceneProject {
  const normalized = structuredClone(project);
  for (const loop of normalized.visualLoops) {
    const placed: LoopEvent[] = [];
    for (const event of loop.events) {
      const at = beatsFromMusical(event.at);
      const duration = beatsFromMusical(event.duration);
      const intendedLane = laneOf(event);
      event.lane = event.lane !== undefined && canPlaceEvent(placed, null, { at, duration, lane: intendedLane })
        ? intendedLane
        : firstAvailableLane(placed, at, duration);
      placed.push(event);
    }
  }
  return normalized;
}

export function eventPlacement(event: LoopEvent): EventPlacement {
  return { at: beatsFromMusical(event.at), duration: beatsFromMusical(event.duration), lane: laneOf(event) };
}

export function canPlaceWithinLoop(loop: VisualLoop, eventId: string | null, placement: EventPlacement): boolean {
  const length = beatsFromMusical(loop.length);
  return placement.at + placement.duration <= length + 0.0001 &&
    canPlaceEvent(loop.events, eventId, placement);
}
