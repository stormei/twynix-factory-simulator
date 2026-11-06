import { Component, input } from "@angular/core";
import type { EquipmentType, EquipmentState } from "@twynix/shared-types";
@Component({
  selector: "svg[graphicsDefs]",
  standalone: true,
  template: `<svg:defs>
    <svg:clipPath id="tank-interior">
      <svg:path d="M24 27 Q60 15 96 27 V99 Q60 114 24 99Z" />
    </svg:clipPath>
    <svg:symbol id="parcel" viewBox="0 0 30 30">
      <svg:rect
        x="3"
        y="7"
        width="24"
        height="20"
        rx=".4"
        fill="currentColor"
        stroke="#777b79"
        stroke-width=".65"
      />
      <svg:path
        d="M3 12H27 M15 7V14"
        fill="none"
        stroke="#858a84"
        stroke-width=".65"
      />
      <svg:rect
        x="13.5"
        y="7"
        width="3"
        height="20"
        fill="#e8e5dc"
        stroke="none"
      />
      <svg:rect
        x="19"
        y="17"
        width="6"
        height="6"
        fill="#efeee9"
        stroke="#a3a59e"
        stroke-width=".35"
      />
      <svg:path
        d="M20 18V22 M21 18V22 M22.5 18V22 M24 18V22"
        stroke="#717772"
        stroke-width=".45"
      />
    </svg:symbol>
  </svg:defs>`,
})
export class GraphicsDefinitions {}
@Component({
  selector: "g[equipmentGlyph]",
  standalone: true,
  templateUrl: "./glyph.html",
})
export class EquipmentGlyph {
  readonly Math = Math;
  type = input<EquipmentType>("pump");
  state = input<EquipmentState>();
  preview = input(false);
  value(key: string) {
    return Number(this.state()?.values[key] ?? 0);
  }
  products() {
    return this.preview()
      ? [
          { id: 0, progress: 0.35, rejected: false },
          { id: 1, progress: 0.75, rejected: false },
        ]
      : (this.state()?.products ?? []);
  }
  slots() {
    return Array.from(
      { length: this.preview() ? 4 : Math.min(9, this.value("QueueLength")) },
      (_, i) => i,
    );
  }
  pallets() {
    return Array.from(
      { length: this.preview() ? 3 : Math.min(6, this.value("ProductCount")) },
      (_, i) => i,
    );
  }
}
