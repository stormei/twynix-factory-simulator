import { Component, input } from "@angular/core";
import type { EquipmentType, EquipmentState } from "@twynix/shared-types";
@Component({
  selector: "svg[graphicsDefs]",
  standalone: true,
  template: ` <svg:defs>
    <svg:linearGradient id="metal-front" x1="0" y1="0" x2="0" y2="1">
      <svg:stop offset="0" stop-color="#f8fbfd" />
      <svg:stop offset="1" stop-color="#bdcdd9" />
    </svg:linearGradient>
    <svg:linearGradient id="blue-panel" x1="0" y1="0" x2="1" y2="1">
      <svg:stop offset="0" stop-color="#638cbb" />
      <svg:stop offset="1" stop-color="#2b527f" />
    </svg:linearGradient>
    <svg:linearGradient id="teal-panel" x1="0" y1="0" x2="1" y2="1">
      <svg:stop offset="0" stop-color="#42b5aa" />
      <svg:stop offset="1" stop-color="#147c78" />
    </svg:linearGradient>
    <svg:linearGradient id="belt-surface" x1="0" y1="0" x2="0" y2="1">
      <svg:stop offset="0" stop-color="#394b59" />
      <svg:stop offset="1" stop-color="#1d2c38" />
    </svg:linearGradient>
    <svg:linearGradient id="water-fill" x1="0" y1="0" x2="1" y2="1">
      <svg:stop offset="0" stop-color="#6dd9d4" stop-opacity=".85" />
      <svg:stop offset="1" stop-color="#139eaa" stop-opacity=".95" />
    </svg:linearGradient>
    <svg:linearGradient id="glass-panel" x1="0" y1="0" x2="1" y2="0">
      <svg:stop offset="0" stop-color="#d4ecf3" />
      <svg:stop offset=".3" stop-color="#f1f9fc" />
      <svg:stop offset="1" stop-color="#b7d7e2" />
    </svg:linearGradient>
    <svg:linearGradient id="box-front" x1="0" y1="0" x2="1" y2="1">
      <svg:stop offset="0" stop-color="#edbf76" />
      <svg:stop offset="1" stop-color="#cc9146" />
    </svg:linearGradient>
    <svg:clipPath id="tank-interior">
      <svg:path d="M24 27 Q60 15 96 27 V99 Q60 114 24 99Z" />
    </svg:clipPath>
    <svg:filter
      id="equipment-shadow"
      x="-30%"
      y="-30%"
      width="170%"
      height="180%"
    >
      <svg:feDropShadow
        dx="0"
        dy="4"
        stdDeviation="3"
        flood-color="#345064"
        flood-opacity=".15"
      />
    </svg:filter>
    <svg:symbol id="parcel" viewBox="0 0 30 30">
      <svg:path
        d="M2 9L17 3L28 9L13 15Z"
        fill="#f3d49b"
        stroke="#bb853d"
        stroke-width=".7"
      />
      <svg:path
        d="M2 9L13 15V28L2 22Z"
        fill="#cf944e"
        stroke="#b47d38"
        stroke-width=".7"
      />
      <svg:path
        d="M13 15L28 9V22L13 28Z"
        fill="url(#box-front)"
        stroke="#b47d38"
        stroke-width=".7"
      />
      <svg:path
        d="M9 6L21 12V18"
        fill="none"
        stroke="#fff2cf"
        stroke-width="3"
      />
      <svg:path d="M18 21L24 18" stroke="#926737" stroke-width=".7" />
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
