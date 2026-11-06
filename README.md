# Twynix Factory Simulator

A working local industrial simulator: Angular SVG engineering editor, authoritative fixed-step Node.js process runtime, SQLite project library, and a real independently accessible OPC UA server. No cloud or external service is used at runtime.

## Run

Requires Node.js **22.22.3+** (or supported newer LTS) and npm. Install packages once; builds and runtime work offline afterward.

```sh
npm ci --legacy-peer-deps
npm run setup  # creates .env with a unique password and secure defaults
npm run build
npm start
```

Open **http://127.0.0.1:3000**. Choose **Packaging line** from the equipment sidebar and press **Start**. Packages move through a feeder, conveyor, finite buffer, machine and vision inspection to finished goods. A fresh installation opens this example by default. The **Water treatment** example remains available; its pump starts automatically below 30% tank level and stops above 80%. Backend process execution and OPC UA subscriptions continue when the browser closes. Stop the server with Ctrl+C.

For development, use `npm run dev` and open http://127.0.0.1:4200. The Angular development proxy forwards API and WebSocket requests to port 3000.

For an isolated local test with unsecured OPC UA transport, explicitly set `OPCUA_DEV=true`. This permits anonymous **reads only**. Writes still require an authenticated operator with a password of at least 12 characters. The default profile uses Basic256Sha256 / SignAndEncrypt and rejects unknown client certificates.

## Try the production line

- Use the **Symbols** slider in the drawing toolbar to set equipment and product size (80–160%). It works while running, adjusts connection anchors, and remembers your choice in this browser.
- The equipment palette hides automatically while running and returns on Pause/Stop. The drawing fits the available workspace, with larger equipment and product symbols.
- Watch the shaded SVG equipment: packages are drawn from actual backend WIP, not a decorative animation. Every station shows its operating state; a full buffer blocks upstream equipment and a stopped feeder eventually starves downstream equipment.
- The live strip shows good output, throughput, WIP, completed-product lead time, processing utilization and the busiest workstation. **Performance** shows each station's occupancy, starvation, blockage and fault duration.
- Open **I/O signals** to search equipment/tags, filter commands versus measurements, inspect quality/control ownership, change manual commands/setpoints, and copy stable OPC UA NodeIds. Click a signal name to inspect its equipment. External and automatic ownership disable manual writes.
- Pause and open **Experiments**. Add a fault window (for example, trip MC-101 at 20 s and clear at 50 s). Save the project to reuse that scenario. Reset and Start replay it.
- Compare the baseline with a larger buffer and a faster machine. Runs use the same seed, starting configuration and schedule. Results retain the full definition and are stored in SQLite; the live simulation is unaffected. Open the report selector to revisit recent comparisons.
- Change capacity/cycle-time parameters while paused to apply a configuration to the live project. A larger buffer alone may not improve throughput when the machine is the limiting station.

## Try the process

- Select P-101 and switch **Control mode** to **Manual** while paused. Editing configuration restores initial conditions. Start, then toggle RunCommand or change SpeedSetpoint. Actual speed ramps over three seconds; flow, current, power, and tank level respond.
- Select XV-102 and turn OpenCommand on to drain. Valve actuation takes two seconds. The empty/full tank constraints limit actual flow.
- Select P-101 and activate `trip`, then clear it. Faults are logged and affect the process. Select LT-101 to try `stuck`, `drift`, or `invalid`.
- Pause to edit. Drag symbols from the library (double-click also adds), move symbols, click an output port then an input port to connect. Invalid connections are rejected. Double-click a connection to remove it.
- Shift-click selects multiple symbols. Ctrl/Cmd A/C/V/D/Z/Shift-Z/S, Delete, align, grid snap, wheel zoom, Alt-drag pan, and fit view are available.
- Save persists to SQLite. Open manages saved projects. Rename by clicking the project title. Duplicate through Open. Import/export versioned project JSON from the footer.

