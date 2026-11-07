import { it, expect } from "vitest";
import {
  OPCUAClient,
  OPCUACertificateManager,
  AttributeIds,
  DataType,
  UserTokenType,
  ClientSubscription,
  ClientMonitoredItem,
  TimestampsToReturn,
  StatusCodes,
  type DataValue,
} from "node-opcua";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Simulation } from "@twynix/simulation-core";
import { createOpcua } from "@twynix/opcua-server";
import { definitions } from "@twynix/equipment-models";
import { solarDemo } from "../examples/solar-farm";
import { weatherFixture } from "./weather-fixture";
import type { Project } from "@twynix/shared-types";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

it("OPC UA browses solar devices, publishes live KACO-style telemetry and validates inverter controls", async () => {
  const folder = mkdtempSync(join(tmpdir(), "twynix-solar-ua-"));
  const sim = new Simulation(solarDemo);
  const ua = await createOpcua(sim, {
    port: 14842,
    hostname: "localhost",
    dev: true,
    username: "operator",
    password: "solar-test-password-123",
    certificateDir: folder,
  });
  const manager = new OPCUACertificateManager({
    rootFolder: join(folder, "client"),
    automaticallyAcceptUnknownCertificate: true,
  });
  const client = OPCUAClient.create({
    clientCertificateManager: manager,
    endpointMustExist: false,
    connectionStrategy: { maxRetry: 0 },
  });
  const node = (id: string, tag: string) =>
    `ns=2;s=project/solar-farm/equipment/${id}/${tag}`;
  try {
    await client.connect("opc.tcp://localhost:14842");
    const anonymous = await client.createSession();
    const area = await anonymous.browse("ns=2;s=project/solar-farm/area");
    expect(area.references?.map((r) => r.browseName.name)).toEqual(
      solarDemo.equipment.map((e) => e.tag),
    );
    const tags = await anonymous.browse(
      "ns=2;s=project/solar-farm/equipment/inv1",
    );
    expect(tags.references?.map((r) => r.browseName.name)).toEqual(
      expect.arrayContaining([
        "ACPower",
        "DCVoltage",
        "Energy",
        "OperatingState",
        "FaultActive",
        "RunCommand",
        "PowerLimitPercent",
      ]),
    );
    const denied = await anonymous.write({
      nodeId: node("inv1", "PowerLimitPercent"),
      attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Double, value: 40 } },
    });
    expect(denied.isGood()).toBe(false);
    await anonymous.close();
    const session = await client.createSession({
      type: UserTokenType.UserName,
      userName: "operator",
      password: "solar-test-password-123",
    });
    const write = (id: string, tag: string, value: number | boolean) =>
      session.write({
        nodeId: node(id, tag),
        attributeId: AttributeIds.Value,
        value: {
          value: {
            dataType:
              typeof value === "boolean" ? DataType.Boolean : DataType.Double,
            value,
          },
        },
      });
    const subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: 100,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });
    const monitor = ClientMonitoredItem.create(
      subscription,
      { nodeId: node("inv1", "ACPower"), attributeId: AttributeIds.Value },
      { samplingInterval: 100, discardOldest: true, queueSize: 10 },
      TimestampsToReturn.Both,
    );
    let observed = -1;
    monitor.on("changed", (data: DataValue) => {
      observed = Number(data.value.value);
    });
    await new Promise<void>((resolve, reject) => {
      monitor.once("initialized", resolve);
      monitor.once("err", reject);
    });
    for (let i = 0; i < 250; i++) sim.step();
    await expect.poll(() => observed).toBeGreaterThan(80);
    const all = solarDemo.equipment.flatMap((e) =>
      definitions[e.type].tags.map((t) => ({ e, t })),
    );
    const values = await session.read(
      all.map(({ e, t }) => ({
        nodeId: node(e.id, t.name),
        attributeId: AttributeIds.Value,
      })),
    );
    for (const [i, data] of values.entries()) {
      const { e, t } = all[i];
      expect(data.statusCode.isGood(), `${e.tag}.${t.name}`).toBe(true);
      expect(data.value.dataType).toBe(
        t.type === "boolean" ? DataType.Boolean : DataType.Double,
      );
      expect(data.value.value).toEqual(
        t.writable
          ? sim.project.equipment.find((item) => item.id === e.id)!.commands[
              t.name
            ]
          : sim.states[e.id].values[t.name],
      );
      expect(data.sourceTimestamp).toEqual(sim.sourceTimestamp);
    }
    expect((await write("inv1", "PowerLimitPercent", 40)).isGood()).toBe(true);
    expect((await write("inv1", "PowerLimitEnabled", true)).isGood()).toBe(
      true,
    );
    sim.step();
    expect(sim.states["inv1"].values["ACPower"]).toBe(40);
    await expect.poll(() => observed).toBe(40);
    expect(Number(sim.states["inv2"].values["ACPower"])).toBeGreaterThan(100);
    const summary = await session.read({
      nodeId: "ns=2;s=project/solar-farm/simulation/SolarACPower",
      attributeId: AttributeIds.Value,
    });
    expect(summary.value.value).toBe(sim.solarMetrics()?.acPower);
    expect(await write("inv1", "PowerLimitPercent", 101)).toEqual(
      StatusCodes.BadOutOfRange,
    );
    expect((await write("inv1", "ACPower", 1)).isGood()).toBe(false);
    expect((await write("grid", "GridConnected", false)).isGood()).toBe(false);
    expect((await write("inv1", "RunCommand", false)).isGood()).toBe(true);
    sim.step();
    expect(sim.states["inv1"].values["ACPower"]).toBe(0);
    sim.fault("inv1", "trip", true);
    sim.step();
    expect((await write("inv1", "RunCommand", true)).isGood()).toBe(false);
    const fault = await session.read({
      nodeId: node("inv1", "FaultActive"),
      attributeId: AttributeIds.Value,
    });
    expect(fault.value.value).toBe(true);
    const storedNode = node("inv1", "ACPower");
    const configurationNode =
      "ns=2;s=project/solar-farm/simulation/WeatherConfiguration";
    expect(
      (await session.read({ nodeId: configurationNode })).value.value,
    ).toBe("null");
    sim.control("stop");
    const renamed: Project = {
      ...structuredClone(solarDemo),
      weather: structuredClone(weatherFixture),
    };
    renamed.equipment.find((e) => e.id === "inv1")!.tag = "INV-RENAMED";
    sim.replace(renamed);
    ua.rebuild();
    const configuration = await session.read({ nodeId: configurationNode });
    expect(configuration.value.dataType).toBe(DataType.String);
    expect(JSON.parse(String(configuration.value.value))).toEqual(
      weatherFixture,
    );
    expect(
      (
        await session.write({
          nodeId: configurationNode,
          attributeId: AttributeIds.Value,
          value: { value: { dataType: DataType.String, value: "null" } },
        })
      ).isGood(),
    ).toBe(false);
    expect(
      (
        await session.read({
          nodeId: storedNode,
          attributeId: AttributeIds.Value,
        })
      ).statusCode.isGood(),
    ).toBe(true);
    sim.step();
    const conditions = sim.weatherConditions()!;
    const names = [
      "ForecastWeatherActive",
      "ForecastExhausted",
      "WeatherUnixTime",
      "WeatherIrradiance",
      "WeatherTemperature",
      "WeatherCloudCover",
      "SunElevation",
      "SunAzimuth",
    ];
    const weatherValues = await session.read(
      names.map((name) => ({
        nodeId: `ns=2;s=project/solar-farm/simulation/${name}`,
        attributeId: AttributeIds.Value,
      })),
    );
    expect(weatherValues.every((value) => value.statusCode.isGood())).toBe(
      true,
    );
    expect(weatherValues.map((value) => value.value.value)).toEqual([
      true,
      false,
      Date.parse(conditions.time) / 1000,
      conditions.irradiance,
      conditions.temperature,
      conditions.cloudCover,
      conditions.sunElevation,
      conditions.sunAzimuth,
    ]);
    const changed = structuredClone(renamed);
    changed.weather!.site.name = "Changed farm location";
    changed.weather!.forecast!.samples[0].cloudCover = 75;
    sim.replace(changed);
    ua.rebuild();
    expect(
      JSON.parse(
        String((await session.read({ nodeId: configurationNode })).value.value),
      ),
    ).toEqual(changed.weather);
    changed.weather!.mode = "manual";
    sim.replace(changed);
    ua.rebuild();
    expect(
      JSON.parse(
        String((await session.read({ nodeId: configurationNode })).value.value),
      ),
    ).toEqual(changed.weather);
    const cleared = structuredClone(solarDemo);
    delete cleared.weather;
    sim.replace(cleared);
    ua.rebuild();
    expect(
      (await session.read({ nodeId: configurationNode })).value.value,
    ).toBe("null");
    await subscription.terminate();
    await session.close();
  } finally {
    await client.disconnect();
    await manager.dispose();
    await ua.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it("keeps an existing trusted OPC UA application identity after a host rename", async () => {
  const folder = mkdtempSync(join(tmpdir(), "twynix-identity-"));
  const manager = new OPCUACertificateManager({ rootFolder: folder });
  await manager.initialize();
  const file = join(folder, "own/certs/certificate.pem");
  const legacyUri = "urn:previous-host:NodeOPCUA-Server";
  await manager.createSelfSignedCertificate({
    outputFile: file,
    subject: "/CN=Existing Twynix server",
    applicationUri: legacyUri,
    dns: ["localhost"],
    startDate: new Date(Date.now() - 60000),
    validity: 365,
  });
  const fingerprint = new X509Certificate(readFileSync(file)).fingerprint256;
  await manager.dispose();
  const ua = await createOpcua(new Simulation(solarDemo), {
    port: 14844,
    hostname: "localhost",
    dev: false,
    username: "operator",
    password: "solar-test-password-123",
    certificateDir: folder,
  });
  try {
    expect(ua.server.serverInfo.applicationUri).toBe(legacyUri);
    expect(new X509Certificate(ua.server.getCertificate()).fingerprint256).toBe(
      fingerprint,
    );
    expect(
      ua.server.endpoints
        .flatMap((e) => e.endpointDescriptions())
        .every((e) => e.server.applicationUri === legacyUri),
    ).toBe(true);
  } finally {
    await ua.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
