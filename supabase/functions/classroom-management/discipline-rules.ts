export type DisciplineActorRole = "teacher" | "deputy";

export interface DisciplineHistoryRecord {
  id: number;
  record_type: string;
}

export interface DisciplineScoreBatch {
  sourceRecordIds: number[];
  targetScore: "continuous" | "discipline";
  delta: -1 | 1;
  disciplineCount: number;
  praiseCount: number;
}

export function isSchoolManagerRole(role: unknown): boolean {
  const value = String(role ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim().toLowerCase();
  const exact = ["manager", "school_manager", "مدیر", "مدیر مدرسه", "مدیریت", "مدیریت مدرسه"];
  return exact.includes(value) || value.startsWith("مدیر ");
}

export function buildDisciplineScoreBatches(
  history: DisciplineHistoryRecord[],
  insertedRecordIds: number[],
  actorRole: DisciplineActorRole,
): DisciplineScoreBatch[] {
  const inserted = new Set(insertedRecordIds.map(Number));
  const rules = actorRole === "teacher"
    ? [
      { recordType: "discipline", size: 3, targetScore: "continuous" as const, delta: -1 as const },
      { recordType: "praise", size: 2, targetScore: "continuous" as const, delta: 1 as const },
    ]
    : [
      { recordType: "discipline", size: 3, targetScore: "discipline" as const, delta: -1 as const },
    ];

  const batches: DisciplineScoreBatch[] = [];
  for (const rule of rules) {
    const ids = history
      .filter(record => rule.recordType === "praise" ? record.record_type === "praise" : record.record_type !== "praise")
      .map(record => Number(record.id));
    for (let offset = 0; offset + rule.size <= ids.length; offset += rule.size) {
      const sourceRecordIds = ids.slice(offset, offset + rule.size);
      if (!sourceRecordIds.some(id => inserted.has(id))) continue;
      batches.push({
        sourceRecordIds,
        targetScore: rule.targetScore,
        delta: rule.delta,
        disciplineCount: rule.delta < 0 ? rule.size : 0,
        praiseCount: rule.delta > 0 ? rule.size : 0,
      });
    }
  }
  return batches;
}
