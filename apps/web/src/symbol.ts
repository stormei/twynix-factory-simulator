import { Component, input, output } from "@angular/core";
import type { Equipment, EquipmentState } from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
@Component({
  selector: "g[equipmentSymbol]",
  standalone: true,
  template: `
    <svg:rect
      x="-12"
      y="-15"
      width="144"
      height="158"
      rx="8"
      fill="transparent"
      [attr.stroke]="selected() ? '#20a99c' : 'none'"
      stroke-dasharray="5 4"
    />
    <svg:text x="60" y="-25" text-anchor="middle" class="tag">
      {{ equipment().tag }}
    </svg:text>
    <svg:g
      class="equipment-body"
      [class.operating]="state()?.values?.['RunFeedback']"
      [class.faulted]="state()?.status === 'fault'"
    >
      @switch (equipment().type) {
        @case ("tank") {
          <svg:path
            d="M10 20 Q60 0 110 20 V105 Q60 125 10 105 Z"
            fill="#162a38"
          />
          <svg:path [attr.d]="tankFill()" fill="#1d817d" stroke="none" />
          <svg:ellipse cx="60" cy="20" rx="50" ry="12" />
          <svg:path d="M10 20 V105 Q60 125 110 105 V20" fill="none" />
          <svg:path d="M0 60H10 M110 60H120" />
          <svg:text x="60" y="62" text-anchor="middle" class="big-value">
            {{ number("Level") }}%
          </svg:text>
          <svg:text x="60" y="83" text-anchor="middle" class="unit">
            {{ number("Volume") }} L
          </svg:text>
        }
        @case ("pump") {
          <svg:path d="M0 60H24 M96 60H120 M43 94L30 110H91L78 94" />
          <svg:circle cx="60" cy="60" r="36" />
          <svg:path d="M43 34 L85 60 L43 86 Z" fill="#248e87" />
          <svg:text x="60" y="133" text-anchor="middle" class="reading">
            {{ number("FlowRate") }} L/s
          </svg:text>
        }
        @case ("valve") {
          <svg:path
            d="M0 60H20 M100 60H120 M20 38L100 82V38L20 82Z M60 60V20 M42 20H78"
          />
          <svg:text x="60" y="117" text-anchor="middle" class="reading">
            {{ number("Position") }}% open
          </svg:text>
        }
        @case ("source") {
          <svg:path d="M0 60H20 M100 60H120" />
          <svg:rect x="20" y="30" width="80" height="60" rx="8" />
          <svg:path
            d="M35 53Q45 43 55 53T75 53T90 53 M35 68Q45 58 55 68T75 68T90 68"
          />
          <svg:text x="60" y="117" text-anchor="middle" class="reading">
            Supply
          </svg:text>
        }
        @case ("pipe") {
          <svg:path d="M0 52H120V68H0Z" />
          <svg:text x="60" y="117" text-anchor="middle" class="reading">
            {{ number("FlowRate") }} L/s
          </svg:text>
        }
        @case ("conveyor") {
          <svg:rect x="5" y="35" width="110" height="50" rx="22" />
          <svg:circle cx="28" cy="60" r="13" />
          <svg:circle cx="92" cy="60" r="13" />
          <svg:rect
            [attr.x]="
              10 +
              (numberRaw('ProductPosition') /
                equipment().parameters['length']) *
                75
            "
            y="18"
            width="20"
            height="17"
          />
          <svg:text x="60" y="117" text-anchor="middle" class="reading">
            {{ number("ProductCount") }} pcs
          </svg:text>
        }
        @case ("motor") {
          <svg:circle cx="60" cy="60" r="35" />
          <svg:text x="60" y="67" text-anchor="middle" class="big-value">
            M
          </svg:text>
          <svg:path d="M95 60H120" />
          <svg:text x="60" y="117" text-anchor="middle" class="reading">
            {{ number("ActualSpeed") }}%
          </svg:text>
        }
        @case ("machine") {
          <svg:rect x="10" y="20" width="100" height="80" rx="5" />
          <svg:path d="M25 85V55H45V38H70V65H95 M0 60H10 M110 60H120" />
          <svg:text x="60" y="125" text-anchor="middle" class="reading">
            {{ number("ProductCount") }} pcs
          </svg:text>
        }
        @case ("counter") {
          <svg:rect x="15" y="30" width="90" height="60" rx="5" />
          <svg:text x="60" y="68" text-anchor="middle" class="big-value">
            {{ number("ProductCount") }}
          </svg:text>
        }
        @default {
          <svg:path d="M0 60H25 M95 60H120" />
          <svg:circle cx="60" cy="60" r="35" />
          <svg:path d="M30 60H90" />
          <svg:text x="60" y="50" text-anchor="middle" class="instrument">
            {{
              equipment().type === "level-sensor"
                ? "LT"
                : equipment().type === "flow-sensor"
                  ? "FT"
                  : equipment().type === "pressure-sensor"
                    ? "PT"
                    : "PE"
            }}
          </svg:text>
          <svg:text x="60" y="80" text-anchor="middle" class="reading">
            {{ number("Measurement") }}
          </svg:text>
          <svg:text x="60" y="117" text-anchor="middle" class="unit">
            {{ state()?.quality || "Good" }}
          </svg:text>
        }
      }
    </svg:g>
    @for (port of ports(); track port.id) {
      <svg:circle
        [attr.cx]="port.id === 'level' ? 60 : port.id === 'in' ? 0 : 120"
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
    <svg:text x="60" y="155" text-anchor="middle" class="equipment-label">
      {{ equipment().label }}
    </svg:text>
  `,
})
export class EquipmentSymbol {
  equipment = input.required<Equipment>();
  state = input<EquipmentState>();
  selected = input(false);
  portClick = output<string>();
  ports = () => definitions[this.equipment().type].ports;
  numberRaw(tag: string) {
    return Number(this.state()?.values[tag] ?? 0);
  }
  number(tag: string) {
    return this.numberRaw(tag).toFixed(tag === "ProductCount" ? 0 : 1);
  }
  tankFill() {
    const y = 108 - Math.min(100, this.numberRaw("Level")) * 0.78;
    return `M11 ${y} H109 V104 Q60 124 11 104Z`;
  }
}
