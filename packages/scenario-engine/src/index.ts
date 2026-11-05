import type { Project } from "@twynix/shared-types";
export function applyScenarios(
  p: Project,
  time: number,
  dt: number,
  emit: (s: string) => void,
): void {
  for (const s of p.scenarios)
    if (s.at >= time && s.at < time + dt) {
      const e = p.equipment.find((e) => e.id === s.equipmentId);
      if (e) {
        e.faults = e.faults.filter((f) => f !== s.fault);
        if (s.active) e.faults.push(s.fault);
        emit(`${e.tag}: ${s.fault} ${s.active ? "activated" : "cleared"}`);
      }
    }
}
