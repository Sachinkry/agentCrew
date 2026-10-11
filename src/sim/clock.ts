// Seeded clock — provides the current simulated day. No Date.now() in sim code.

let _simDay = 1;

export function getCurrentDay(): number {
  return _simDay;
}

export function advanceDay(): number {
  _simDay++;
  return _simDay;
}

export function resetClock(): void {
  _simDay = 1;
}

export function setDay(day: number): void {
  _simDay = day;
}
