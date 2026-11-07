# Solar farm and KACO-style inverter tags

Open **Solar farm · KACO NX3** from the simulator equipment sidebar and press **Start**. The example is `solar-farm`: three PV panel fields (140 + 160 + 160 kWp DC), a blueplanet 100 NX3 and two blueplanet 125 NX3 inverters (350 kW AC total), and a grid meter with a 10 kW site load. Each inverter has its own DC supply and independent commands/faults. The grid meter has four AC feeder ports; unused ports are allowed. Electrical connections are validated as PV array → inverter → grid meter. A disconnected inverter cannot generate AC output.

This is a deterministic engineering simulation with the most useful KACO-style measurements and controls, published through **OPC UA**. It does not implement Modbus, KACO firmware, vendor-specific register maps, or electrical protection certification. No connection to real equipment is made.

## Connect Twynix

Use the existing simulator OPC UA endpoint, **`opc.tcp://localhost:4840`** by default. Browse **Objects → Solar Farm · KACO NX3 → ProcessArea01 → INV-101 / INV-102 / INV-103 / GM-101**. Equipment IDs are `inv1`, `inv2`, `inv3`, `grid`, and `pv1`–`pv3`. Namespaces are unchanged (`urn:twynix:factory-simulator`, currently namespace index 2); discover the namespace index instead of assuming it in an external client.

For example:

`ns=2;s=project/solar-farm/equipment/inv1/ACPower`

Other inverter values use the same prefix with the tag below appended. The I/O signals view can search equipment/tag names and copy every exact NodeId. Equipment IDs remain stable when renaming tags or moving symbols.

The existing secure connection rules apply: Basic256Sha256, SignAndEncrypt, mutual certificate trust, and the configured operator username/password in the local `.env` file. Do not copy credentials into project JSON or frontend configuration. `OPCUA_DEV=true` explicitly enables anonymous local reads for development; writes still need the configured authenticated operator. Opening the example adds it to the server's current address space, replacing the active project's nodes. It does not configure a Twynix backend or device mapping automatically.

New servers use a stable application URI independent of the computer name. Existing installations retain the URI embedded in their existing certificate, preserving client trust after a host rename; certificates are not automatically replaced. Use a hostname covered by that certificate (the local profile includes `localhost`).

## Inverter tags

All numeric variables are OPC UA **Double**, already in engineering units; there are no Modbus scale factors. Boolean variables use **Boolean**. Measurements are read-only. In the example, inverters are in **External** mode so authenticated OPC UA clients own their commands. Switch to Manual while paused to operate those commands from the simulator UI.

| Tag | Unit/type | Meaning |
| --- | --- | --- |
| ACPower | kW | Generated active power |
| ACVoltage | V | Balanced line-to-line grid voltage |
| ACCurrent | A | Current per phase |
| ApparentPower | kVA | Apparent power, with unity power factor in this model |
| ReactivePower | kvar | Zero; reactive-power control is outside this model |
| PowerFactor | ratio | 1 while generating, 0 while off |
| Frequency | Hz | Connected grid frequency |
| DCPower | kW | Drawn DC input power, after clipping/curtailment |
| DCVoltage | V | Aggregate array operating voltage |
| DCCurrent | A | Aggregate drawn DC current |
| RatedPower | kW | 100 or 125 kW |
| Temperature | °C | Simplified inverter thermal state |
| Energy | kWh | Generated AC energy since simulation reset |
| Efficiency | % | Configured conversion efficiency while generating |
| GridAvailable | Boolean | Connected grid inside the modeled operating bounds |
| RunFeedback | Boolean | Currently generating nonzero AC power |
| FaultActive | Boolean | Trip or injected overheat |
| OperatingState | enum as Double | 1 off, 2 sleeping, 3 starting, 4 generating, 5 limited, 7 fault, 8 standby |
| EventFlags | bitfield as Double | Bit 4 grid unavailable, bit 7 injected overheat, bit 15 injected trip |
| StartupElapsed | s | Current uninterrupted grid/DC qualification time |
| RunCommand | Boolean, writable | Connect/enable intent; cannot override grid/DC interlocks |
| PowerLimitPercent | %, writable | 0–100% of rated AC power |
| PowerLimitEnabled | Boolean, writable | Apply the active-power limit |

To curtail INV-101 to 50 kW, write Double `50` to `inv1/PowerLimitPercent` and Boolean `true` to `inv1/PowerLimitEnabled`. Writes are accepted commands; feedback follows the next fixed simulation step. Invalid ranges, types, control ownership and tripped starts are rejected. Stop commands and grid loss drop generation immediately; restart requires the qualification interval again. A simulation pause freezes physics and energy, while the OPC UA server remains accessible. Simulation reset clears accumulated energy and restores baseline commands/faults.

## Panel and grid-meter tags

