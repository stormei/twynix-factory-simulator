# AI-agent access through MCP

The simulator includes a real MCP server using the official TypeScript SDK. It uses **stdio**: an MCP host starts a small local adapter process, which calls the existing simulator backend API. The backend remains the owner of physics, persistence, OPC UA and the live runtime. Starting another MCP adapter does not start another simulator backend or create a second live runtime.

## Start and connect

Install dependencies and start the backend normally with `npm start`. Configure your MCP host to launch the adapter, rather than starting it manually in a separate terminal. For a manual protocol check from the repository, `npm run --silent mcp` starts the stdio server and waits for MCP requests. Do not use ordinary `npm run mcp` as a client command because npm's banner can interfere with protocol stdout.

The generic client example in [examples/mcp-client.json](../examples/mcp-client.json) uses Node, the locally installed TypeScript loader, the adapter entry point and an optional `.env` file. Replace `/absolute/path/to/factory-simulator` in all paths with your checkout's absolute path. A host may require its own configuration format instead of the example's `mcpServers` format. The Node executable must be available to that host; use its absolute path if needed. No account, global MCP configuration or agent host is automatically changed by this implementation.

Environment:

- `TWYNIX_BACKEND_URL`: backend origin; default `http://127.0.0.1:3000`.
- `API_TOKEN`: the same bearer token required by the existing backend, if configured. Supply it through the adapter environment or the local `.env`, never in project definitions or prompts.

Local HTTP is supported for loopback only; a remote backend requires HTTPS. Origins containing credentials, query strings or paths are rejected. HTTP redirects are not followed, so tokens are not forwarded to another origin. The adapter opens no inbound port and implements no Streamable HTTP MCP endpoint or OAuth authorization flow. Several agents may run their own stdio adapters against one backend, subject to that backend's shared credentials and current capacity. Tool annotations guide MCP hosts but are not authorization checks; the backend's API authentication and validations remain authoritative. There is no per-user/project access-control model in this release.

## Agent tools

| Tool | Effect |
| --- | --- |
| `get_equipment_catalog` | Read model-generated equipment, ports, tags, parameter defaults and correctly typed command defaults; optionally filter by type. |
| `get_project_template` | Read a complete solar, production or water example. |
| `list_projects` / `get_saved_project` | Read saved project definitions. |
| `get_simulator_context` | Read active project, runtime, revision and concurrency capabilities. |
| `validate_project` | Validate a complete project at the backend without applying it. |
| `preview_project` | Run a separate deterministic backend simulation for up to 600 simulated seconds; return measurements, metrics and events without changing the live project. |
| `save_project_draft` | Save a separate validated project in the library, without loading it. New IDs are required unless overwrite is explicitly set. The active project cannot be overwritten through this tool. |
| `open_project` | Load a saved project into the paused/stopped live runtime, resetting initial conditions. |
| `apply_project` | Apply a whole definition to the paused/stopped live runtime; resets initial conditions but does not save it. Save a draft before opening it, or save the active project through the editor. |
| `control_simulation` | Start, pause, stop or reset the live runtime and optionally change speed. |
| `set_equipment_command` | Submit a Manual-owned command under the same range/interlock/weather rules as the editor. External/automatic ownership is not bypassed. |
| `set_equipment_fault` | Inject or clear a simulated fault. |
| `search_weather_locations` | Explicitly search the provider for a place; sends search text and needs internet. |
| `get_weather_forecast` | Explicitly download weather for requested coordinates/orientation; returns a configuration to put in a draft, without applying it to the live project. |

MCP resources expose `twynix://schema/project-v1` (JSON Schema) and `twynix://guide/building` (workflow and boundaries). The `build_simulation` prompt takes a `requirements` string and guides an agent to build, validate, preview and save a draft, leaving the live run unchanged unless requested.

## Recommended building workflow

1. Read the catalog and a relevant template. Copy the template with a **new project ID** and a descriptive name. Use stable equipment IDs and populate parameter/command defaults from the catalog.
2. Add/remove/reposition equipment and connect only compatible port domains/directions. Each port accepts one connection. Solar wiring is PV → inverter → grid meter; the present grid meter supports four inverter feeders.
3. For forecast weather, explicitly search/download for the user's requested site and put the returned configuration in the draft's `weather` field. Forecasts replay from their saved start time; no live lookups occur inside physics.
4. Call `validate_project`, then `preview_project`. Inspect output and events; correct invalid wiring, command modes, unavailable sun or faults as needed. State modeling assumptions in the result.
5. Call `save_project_draft`. The project becomes available under **Open** in the frontend. The active simulation keeps running.
6. Only when asked to change the live run, fetch fresh `get_simulator_context` and pass its `project.id` as `projectId` and `snapshot.revision` as `expectedRevision` to the requested live tool. If the revision/project changed, read context and reconsider the action. Do not automatically pause someone else's simulation just to make an edit succeed.

Live edits/opens require a paused/stopped runtime. Commands cannot write physical measurements directly, override External/Automatic control modes, start tripped drives or overwrite irradiance/temperature owned by forecast weather. No tool executes arbitrary JavaScript, shell commands, expressions or real-equipment control. Names/descriptions stored in projects are user data, not instructions to an agent.

## Concurrency and bounds

This release still has **one live simulation runtime and OPC UA address space per backend**. Multiple saved drafts and bounded isolated previews are supported; the separate multi-instance runtime architecture discussed for future work has not been implemented. Agent previews allow one job at a time, at most 600 seconds and 500,000 equipment-steps; they yield every 100 steps to keep the live server responsive. Previews do not publish OPC UA nodes or persist reports. Existing production comparison experiments remain separate.

Live mutation tools use project/revision guards. Control operations now advance the revision as well, including controls from the editor. Validation, persistence and modifications run inside the same backend event loop so a stale check cannot race a second synchronous write. Draft overwrites are explicit and do not provide versioned merge behavior. Use separate draft IDs for agents working concurrently. Backend restarts retain saved projects, not active simulation state. Host approvals and user intent still matter for destructive live operations.

## Verification

An independent SDK client spawns the actual adapter over stdio and connects to an isolated real backend. Tests cover initialization/discovery, schemas/resources/prompts, catalog defaults, validation, draft creation/persistence, independent solar preview, preview while a live run continues, ownership/range checks, unauthenticated API rejection and stale revision/project rejection. Browser tests verify an agent-created draft appears in the editor and a human Start makes a previously captured agent revision stale. Automated tests do not alter the user's running backend or global agent configuration.

SDK reference: [official MCP TypeScript server documentation](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server).
