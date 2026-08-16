import type { GenesisRecord } from './types.ts';

/* ------------------------------------------------------------------ *
 * Append-only concept registry.                                       *
 *                                                                     *
 * There is no update, no delete, no mutable handle. Records are deep  *
 * frozen on append and readers hand back frozen views. Corrections    *
 * are appends carrying `supersedes`. Dead concepts stay, with their   *
 * cause of death — hiding a contradiction is a provenance violation.  *
 * ------------------------------------------------------------------ */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export class ConceptRegistry {
  readonly #records: GenesisRecord[] = [];
  readonly #byId = new Map<string, GenesisRecord>();

  append(record: GenesisRecord): GenesisRecord {
    const id = record?.identity?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('REGISTRY_APPEND_REJECTED: MISSING_ID');
    }
    if (this.#byId.has(id)) {
      throw new Error(`REGISTRY_APPEND_REJECTED: DUPLICATE_ID:${id}`);
    }
    if (!record.identity.lineage_hash) {
      throw new Error(`REGISTRY_APPEND_REJECTED: MISSING_LINEAGE_HASH:${id}`);
    }
    const frozen = deepFreeze(record);
    this.#records.push(frozen);
    this.#byId.set(id, frozen);
    return frozen;
  }

  get(id: string): GenesisRecord | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  size(): number {
    return this.#records.length;
  }

  /** Frozen view. Callers cannot splice, push, or reorder the ledger. */
  all(): readonly GenesisRecord[] {
    return Object.freeze(this.#records.slice());
  }

  dead(): readonly GenesisRecord[] {
    return Object.freeze(this.#records.filter((r) => r.status.formal === 'CONTRADICTORY'));
  }

  superseded(): readonly GenesisRecord[] {
    const ids = new Set(this.#records.map((r) => r.supersedes).filter(Boolean) as string[]);
    return Object.freeze(this.#records.filter((r) => ids.has(r.identity.id)));
  }

  /** Newline-delimited canonical JSON — the on-disk form is append-only too. */
  toJSONL(stringify: (v: unknown) => string): string {
    return this.#records.map((r) => stringify(r)).join('\n');
  }
}
