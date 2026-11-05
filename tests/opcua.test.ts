import { it, expect } from "vitest";
import {
  OPCUAClient,
  AttributeIds,
  DataType,
  StatusCodes,
  UserTokenType,
  ClientSubscription,
  ClientMonitoredItem,
  TimestampsToReturn,
  MessageSecurityMode,
  SecurityPolicy,
  OPCUACertificateManager,
} from "node-opcua";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import {hostname} from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Simulation } from "@twynix/simulation-core";
import { createOpcua } from "@twynix/opcua-server";
import { demo as baseDemo } from "../examples/water-treatment";
const demo = structuredClone(baseDemo);
demo.equipment.find((e) => e.id === "pump")!.mode = "manual";
it("independent OPC UA client browses, subscribes, validates writes, and retains NodeIds on restart", async () => {
  const folder = mkdtempSync(join(tmpdir(), "twynix-ua-"));
  const p = structuredClone(demo);
  p.equipment.find((e) => e.id === "pump")!.mode = "external";
  const sim = new Simulation(p);
  const options = {
    port: 14840,
    hostname: "localhost",
    dev: true,
    username: "operator",
    password: "test-password-1234",
    certificateDir: folder,
  };
  let ua = await createOpcua(sim, options);
  const clientCertificateManager = new OPCUACertificateManager({
    rootFolder: join(folder, "client"),
    automaticallyAcceptUnknownCertificate: true,
  });
  const node = "ns=2;s=project/water-treatment/equipment/tank/Level";
  let client = OPCUAClient.create({
    clientCertificateManager,
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 0 },
    clientName: "Twynix independent acceptance client",
  });
  try {
    await client.connect("opc.tcp://localhost:14840");
    let session = await client.createSession();
    const browse = await session.browse("ObjectsFolder");
    expect(browse.references?.some((r) => r.browseName.name === p.name)).toBe(
      true,
    );
    let code = await session.write({
      nodeId: "ns=2;s=project/water-treatment/equipment/pump/RunCommand",
      attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Boolean, value: true } },
    });
    expect(code.isGood()).toBe(false);
    await session.close();
    session = await client.createSession({
      type: UserTokenType.UserName,
      userName: options.username,
      password: options.password,
    });
    code = await session.write({
      nodeId: "ns=2;s=project/water-treatment/equipment/pump/SpeedSetpoint",
      attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Double, value: 101 } },
    });
    expect(code).toEqual(StatusCodes.BadOutOfRange);
    code = await session.write({
      nodeId: "ns=2;s=project/water-treatment/equipment/pump/RunCommand",
      attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Boolean, value: true } },
    });
    expect(code).toEqual(StatusCodes.Good);
    expect(sim.states["pump"].values["RunFeedback"]).toBe(false);
    const subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: 100,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      publishingEnabled: true,
    });
    const item = ClientMonitoredItem.create(
      subscription,
      { nodeId: node, attributeId: AttributeIds.Value },
      { samplingInterval: 100, queueSize: 20, discardOldest: true },
      TimestampsToReturn.Both,
    );
    const values: number[] = [];
    item.on("changed", (v) => values.push(Number(v.value.value)));
    const timer = setInterval(() => sim.step(), 25);
    await new Promise((r) => setTimeout(r, 1600));
    clearInterval(timer);
    expect(values.length).toBeGreaterThan(2);
    expect(values.at(-1)).toBeGreaterThan(values[0]);
    expect(Number(sim.states["tank"].values["Volume"])).toBeGreaterThan(1250);
    await subscription.terminate();
    await session.close();
    await client.disconnect();
    await ua.close();
    ua = await createOpcua(sim, options);
    client = OPCUAClient.create({
      clientCertificateManager,
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 },
    });
    await client.connect("opc.tcp://localhost:14840");
    const again = await client.createSession();
    expect(
      (await again.read({ nodeId: node, attributeId: AttributeIds.Value }))
        .statusCode,
    ).toEqual(StatusCodes.Good);
    await again.close();
  } finally {
    await client.disconnect();
    await ua.close();
    await clientCertificateManager.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
});

it("production profile requires encryption, trusted certificates and authenticated operator writes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "twynix-secure-"));
  const p = structuredClone(demo);
  p.equipment.find((e) => e.id === "pump")!.mode = "external";
  const sim = new Simulation(p);
  const password = "secure-test-password-1234";
  const ua = await createOpcua(sim, {
    port: 14842,
    hostname: "localhost",
    dev: false,
    username: "operator",
    password,
    certificateDir: join(folder, "server"),
  });
  const cm = new OPCUACertificateManager({
    rootFolder: join(folder, "client"),
    automaticallyAcceptUnknownCertificate: false,
  });
  await cm.initialize();
  const certificateFile = join(
    folder,
    "client",
    "own",
    "certs",
    "self_signed_certificate.pem",
  );
  await cm.createSelfSignedCertificate({
    outputFile: certificateFile,
    subject: "/CN=Twynix secure acceptance",
    applicationUri: `urn:${hostname()}:NodeOPCUA-Client`,
    dns: ["localhost"],
    startDate: new Date(Date.now() - 60000),
    validity: 365,
  });

  await ua.server.serverCertificateManager.trustCertificate(
    new X509Certificate(readFileSync(certificateFile)).raw,
  );
  await cm.trustCertificate(ua.server.getCertificate());
  const endpoints = ua.server.endpoints.flatMap((e) =>
    e.endpointDescriptions(),
  );
  expect(
    endpoints.filter(e=>e.securityMode!==MessageSecurityMode.None).every(
      (e) => e.securityMode === MessageSecurityMode.SignAndEncrypt,
    ),
  ).toBe(true);
  const client = OPCUAClient.create({
    clientCertificateManager: cm,
    certificateFile,
    privateKeyFile: cm.privateKey,
    endpointMustExist: false,
    securityMode: MessageSecurityMode.SignAndEncrypt,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    connectionStrategy: { maxRetry: 0 },
  });
  try {
    await client.connect("opc.tcp://localhost:14842");
    await expect(client.createSession()).rejects.toThrow();
    await expect(
      client.createSession({
        type: UserTokenType.UserName,
        userName: "operator",
        password: "wrong",
      }),
    ).rejects.toThrow();
    const session = await client.createSession({
      type: UserTokenType.UserName,
      userName: "operator",
      password,
    });
    const code = await session.write({
      nodeId: "ns=2;s=project/water-treatment/equipment/pump/RunCommand",
      attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Boolean, value: true } },
    });
    expect(code).toEqual(StatusCodes.Good);
    await session.close();
  } finally {
    await client.disconnect();
    await ua.close();
    await cm.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
});