Each PV array publishes `Irradiance` (W/m²), `CellTemperature` (°C), `AvailablePower` (kW), `DCPower` (kW), `DCVoltage` (V) and `DCCurrent` (A). Manual commands `IrradianceSetpoint` (0–1400 W/m²), `AmbientTemperature` (−40–65 °C) and `ShadingPercent` (0–100%) change the weather/field conditions without resetting the simulation. Switch an array to External mode while paused to command those settings through OPC UA instead.

The optional **Weather & location** view replaces synthetic/manual sunlight and air temperature with a saved location-based forecast. `AirTemperature` (°C) exposes the actual air temperature used. Forecast mode owns irradiance and air temperature, rejecting writes to those two manual setpoints; field shading remains adjustable. See [weather configuration and OPC UA weather tags](weather.md).

The meter publishes `Generation`, `ExportPower`, `ACCurrent`, `ExportEnergy`, `ImportEnergy`, `GridAvailable` and `FaultActive`. `ExportPower` is **positive for export**, negative for import. Energy is in kWh. In Manual mode its `GridConnected`, `GridVoltage`, `GridFrequency` and `SiteLoad` commands simulate grid conditions and local consumption. Switch it to External mode to control these through OPC UA. A grid-meter trip or grid loss shuts down every connected inverter. No islanded supply is modeled.

Farm totals are also read-only under `ns=2;s=project/solar-farm/simulation/`: `SolarDCPower` (kW), `SolarACPower` (kW), `GridExportPower` (kW), `SolarEnergy` (kWh), and `InvertersOnline` (count). These same values drive the live canvas readings.

## Modeling assumptions and validation

The backend advances exactly 100 ms at a time. Effective irradiance combines the commanded level, a repeatable sinusoidal cloud attenuation and field shading. Set `cloudDepth=0` for constant sun. Array STC power scales by irradiance and a configurable temperature coefficient; cell temperature follows a simple NOCT relationship. The inverter consumes only the DC power needed for its AC output. Output is bounded by available DC times efficiency, nameplate rating, enabled power limit, and a linear thermal derating envelope. DC power not harvested because of clipping or curtailment is available energy, not exported energy.

Defaults use 98.7% constant conversion efficiency, 400 V three-phase / 50 Hz, 700 V nominal array voltage, a 10 s qualification interval and a 5 s full-scale upward ramp. Startup/ramping and the first-order inverter temperature/linear derating law are simulation assumptions, not an exact recreation of KACO protection firmware or efficiency curves. The model uses aggregate DC values rather than separate measurements for each of the NX3's MPPT channels. It does not solve I–V curves, string mismatch/bypass diodes, cable/transformer losses, unbalanced phases, harmonic effects, dynamic grid transients, anti-islanding certification, or reactive-power control. Current grid availability checks use the 305–560 V and 45–65 Hz technical operating ranges, not country-specific protection settings. Fault schedules support repeatable trips/overheat windows; background production comparisons still require a manufacturing line.

Tests verify DC/AC conservation, accumulated energy, nameplate clipping, independent curtailment, startup timing, grid loss/recovery, night import, shading, thermal derating, fault handling and deterministic replay. An independent OPC UA client browses the devices, checks every declared tag's type/value/timestamp, observes subscriptions, writes curtailment/stop commands, and checks permissions/interlocks. Browser checks cover the solar drawing, live readings, shading controls, I/O mapping and fullscreen view. End-to-end ingestion into a particular Twynix installation is separate from these server/client checks.

## ThingsBoard integration

ThingsBoard 4.4 OPC UA integration has been checked with the solar example over Basic256Sha256 using username authentication and a trusted client certificate. It discovers three PV fields, three inverters, the grid meter and the Simulation object. This is an interoperability check, not vendor certification.

For this version, upload the PKCS12 client bundle as Base64 text: the OPC UA loader Base64-decodes the uploaded file content. Uploading raw binary produces an `EOFException` while loading the keystore. Keep the keystore alias, store password and key password aligned with the bundle. Trust the client certificate in the simulator and set `OPCUA_HOST` to an address reachable from ThingsBoard. Keep private keys, passwords and generated bundles outside Git.

Configure an uplink converter and relative tag subscriptions for the equipment and Simulation objects. No downlink converter is required for telemetry collection. When the simulation is stopped, initial power and energy readings can be zero.

## Source references

- [KACO NX3 Modbus protocol application note](https://kaco-newenergy.com/index.php?eID=dumpFile&f=17308&t=f&token=6b2198e9a80d369c7aaa1236bb74c4477fe2179d): reference for the SunSpec monitoring/control vocabulary and status semantics only; transport here is OPC UA.
- [KACO NX3 extended technical data](https://kaco-newenergy.com/index.php?eID=dumpFile&f=11218&t=f&token=772ea8aca660dcd34121ea0a1bf2e7030c53bf8f): nominal ratings/efficiency context. The implemented thermal law is explicitly simplified.
- [Official SunSpec three-phase inverter model](https://github.com/sunspec/models/blob/master/json/model_103.json): measurement vocabulary and common operating-state/event meanings.
