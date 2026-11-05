# Architecture and implementation status

## Ownership and packages

`apps/web` is a standalone, signal-driven Angular application using Angular Material buttons/tooltips, SVG symbols, native pointer events, SCSS tokens, and a same-origin API. Selection, viewport, clipboard, and edit history are local UI state. It never computes process physics.

`apps/server` owns one active project/runtime, Fastify HTTP/WebSocket endpoints, a SQLite project library, startup/shutdown, and structured Pino logs. Multiple browser clients observe the same runtime. Editing requires pause/stop and restores initial conditions. Concurrent editing is currently last-write-wins; this is a single-engineering-workspace release, not a collaborative editor.

Packages separate versioned types/validation, equipment metadata and actuator models, process-graph validation/traversal, control ownership/hysteresis, scheduled fault scenarios, deterministic simulation, and OPC UA publication. The shared model contract is exported. SVG symbols are separate from the equipment physics.

## Determinism and overload

Physics uses fixed 100 ms steps. A monotonic wall clock accumulates elapsed time multiplied by speed. At most 50 steps execute per scheduler dispatch. A backlog above 5 simulated seconds pauses execution with an explicit diagnostic; no steps are silently dropped. Resume starts a fresh wall-clock accumulation from the current process state. Pause/stop retain physical state; Reset restores the initial project definition, seed, volume, commands, and faults. Simulation time uses integer deciseconds to avoid accumulated clock drift.

Execution is sorted by stable equipment ID. Controllers read the previous completed state, then actuators advance, fluid paths resolve, and process/sensor states advance. A seeded LCG drives measurement noise. Identical configuration, seed, command/fault step schedule produces identical outputs. Wall-clock/source timestamps are metadata and intentionally not deterministic physics inputs.

## Fluid assumptions

This is a bounded serial-path, incompressible water model, not a hydraulic network solver. Each fluid port accepts at most one connection; tees/manifolds are not supported. Source flow is limited by pump nominal flow × actual speed and the product of valve openings/coefficients. Pipes apply configurable conductance. Tank outlets use a simplified gravity relation, 20 L/s × sqrt(level fraction). Open terminal paths discharge to an implicit drain; disconnected devices have zero process flow.

Tank mass balance uses liters and L/s, with available source volume and destination capacity limiting flow before integration. A visited-ID path walk prevents recursion in cycles. Tanks form storage boundaries, so connected recirculating paths use previous-step storage constraints. Cycles without storage cannot spontaneously create fluid. Empty/full boundaries are conservative (a full tank may resume inlet flow one step after drainage creates space).

Pump speed ramps over configured rampTime. RunFeedback is based on actual speed, not the command. Current/power are simplified speed-dependent approximations, not a motor/pump curve solver. Trips/overheating remove pump output immediately. Fail-to-start blocks acceleration. Valve motion, actuation delay, leakage and stuck faults affect flow. Sensor filtering, seeded noise, offset, drift, bounded delay (maximum 60 s), stuck and invalid quality affect measured values, not process volume.

Conveyor positions, sensor activation and completed products, motor ramps, machine cycles/power and downstream counters are implemented as basic models. Manufacturing equipment does not yet perform full material handoff, starvation/blockage, electrical network solving, or coordinated production-line control. Pressure is a flow-related approximation. Counter values reflect an upstream machine/conveyor count. Photoelectric sensors reference upstream conveyor activation.

## Control and faults

Manual commands originate in the app; external commands originate in OPC UA; automatic pumps belong to enabled level controllers. Low/high hysteresis prevents cycling. Trip/overheat reject starts. Commands are accepted synchronously and motion completes on later physics steps. The JSON schema contains declarative controllers and timed fault scenarios; no arbitrary JavaScript executes. Scenario rules are applied at step boundaries. Manual fault activation and clearing is recorded in the bounded runtime event log. Faults not applicable to an equipment type have no physical effect in this release.

## Persistence and lifecycle

SQLite uses WAL and stores versioned project JSON plus metadata. Runtime states, alarms/events, UI viewport/selection, and communication sessions are transient. Startup opens the most recently saved definition, stopped at initial conditions. Explicit Save includes current command/fault configuration. Reset restores the definition captured when the project was loaded/edited; saving does not redefine the current runtime's reset baseline until reload. `migrateProject` accepts schema v1 and rejects unknown versions; no older schema exists to migrate yet.

## Communication and security

WebSocket clients receive a complete consistent snapshot on connection, followed by changed equipment states and new events at 5 Hz. Physics runs separately from transport frequency. Slow consumers above 1 MB queued data are disconnected and must reconnect for a fresh snapshot. Browser refresh/closure does not control server lifecycle.

OPC UA runs inside the same backend process, independent of browser sessions. Namespace and NodeIds are generated from model metadata, project ID and equipment ID. Read values carry source timestamps and quality status; writable nodes validate session role, Boolean/Double datatype, range, control mode and interlocks before submitting commands. Read-only variables are never writable. The production profile uses Basic256Sha256 SignAndEncrypt for sessions (the standard unsecured discovery endpoint is restricted to discovery services), rejects anonymous sessions and untrusted certificates, and requires an operator password. Development explicitly enables unsecured transport and anonymous reads; writes always require the configured operator. This release has one configured operator role and an anonymous read-only development role, not a user-directory/admin UI.

The web API has optional bearer-token authentication on loopback, required when binding remotely, and rejects cross-origin requests. WebSockets authenticate via a same-site cookie set by the local application when an access token is entered. Remote web deployment needs TLS termination and host/firewall controls. It is not a hardened multi-tenant service. OPC UA only exposes simulated objects; no client or bridge to real equipment exists.

## Editor and remaining product backlog

Implemented: library search, drag/drop, reusable symbols for all initial types, click/Shift-select/select all, move, delete, copy/paste/duplicate, undo/redo, horizontal alignment, grid snap, zoom/pan/fit preset, port connections with server validation/removal, properties/labels/parameters, mode/commands/faults, save/open/rename/duplicate/delete/import/export, live events/alarms and session count.

Remaining: marquee selection, context menus, custom connection waypoints/obstacle routing, configurable grid/snap, true bounds-based zoom-to-fit (current Fit restores the demo viewport), per-category collapse, vertical/distributed alignment, rotation, persistent UI layout, graphical controller/scenario authoring, per-session diagnostics, full user/role management, collaborative edit conflict detection, material transfer/line balancing and more advanced hydraulic models. Controller and scenario definitions can currently be authored through validated imported JSON. The top process-area drawing annotation is currently fixed to the water-demo area.

## Verification boundaries

Unit/integration checks exercise process physics, deterministic repeatability, command ownership, fault models, validation, SQLite, and independent node-opcua clients. Playwright exercises the compiled application, editing/persistence and headless continuation. These are local acceptance tests; Docker packaging is supplied but should be built and validated on the target host. Kepware/ThingsBoard integration and third-party client interoperability beyond the independent node-opcua client have not been certified.
