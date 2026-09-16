const MIN_REPETITIONS = 1;
const MAX_REPETITIONS = 8;

let nextEntryId = 1;

function repetitions(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(MAX_REPETITIONS, Math.max(MIN_REPETITIONS, Number.isFinite(parsed) ? parsed : 1));
}

function entry(sceneId, repeat = 1, id = null) {
  const resolvedId = id || `scene-queue-${nextEntryId++}`;
  const numericSuffix = Number.parseInt(resolvedId.split("-").at(-1), 10);
  if (Number.isFinite(numericSuffix)) nextEntryId = Math.max(nextEntryId, numericSuffix + 1);
  return { id: resolvedId, sceneId, repetitions: repetitions(repeat) };
}

export class SceneQueue {
  constructor(sceneIds, savedState = null) {
    const allowed = new Set(sceneIds);
    const restoredItems = savedState?.items
      ?.filter((item) => allowed.has(item.sceneId))
      .map((item) => entry(item.sceneId, item.repetitions, item.id));
    this.items = restoredItems?.length ? restoredItems : sceneIds.map((sceneId) => entry(sceneId));
    this.cursorIndex = Math.min(Math.max(0, savedState?.cursorIndex ?? 0), Math.max(0, this.items.length - 1));
    this.used = Math.min(
      Math.max(0, savedState?.used ?? 0),
      Math.max(0, (this.items[this.cursorIndex]?.repetitions ?? 1) - 1),
    );
  }

  get next() {
    return this.items[this.cursorIndex] ?? null;
  }

  claim() {
    const current = this.next;
    if (!current) return null;
    const assignment = {
      itemId: current.id,
      sceneId: current.sceneId,
      occurrence: this.used + 1,
      repetitions: current.repetitions,
    };
    this.used += 1;
    if (this.used >= current.repetitions) {
      this.cursorIndex = (this.cursorIndex + 1) % this.items.length;
      this.used = 0;
    }
    return assignment;
  }

  add(sceneId, repeat = 1) {
    const created = entry(sceneId, repeat);
    this.items.push(created);
    return created;
  }

  remove(itemId) {
    if (this.items.length <= 1) return false;
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index < 0) return false;
    const currentId = this.next?.id;
    this.items.splice(index, 1);
    if (itemId === currentId) {
      this.cursorIndex = Math.min(index, this.items.length - 1);
      this.used = 0;
    } else {
      this.cursorIndex = Math.max(0, this.items.findIndex((item) => item.id === currentId));
    }
    return true;
  }

  move(itemId, targetIndex) {
    const fromIndex = this.items.findIndex((item) => item.id === itemId);
    if (fromIndex < 0) return false;
    const toIndex = Math.min(this.items.length - 1, Math.max(0, targetIndex));
    if (fromIndex === toIndex) return false;
    const currentId = this.next?.id;
    const [moved] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, moved);
    this.cursorIndex = Math.max(0, this.items.findIndex((item) => item.id === currentId));
    return true;
  }

  select(itemId) {
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index < 0) return false;
    this.cursorIndex = index;
    this.used = 0;
    return true;
  }

  usageFor(sceneId) {
    return this.items
      .filter((item) => item.sceneId === sceneId)
      .reduce((total, item) => total + item.repetitions, 0);
  }

  setScene(itemId, sceneId) {
    const target = this.items.find((item) => item.id === itemId);
    if (!target) return false;
    target.sceneId = sceneId;
    return true;
  }

  setRepetitions(itemId, value) {
    const target = this.items.find((item) => item.id === itemId);
    if (!target) return false;
    target.repetitions = repetitions(value);
    if (target.id === this.next?.id) this.used = Math.min(this.used, target.repetitions - 1);
    return true;
  }

  toJSON() {
    return {
      items: this.items.map((item) => ({ ...item })),
      cursorIndex: this.cursorIndex,
      used: this.used,
    };
  }
}

export function parseSavedSceneQueue(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed : null;
  } catch {
    return null;
  }
}