## External OPC UA

Endpoint: `opc.tcp://localhost:4840`. Set `OPCUA_HOST` to the hostname clients can resolve (especially Docker); set `OPCUA_PORT` if necessary. Namespace URI: `urn:twynix:factory-simulator`.

Example stable NodeIds (resolve the namespace URI instead of assuming index 2 in general):

```text
ns=2;s=project/water-treatment/equipment/pump/RunCommand
ns=2;s=project/water-treatment/equipment/pump/RunFeedback
ns=2;s=project/water-treatment/equipment/pump/SpeedSetpoint
ns=2;s=project/water-treatment/equipment/tank/Level
ns=2;s=project/water-treatment/equipment/tank/Volume
ns=2;s=project/water-treatment/simulation/SimulationTime
ns=2;s=project/production-line/equipment/conveyor/RunCommand
ns=2;s=project/production-line/equipment/buffer/QueueLength
ns=2;s=project/production-line/equipment/finished/ProductCount
ns=2;s=project/production-line/simulation/WorkInProgress
ns=2;s=project/production-line/simulation/Throughput
```

1. For secure connections, exchange/trust application certificates. Server PKI lives in `data/pki`. Verify a client's certificate fingerprint before moving its certificate from `rejected` to `trusted/certs`; reconnect afterward. Trust the server certificate in the client as well. Keep the PKI volume across restarts.
2. Authenticate as `OPCUA_USER` (default `operator`) using the configured password. The operator has read/write permissions; anonymous users in the development profile have read permission only.
3. Pause, select the pump, and set its control mode to **External**. Start/resume the runtime.
4. Write RunCommand as Boolean or SpeedSetpoint as Double (0–100). Read RunFeedback, ActualSpeed, FlowRate, and tank Level or create data-change subscriptions.
5. A successful write means **accepted command**, not completed equipment motion. Feedback follows physics. Trip interlocks, wrong types/ranges, read-only variables, and control ownership reject writes with OPC UA status codes.

Simulation status/time/speed nodes are currently read-only; use the application/API for runtime controls. Renaming a display tag or moving a symbol preserves its NodeIds. Structural edits rebuild the address space: reconnect/recreate affected monitored items after editing.

## Validation

```sh
npm run build
npm test
npx playwright install chromium  # one-time installation
npm run test:e2e
```

Tests exercise deterministic process behavior, boundaries, hysteresis, fault effects, storage and input validation. Independent OPC UA clients exercise browsing, subscriptions, permissions, invalid writes, stable IDs, and encrypted authenticated connections. Browser tests exercise process commands, pause/reset, editing, saving/reloading, and execution after browser closure. Production checks cover product conservation, bounded queues, blockage/starvation, seeded rejection, scheduled downtime, and reproducible isolated experiments. Browser checks also cover I/O command editing, scenario authoring and saved comparison reloads.

## Deployment

```sh
# Populate .env with OPCUA_PASSWORD and API_TOKEN first.
docker compose up --build -d
```

Web API binds locally by default. A non-loopback API bind requires API_TOKEN. In the browser click **Access token** to configure it. Put a TLS reverse proxy in front of remote web access. OPC UA uses its own encrypted transport. Compose publishes web access to loopback and OPC UA on 4840; change the binding deliberately for your installation.

Configuration: HOST, PORT, DATA_DIR, API_TOKEN, OPCUA_HOST, OPCUA_PORT, OPCUA_USER, OPCUA_PASSWORD, OPCUA_DEV. Startup restores the most recently saved project in a **stopped initial state**, never resumes stale process values. Save explicitly persists project definitions; transient runtime values, sessions, events, and WebSockets are not stored.

## Scope

This is the initial working vertical slice, not the entire product backlog. See [architecture and limitations](docs/architecture.md) for exact physics assumptions, editor limitations, security boundaries, and follow-up work. All equipment is simulated; there are no outbound connections to real industrial equipment.
