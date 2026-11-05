import {
  OPCUAServer,
  MessageSecurityMode,
  SecurityPolicy,
  DataType,
  Variant,
  StatusCodes,
  DataValue,
  OPCUACertificateManager,
  UserNameIdentityToken,
  makeAccessLevelFlag,
  PermissionType,
  WellKnownRoles,
  resolveNodeId,
  type UAVariable,
  type UAObject,
} from "node-opcua";
import type { Simulation } from "@twynix/simulation-core";
import { definitions } from "@twynix/equipment-models";
export interface UaOptions {
  port: number;
  hostname: string;
  dev: boolean;
  username: string;
  password: string;
  certificateDir: string;
}
export async function createOpcua(sim: Simulation, options: UaOptions) {
  if (!options.dev && options.password.length < 12)
    throw Error(
      "Set OPCUA_PASSWORD to at least 12 characters, or explicitly opt into OPCUA_DEV=true locally",
    );
  const certificateManager = new OPCUACertificateManager({
    rootFolder: options.certificateDir,
    automaticallyAcceptUnknownCertificate: options.dev,
  });
  const server = new OPCUAServer({
    port: options.port,
    hostname: options.hostname,
    alternateHostname: [options.hostname],
    resourcePath: "",
    serverCertificateManager: certificateManager,
    userCertificateManager: certificateManager,
    buildInfo: {
      productName: "Twynix Factory Simulator",
      manufacturerName: "Twynix",
      softwareVersion: "0.1.0",
    },
    allowAnonymous: options.dev,
    securityPolicies: options.dev
      ? [SecurityPolicy.None, SecurityPolicy.Basic256Sha256]
      : [SecurityPolicy.Basic256Sha256],
    securityModes: options.dev
      ? [MessageSecurityMode.None, MessageSecurityMode.SignAndEncrypt]
      : [MessageSecurityMode.SignAndEncrypt],
    userManager: {
      isValidUser: (user: string, password: string) =>
        user === options.username &&
        password === options.password &&
        password.length >= 12,
      getUserRoles: (user) => [
        resolveNodeId(
          user === options.username
            ? WellKnownRoles.Operator
            : WellKnownRoles.Anonymous,
        ),
      ],
    },
  });
  await server.initialize();
  const addressSpace = server.engine.addressSpace!;
  const ns = addressSpace.registerNamespace("urn:twynix:factory-simulator");
  let root: UAObject | undefined;
  const variables = new Map<string, UAVariable>();
  const nodeId = (id: string, tag?: string) =>
    `s=project/${sim.project.id}/equipment/${id}${tag ? "/" + tag : ""}`;
  function rebuild() {
    variables.clear();
    if (root) addressSpace.deleteNode(root);
    root = ns.addObject({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: sim.project.name,
      nodeId: `s=project/${sim.project.id}`,
    });
    const area = ns.addObject({
      componentOf: root,
      browseName: "ProcessArea01",
      nodeId: `s=project/${sim.project.id}/area`,
    });
    for (const e of sim.project.equipment) {
      const obj = ns.addObject({
        componentOf: area,
        browseName: e.tag,
        nodeId: nodeId(e.id),
      });
      for (const t of definitions[e.type].tags) {
        const variable = ns.addVariable({
          componentOf: obj,
          browseName: t.name,
          nodeId: nodeId(e.id, t.name),
          dataType: t.type === "boolean" ? "Boolean" : "Double",
          description: `${t.name}${t.unit ? " [" + t.unit + "]" : ""}`,
          minimumSamplingInterval: 100,
          accessLevel: makeAccessLevelFlag(
            t.writable ? "CurrentRead | CurrentWrite" : "CurrentRead",
          ),
          userAccessLevel: makeAccessLevelFlag(
            t.writable ? "CurrentRead | CurrentWrite" : "CurrentRead",
          ),
          rolePermissions: [
            {
              roleId: resolveNodeId(WellKnownRoles.Anonymous),
              permissions: PermissionType.Browse | PermissionType.Read,
            },
            {
              roleId: resolveNodeId(WellKnownRoles.Operator),
              permissions:
                PermissionType.Browse |
                PermissionType.Read |
                (t.writable ? PermissionType.Write : 0),
            },
          ],
        });
        variable.bindVariable(
          {
            timestamped_get: () => {
              const state = sim.states[e.id];
              const value = t.writable
                ? sim.project.equipment.find((x) => x.id === e.id)?.commands[
                    t.name
                  ]
                : state?.values[t.name];
              return new DataValue({
                value: new Variant({
                  dataType:
                    t.type === "boolean" ? DataType.Boolean : DataType.Double,
                  value: value ?? (t.type === "boolean" ? false : 0),
                }),
                sourceTimestamp: sim.sourceTimestamp,
                statusCode:
                  state?.quality === "Bad"
                    ? StatusCodes.BadSensorFailure
                    : state?.quality === "Uncertain"
                      ? StatusCodes.UncertainSensorNotAccurate
                      : StatusCodes.Good,
              });
            },
            timestamped_set: (data, callback, context) => {
              const identity = context?.session?.userIdentityToken;
              if (
                !(identity instanceof UserNameIdentityToken) ||
                identity.userName !== options.username
              ) {
                callback(null, StatusCodes.BadUserAccessDenied);
                return;
              }
              if (!t.writable) {
                callback(null, StatusCodes.BadNotWritable);
                return;
              }
              if (
                data.value.dataType !==
                (t.type === "boolean" ? DataType.Boolean : DataType.Double)
              ) {
                callback(null, StatusCodes.BadTypeMismatch);
                return;
              }
              try {
                sim.submit(
                  e.id,
                  t.name,
                  data.value.value as number | boolean,
                  "opcua",
                );
                callback(null, StatusCodes.Good);
              } catch (error) {
                const message = String(error);
                callback(
                  null,
                  message.includes("mode")
                    ? StatusCodes.BadNotWritable
                    : message.includes("range")
                      ? StatusCodes.BadOutOfRange
                      : StatusCodes.BadInvalidState,
                );
              }
            },
          },
          true,
        );
        variables.set(`${e.id}/${t.name}`, variable);
      }
    }
    const control = ns.addObject({
      componentOf: root,
      browseName: "Simulation",
      nodeId: `s=project/${sim.project.id}/simulation`,
    });
    for (const [name, type, get] of [
      ["Running", DataType.Boolean, () => sim.status === "running"],
      ["SimulationTime", DataType.Double, () => sim.time],
      ["SpeedMultiplier", DataType.Double, () => sim.speed],
    ] as const)
      ns.addVariable({
        componentOf: control,
        browseName: name,
        nodeId: `s=project/${sim.project.id}/simulation/${name}`,
        minimumSamplingInterval: 100,
        dataType: type === DataType.Boolean ? "Boolean" : "Double",
        value: { get: () => new Variant({ dataType: type, value: get() }) },
      });
  }
  rebuild();
  await server.start();
  sim.opcua = {
    endpoint: `opc.tcp://${options.hostname}:${options.port}`,
    sessions: 0,
    running: true,
    secure: !options.dev,
  };
  server.on("create_session", () => {
    sim.opcua.sessions = server.currentSessionCount;
    sim.event("OPC UA client connected");
  });
  server.on("session_closed", () => {
    sim.opcua.sessions = server.currentSessionCount;
    sim.event("OPC UA session closed");
  });
  return {
    server,
    rebuild,
    async close() {
      sim.opcua.running = false;
      await server.shutdown(200);
      await certificateManager.dispose();
    },
  };
}
