import {
  experimentSchema,
  type Project,
  type ExperimentRequest,
  type ExperimentResult,
} from "@twynix/shared-types";
import { validateProject } from "@twynix/process-graph";
import { Simulation } from "./index";
/** Isolated fixed-step runs; yielding allows the live runtime to continue serving clients. */
export async function runExperiments(
  project: Project,
  input: ExperimentRequest,
  yieldControl: () => Promise<void> = async () => {},
): Promise<ExperimentResult[]> {
  const request = experimentSchema.parse(input);
  const steps = Math.floor(request.duration * 10);
  if (
    steps * Math.max(1, project.equipment.length) * request.variants.length >
    2_000_000
  )
    throw Error(
      "Experiment too large; shorten the duration or reduce variants",
    );
  const variants = request.variants.map((variant) => {
    const p = structuredClone(project);
    for (const change of variant.overrides) {
      const e = p.equipment.find((e) => e.id === change.equipmentId);
      if (!e || !(change.parameter in e.parameters))
        throw Error("Unknown experiment parameter");
      e.parameters[change.parameter] = change.value;
    }
    validateProject(p);
    return { variant, p };
  });
  const results: ExperimentResult[] = [];
  for (const { variant, p } of variants) {
    const simulation = new Simulation(p);
    for (let i = 0; i < steps; i++) {
      simulation.step();
      if (i % 100 === 99) await yieldControl();
    }
    const metrics = simulation.snapshot().production;
    if (!metrics) throw Error("Experiments require a material feeder");
    results.push({ name: variant.name, overrides: variant.overrides, metrics });
  }
  return results;
}
