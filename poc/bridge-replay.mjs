const ABSOLUTE_CONTROL_EVENTS = new Set(["mixer.crossfader", "deck.level", "beatfx.depth"]);

export function isSafeBridgeReplay(message) {
  if (!["controller.control", "rekordbox.control"].includes(message?.type)) return true;
  const event = message.payload?.event ?? "";
  return ABSOLUTE_CONTROL_EVENTS.has(event) || event.startsWith("beatfx.select.") || event.startsWith("beatfx.target.");
}
