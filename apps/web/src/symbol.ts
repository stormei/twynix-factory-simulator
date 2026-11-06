import { Component, input, output } from "@angular/core";
import type { Equipment, EquipmentState } from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
import { EquipmentGlyph } from "./glyph";
@Component({
  selector: "g[equipmentSymbol]",
  standalone: true,
  imports: [EquipmentGlyph],
  template: `
    <svg:rect
      x="-18"
      y="-47"
      width="156"
      height="224"
      rx="14"
      class="selection-frame"
      [class.is-selected]="selected()"
    />
    <svg:rect
      x="24"
      y="-33"
      width="72"
      height="21"
      rx="5"
      class="equipment-tag-bg"
    />
    <svg:text x="60" y="-19" text-anchor="middle" class="tag">
      {{ equipment().tag }}
    </svg:text>
    <svg:g equipmentGlyph [type]="equipment().type" [state]="state()" />
    <svg:text x="60" y="142" text-anchor="middle" class="equipment-label">
      {{ equipment().label }}
    </svg:text>
    <svg:rect
      x="15"
      y="153"
      width="90"
      height="19"
      rx="9.5"
      [attr.class]="'state-chip ' + status()"
    />
    <svg:circle
      cx="27"
      cy="162.5"
      r="2.5"
      [attr.class]="'state-indicator ' + status()"
    />
    <svg:text x="64" y="166" text-anchor="middle" class="state-caption">
      {{ status() }}
    </svg:text>
    @if (reading()) {
      <svg:text x="60" y="193" text-anchor="middle" class="symbol-reading">
        {{ reading() }}
      </svg:text>
    }
    @for (port of ports(); track port.id) {
      <svg:circle
        [attr.cx]="
          port.id === 'level' ? 60 : port.direction === 'input' ? 0 : 120
        "
        [attr.cy]="port.id === 'level' ? 120 : 60"
        r="5"
        class="port"
        (pointerdown)="$event.stopPropagation()"
        (click)="$event.stopPropagation(); portClick.emit(port.id)"
      >
        <svg:title>
          {{ port.name }} · {{ port.domain }} · {{ port.direction }}
        </svg:title>
      </svg:circle>
    }
  `,
})
export class EquipmentSymbol {
  equipment = input.required<Equipment>();
  state = input<EquipmentState>();
  selected = input(false);
  portClick = output<string>();
  ports = () => definitions[this.equipment().type].ports;
  status() {
    return this.state()?.status ?? "stopped";
  }
  reading() {
    const v = this.state()?.values;
    if (!v) return "";
    const t = this.equipment().type;
    const n = (key: string) => Number(v[key] ?? 0).toFixed(1);
    if (t === "tank")
      return n("Level") + "% · " + Math.round(Number(v["Volume"])) + " L";
    if (t === "pump" || t === "pipe" || t === "source")
      return n("FlowRate") + " L/s";
    if (t === "valve") return n("Position") + "% open";
    if (t.includes("sensor"))
      return (
        n("Measurement") +
        " " +
        definitions[t].tags.find((x) => x.name === "Measurement")?.unit
      );
    if (t === "buffer")
      return v["QueueLength"] + " / " + v["Capacity"] + " slots";
    if (t === "sink")
      return v["ProductCount"] + " good · " + v["RejectCount"] + " reject";
    if (t === "material-source") return v["ProductCount"] + " released";
    if (t === "machine" || t === "inspection")
      return n("CycleProgress") + "% cycle";
    if (t === "conveyor") return (v["QueueLength"] ?? 0) + " on belt";
    return "";
  }
}
