import { bootstrapApplication } from "@angular/platform-browser";
import { Component, signal, computed, HostListener } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatTooltipModule } from "@angular/material/tooltip";
import type {
  Project,
  Equipment,
  EquipmentType,
  Snapshot,
  Value,
  Connection,
} from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
import { equipment } from "../../../examples/water-treatment";
import { EquipmentSymbol } from "./symbol";
@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatTooltipModule,
    EquipmentSymbol,
  ],
  templateUrl: "./app.html",
})
export class App {
  project = signal<Project | null>(null);
  runtime = signal<Snapshot | null>(null);
  selected = signal<string[]>([]);
  selectedEquipment = computed(() =>
    this.project()?.equipment.find((e) => e.id === this.selected()[0]),
  );
  catalog = Object.entries(definitions);
  search = signal("");
  filtered = computed(() =>
    this.catalog.filter(([key, d]) =>
      (key + d.name + d.category)
        .toLowerCase()
        .includes(this.search().toLowerCase()),
    ),
  );
  notice = signal("");
  connected = signal(false);
  projects = signal<{ id: string; name: string }[]>([]);
  showProjects = signal(false);
  tab = signal("events");
  zoom = signal(0.85);
  pan = signal({ x: 15, y: 70 });
  connecting = signal<{ id: string; port: string } | null>(null);
  undoStack: Project[] = [];
  redoStack: Project[] = [];
  clipboard: Equipment[] = [];
  private drag: {
    x: number;
    y: number;
    positions: Map<string, { x: number; y: number }>;
    before: Project;
  } | null = null;
  private panning: { x: number; y: number; px: number; py: number } | null =
    null;
  private socket?: WebSocket;
  private disposed = false;
  constructor() {
    void this.load();
    window.addEventListener("beforeunload", () => {
      this.disposed = true;
      this.socket?.close();
    });
  }
  async api<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const token = localStorage.getItem("twynix-token");
    const res = await fetch("/api/" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.error ?? res.statusText);
    return data as T;
  }
  async attempt(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      this.notice.set(String(e));
    }
  }
  async load() {
    await this.attempt(async () => {
      this.project.set(await this.api<Project>("project"));
      this.runtime.set(await this.api<Snapshot>("snapshot"));
      this.connect();
    });
  }
  connect() {
    this.socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    this.socket.onopen = () => this.connected.set(true);
    this.socket.onmessage = (event) => {
      const d = JSON.parse(event.data) as Snapshot & { kind: string };
      const old = this.runtime();
      this.runtime.set(
        d.kind === "snapshot" || !old
          ? d
          : {
              ...d,
              states: { ...old.states, ...d.states },
              events: [
                ...new Map(
                  [...old.events, ...d.events].map((e) => [e.seq, e]),
                ).values(),
              ]
                .sort((a, b) => a.seq - b.seq)
                .slice(-200),
            },
      );
      if (old && d.revision !== old.revision)
        void this.api<Project>("project").then((p) => this.project.set(p));
    };
    this.socket.onclose = () => {
      this.connected.set(false);
      if (!this.disposed) setTimeout(() => this.connect(), 1500);
    };
  }
  setToken() {
    const token = prompt("API access token");
    if (token) {
      localStorage.setItem("twynix-token", token);
      document.cookie = `twynix_token=${encodeURIComponent(token)}; SameSite=Strict; Path=/`;
      void this.load();
    }
  }
  async control(action: "start" | "pause" | "stop" | "reset") {
    await this.attempt(async () => {
      this.runtime.set(await this.api<Snapshot>("control", { action }));
      if (action === "reset")
        this.project.set(await this.api<Project>("project"));
    });
  }
  async speed(value: string) {
    await this.attempt(async () => {
      this.runtime.set(
        await this.api<Snapshot>("control", {
          action: this.runtime()?.status === "running" ? "start" : "pause",
          speed: Number(value),
        }),
      );
    });
  }
  async commit(before: Project) {
    try {
      const p = await this.api<Project>("project", this.project());
      this.undoStack.push(before);
      this.redoStack = [];
      this.project.set(p);
      this.notice.set("Process updated · initial conditions restored");
    } catch (e) {
      this.project.set(before);
      this.notice.set(String(e));
    }
  }
  edit(fn: (p: Project) => void) {
    const before = structuredClone(this.project()!);
    const p = structuredClone(before);
    fn(p);
    this.project.set(p);
    void this.commit(before);
  }
  async undo(redo = false) {
    const stack = redo ? this.redoStack : this.undoStack;
    const p = stack.pop();
    if (!p) return;
    await this.attempt(async () => {
      const current = structuredClone(this.project()!);
      this.project.set(await this.api<Project>("project", p));
      (redo ? this.undoStack : this.redoStack).push(current);
    });
  }
  async save() {
    await this.attempt(async () => {
      await this.api("projects/save", {});
      this.notice.set("Project saved to SQLite");
    });
  }
  async openList() {
    await this.attempt(async () => {
      this.projects.set(await this.api("projects"));
      this.showProjects.set(true);
    });
  }
  async open(id: string) {
    await this.attempt(async () => {
      this.project.set(await this.api("projects/open", { id }));
      this.selected.set([]);
      this.undoStack = [];
      this.redoStack = [];
      this.showProjects.set(false);
    });
  }
  async removeProject(id: string) {
    await this.attempt(async () => {
      await this.api("projects/" + id, undefined, "DELETE");
      this.projects.set(await this.api("projects"));
    });
  }
  newProject() {
    this.edit((p) => {
      p.id = "project-" + Date.now();
      p.name = "Untitled process";
      p.equipment = [];
      p.connections = [];
      p.controllers = [];
      p.scenarios = [];
    });
  }
  duplicateProject() {
    this.edit((p) => {
      p.id = "project-" + Date.now();
      p.name += " · Copy";
    });
  }
  rename() {
    const name = prompt("Project name", this.project()?.name);
    if (name)
      this.edit((p) => {
        p.name = name;
      });
  }
  export() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(this.project(), null, 2)], {
        type: "application/json",
      }),
    );
    a.download = this.project()!.id + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async importFile(event: Event) {
    const f = (event.target as HTMLInputElement).files?.[0];
    if (!f) return;
    await this.attempt(async () => {
      const before = structuredClone(this.project()!);
      this.project.set(
        await this.api<Project>("project", JSON.parse(await f.text())),
      );
      this.undoStack.push(before);
    });
  }
  startLibrary(e: DragEvent, type: string) {
    e.dataTransfer?.setData("equipment", type);
  }
  drop(e: DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer?.getData("equipment") as EquipmentType;
    if (!definitions[type]) return;
    const pt = this.point(e);
    this.add(type, pt.x, pt.y);
  }
  add(type: EquipmentType, x = 250, y = 160) {
    this.edit((p) => {
      const id = "e" + Date.now();
      p.equipment.push(
        equipment(
          id,
          type,
          type.toUpperCase().slice(0, 3) +
            "-" +
            String(p.equipment.length + 101),
          Math.round(x / 20) * 20,
          Math.round(y / 20) * 20,
        ),
      );
      this.selected.set([id]);
    });
  }
  point(e: MouseEvent) {
    const svg = document.querySelector("svg.canvas")!;
    const rect = svg.getBoundingClientRect();
    return {
      x:
        (((e.clientX - rect.left) * 1400) / rect.width - this.pan().x) /
        this.zoom(),
      y:
        (((e.clientY - rect.top) * 760) / rect.height - this.pan().y) /
        this.zoom(),
    };
  }
  down(e: PointerEvent, item: Equipment) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey)
      this.selected.update((ids) =>
        ids.includes(item.id)
          ? ids.filter((id) => id !== item.id)
          : [...ids, item.id],
      );
    else if (!this.selected().includes(item.id)) this.selected.set([item.id]);
    if (this.runtime()?.status === "running") return;
    const pt = this.point(e);
    this.drag = {
      x: pt.x,
      y: pt.y,
      positions: new Map(
        this.project()!
          .equipment.filter((i) => this.selected().includes(i.id))
          .map((i) => [i.id, { x: i.x, y: i.y }]),
      ),
      before: structuredClone(this.project()!),
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  background(e: PointerEvent) {
    if (e.button === 1 || e.altKey) {
      this.panning = {
        x: e.clientX,
        y: e.clientY,
        px: this.pan().x,
        py: this.pan().y,
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else {
      this.selected.set([]);
      this.connecting.set(null);
    }
  }
  move(e: PointerEvent) {
    if (this.panning) {
      this.pan.set({
        x: this.panning.px + (e.clientX - this.panning.x),
        y: this.panning.py + (e.clientY - this.panning.y),
      });
    }
    if (!this.drag) return;
    const pt = this.point(e);
    const p = structuredClone(this.project()!);
    for (const item of p.equipment) {
      const old = this.drag.positions.get(item.id);
      if (old) {
        item.x = Math.round((old.x + pt.x - this.drag.x) / 20) * 20;
        item.y = Math.round((old.y + pt.y - this.drag.y) / 20) * 20;
      }
    }
    this.project.set(p);
  }
  up() {
    this.panning = null;
    if (!this.drag) return;
    const before = this.drag.before;
    this.drag = null;
    if (JSON.stringify(before) !== JSON.stringify(this.project()))
      void this.commit(before);
  }
  wheel(e: WheelEvent) {
    e.preventDefault();
    this.zoom.set(
      Math.max(0.3, Math.min(2, this.zoom() + (e.deltaY > 0 ? -0.05 : 0.05))),
    );
  }
  fit() {
    this.zoom.set(0.85);
    this.pan.set({ x: 15, y: 70 });
  }
  port(item: Equipment, port: string) {
    const from = this.connecting();
    if (!from) {
      this.connecting.set({ id: item.id, port });
      this.notice.set("Select an input port to complete the connection");
      return;
    }
    this.connecting.set(null);
    this.edit((p) =>
      p.connections.push({
        id: "c" + Date.now(),
        from: from.id,
        fromPort: from.port,
        to: item.id,
        toPort: port,
      }),
    );
  }
  path(c: Connection) {
    const a = this.project()?.equipment.find((e) => e.id === c.from),
      b = this.project()?.equipment.find((e) => e.id === c.to);
    if (!a || !b) return "";
    const x = a.x + (c.fromPort === "level" ? 60 : 120),
      y = a.y + (c.fromPort === "level" ? 120 : 60),
      tx = b.x,
      ty = b.y + 60;
    return `M${x} ${y}H${(x + tx) / 2}V${ty}H${tx}`;
  }
  editRemoveConnection(id: string) {
    this.edit((p) => {
      p.connections = p.connections.filter((c) => c.id !== id);
    });
  }
  delete() {
    this.edit((p) => {
      p.equipment = p.equipment.filter((e) => !this.selected().includes(e.id));
      p.connections = p.connections.filter(
        (c) =>
          !this.selected().includes(c.from) && !this.selected().includes(c.to),
      );
      p.controllers = p.controllers.filter(
        (r) =>
          !this.selected().includes(r.tank) &&
          !this.selected().includes(r.pump),
      );
      p.scenarios = p.scenarios.filter(
        (s) => !this.selected().includes(s.equipmentId),
      );
    });
    this.selected.set([]);
  }
  copy() {
    this.clipboard = structuredClone(
      this.project()!.equipment.filter((e) => this.selected().includes(e.id)),
    );
  }
  paste() {
    this.edit((p) => {
      const ids: string[] = [];
      for (const [i, item] of this.clipboard.entries()) {
        const id = "e" + Date.now() + "_" + i;
        ids.push(id);
        p.equipment.push({
          ...structuredClone(item),
          id,
          tag: item.tag + "-" + String(p.equipment.length),
          x: item.x + 40,
          y: item.y + 40,
        });
      }
      this.selected.set(ids);
    });
  }
  align() {
    this.edit((p) => {
      const y = p.equipment.find((e) => e.id === this.selected()[0])?.y;
      for (const e of p.equipment)
        if (this.selected().includes(e.id) && y !== undefined) e.y = y;
    });
  }
  change(field: "tag" | "label" | "mode", value: string) {
    const id = this.selectedEquipment()!.id;
    this.edit((p) => {
      const e = p.equipment.find((e) => e.id === id)!;
      if (
        field === "mode" &&
        (value === "manual" || value === "external" || value === "automatic")
      )
        e.mode = value;
      else if (field === "tag") e.tag = value;
      else if (field === "label") e.label = value;
    });
  }
  parameter(key: string, value: string) {
    const id = this.selectedEquipment()!.id;
    this.edit((p) => {
      p.equipment.find((e) => e.id === id)!.parameters[key] = Number(value);
    });
  }
  async command(tag: string, value: Value) {
    await this.attempt(async () => {
      await this.api("command", {
        id: this.selectedEquipment()!.id,
        tag,
        value,
      });
      this.project.set(await this.api("project"));
    });
  }
  async fault(fault: string, active: boolean) {
    await this.attempt(async () => {
      await this.api("fault", {
        id: this.selectedEquipment()!.id,
        fault,
        active,
      });
      this.project.set(await this.api("project"));
    });
  }
  tags = () =>
    this.selectedEquipment()
      ? definitions[this.selectedEquipment()!.type].tags
      : [];
  ports = () =>
    this.selectedEquipment()
      ? definitions[this.selectedEquipment()!.type].ports
      : [];
  params = () => Object.entries(this.selectedEquipment()?.parameters ?? {});
  value(id: string, key: string) {
    const v = this.runtime()?.states[id]?.values[key];
    return typeof v === "number" ? v.toFixed(2) : String(v ?? "—");
  }
  commandValue(tag: string) {
    const item = this.selectedEquipment();
    if (!item) return false;
    return Boolean(
      item.mode === "automatic"
        ? this.runtime()?.states[item.id]?.values[tag]
        : item.commands[tag],
    );
  }
  nodeId(tag: string) {
    return `ns=2;s=project/${this.project()?.id}/equipment/${this.selectedEquipment()?.id}/${tag}`;
  }
  @HostListener("window:keydown", ["$event"]) key(e: KeyboardEvent) {
    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(
        (e.target as HTMLElement).tagName,
      )
    )
      return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.delete();
    }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (["s", "z", "y", "c", "v", "d", "a"].includes(k)) e.preventDefault();
      if (k === "s") void this.save();
      if (k === "z") void this.undo(e.shiftKey);
      if (k === "y") void this.undo(true);
      if (k === "c") this.copy();
      if (k === "v") this.paste();
      if (k === "d") {
        this.copy();
        this.paste();
      }
      if (k === "a")
        this.selected.set(this.project()!.equipment.map((e) => e.id));
    }
  }
}
bootstrapApplication(App).catch(console.error);
