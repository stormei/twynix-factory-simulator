import { describe, it, expect } from "vitest";
import { Simulation } from "@twynix/simulation-core";
import { weatherSchema, projectSchema } from "@twynix/shared-types";
import { solarDemo } from "../examples/solar-farm";
import {
  sunPosition,
  weatherAt,
} from "../packages/simulation-core/src/weather";
import { WeatherService } from "../apps/server/src/weather";
import { weatherFixture, forecastResponse } from "./weather-fixture";

const project = () => ({
  ...structuredClone(solarDemo),
  weather: structuredClone(weatherFixture),
});
describe("location and forecast replay", () => {
  it("calculates geometric sunlight for season, latitude, longitude and UTC time", () => {
    const time = Date.UTC(2026, 5, 21, 12) / 1000;
    expect(sunPosition(time, 60, 0).elevation).toBeGreaterThan(53);
    expect(
      sunPosition(Date.UTC(2026, 11, 21, 12) / 1000, 60, 0).elevation,
    ).toBeLessThan(8);
    expect(sunPosition(time - 12 * 3600, 60, 0).elevation).toBeLessThan(0);
    expect(sunPosition(time, 80, 0).elevation).toBeGreaterThan(30);
    expect(sunPosition(time - 12 * 3600, 80, 0).elevation).toBeGreaterThan(0);
    expect(
      Math.abs(
        sunPosition(time, 0, 0).elevation -
          sunPosition(time - 8 * 3600, 0, 120).elevation,
      ),
    ).toBeLessThan(0.2);
    expect(
      sunPosition(Date.UTC(2026, 2, 20, 12) / 1000, 0, 0).elevation,
    ).toBeGreaterThan(87);
  });
  it("interpolates downloaded panel irradiance and temperature once, preserving field shading", () => {
    const p = project();
    p.weather.startTime = "2026-06-21T10:30:00.000Z";
    for (const e of p.equipment.filter((e) => e.type === "pv-array")) {
      e.parameters["cloudDepth"] = 1;
      e.commands["ShadingPercent"] = 20;
    }
    const s = new Simulation(p);
    s.step();
    expect(s.states["pv1"].values["Irradiance"]).toBeCloseTo(770 * 0.8);
    expect(s.states["pv1"].values["AirTemperature"]).toBe(19.75);
    expect(s.states["pv1"].values["CellTemperature"]).toBeCloseTo(
      19.75 + (25 * 616) / 800,
    );
    expect(s.weatherConditions()?.cloudCover).toBeCloseTo(21.5000833);
    expect(s.weatherConditions()?.sunAzimuth).toBeGreaterThan(150);
  });
  it("forces night output to zero even when an imported radiation sample is positive", () => {
    const p = project();
    const start = Date.UTC(2026, 11, 21, 0) / 1000;
    p.weather.startTime = new Date(start * 1000).toISOString();
    p.weather.forecast!.samples = [0, 1, 2].map((i) => ({
      time: start + i * 3600,
      irradiance: 900,
      temperature: -5,
      cloudCover: 0,
    }));
    const s = new Simulation(p);
    for (let i = 0; i < 300; i++) s.step();
    expect(s.weatherConditions()?.irradiance).toBe(0);
    expect(s.solarMetrics()?.acPower).toBe(0);
    expect(s.states["inv1"].status).toBe("sleeping");
  });
  it("replays offline deterministically, pauses at the horizon and freezes weather when paused", () => {
    const s = new Simulation(project());
    s.control("start", 5);
    s.advance(1);
    expect(s.time).toBe(5);
    expect(s.weatherConditions()?.time).toBe("2026-06-21T10:00:05.000Z");
    s.control("pause");
    const weather = s.weatherConditions();
    s.advance(1);
    expect(s.weatherConditions()).toEqual(weather);
    s.reset();
    for (let i = 0; i < 500; i++) s.step();
    const first = structuredClone(s.states);
    s.reset();
    for (let i = 0; i < 500; i++) s.step();
    expect(s.states).toEqual(first);
    const p = project();
    p.weather.startTime = new Date(
      (p.weather.forecast!.samples.at(-1)!.time - 0.2) * 1000,
    ).toISOString();
    const end = new Simulation(p);
    end.control("start");
    end.advance(1);
    expect(end.status).toBe("paused");
    expect(end.time).toBe(0.2);
    expect(
      end.events.filter((e) =>
        e.message.startsWith("Saved weather forecast ended"),
      ),
    ).toHaveLength(1);
    expect(end.weatherConditions()?.exhausted).toBe(true);
  });
  it("validates imported weather and rejects manual or external overrides owned by forecasts", () => {
    const s = new Simulation(project());
    expect(() => s.submit("pv1", "IrradianceSetpoint", 900, "ui")).toThrow(
      /Forecast weather owns/,
    );
    s.project.equipment.find((e) => e.id === "pv1")!.mode = "external";
    expect(() => s.submit("pv1", "AmbientTemperature", 30, "opcua")).toThrow(
      /Forecast weather owns/,
    );
    expect(() => s.submit("pv1", "ShadingPercent", 10, "opcua")).not.toThrow();
    const p = project();
    p.weather.mode = "manual";
    const manual = new Simulation(p);
    expect(manual.weatherConditions()).toBeNull();
    expect(() =>
      manual.submit("pv1", "IrradianceSetpoint", 500, "ui"),
    ).not.toThrow();
    const invalid = structuredClone(weatherFixture);
    invalid.site.latitude = 91;
    expect(weatherSchema.safeParse(invalid).success).toBe(false);
    const gap = structuredClone(weatherFixture);
    gap.forecast!.samples[1].time += 1;
    expect(weatherSchema.safeParse(gap).success).toBe(false);
    const range = structuredClone(weatherFixture);
    range.startTime = "2026-01-01T00:00:00Z";
    expect(weatherSchema.safeParse(range).success).toBe(false);
    expect(
      weatherSchema.safeParse({ ...weatherFixture, forecast: undefined })
        .success,
    ).toBe(false);
    expect(projectSchema.safeParse(solarDemo).success).toBe(true);
  });
});

describe("forecast download boundary", () => {
  it("uses fixed provider URLs, panel direction conversion, exact units and cached retrieval timestamps", async () => {
    let now = Date.parse("2026-06-21T10:15:00Z");
    const urls: URL[] = [];
    const service = new WeatherService(
      async (url, options) => {
        urls.push(url);
        expect(options.redirect).toBe("error");
        expect(options.signal).toBeDefined();
        return Response.json(forecastResponse());
      },
      () => now,
    );
    const result = await service.forecast(weatherFixture.site);
    expect(urls[0].origin).toBe("https://api.open-meteo.com");
    expect(urls[0].searchParams.get("azimuth")).toBe("0");
    expect(urls[0].searchParams.get("tilt")).toBe("30");
    expect(urls[0].searchParams.get("hourly")).toContain(
      "global_tilted_irradiance_instant",
    );
    expect(result.startTime).toBe("2026-06-21T10:00:00.000Z");
    now += 10 * 60000;
    const cached = await service.forecast(weatherFixture.site);
    expect(urls).toHaveLength(1);
    expect(cached.forecast?.fetchedAt).toBe(result.forecast?.fetchedAt);
    await service.forecast({ ...weatherFixture.site, azimuth: 90 });
    expect(urls[1].searchParams.get("azimuth")).toBe("-90");
    await expect(
      service.forecast({ ...weatherFixture.site, longitude: 181 }),
    ).rejects.toThrow();
    expect(urls).toHaveLength(2);
  });
  it("rejects missing/null/mismatched forecasts and failures without producing partial configuration", async () => {
    const invalid = forecastResponse();
    invalid.hourly.temperature_2m.pop();
    await expect(
      new WeatherService(async () => Response.json(invalid)).forecast(
        weatherFixture.site,
      ),
    ).rejects.toThrow(/incomplete/);
    await expect(
      new WeatherService(async () => Response.json({ hourly: {} })).forecast(
        weatherFixture.site,
      ),
    ).rejects.toThrow();
    await expect(
      new WeatherService(
        async () => new Response("down", { status: 503 }),
      ).forecast(weatherFixture.site),
    ).rejects.toThrow(/503/);
    await expect(
      new WeatherService(async () => {
        throw new DOMException("late", "TimeoutError");
      }).forecast(weatherFixture.site),
    ).rejects.toThrow(/timed out/);
    await expect(
      new WeatherService(async () => new Response("x".repeat(500001))).forecast(
        weatherFixture.site,
      ),
    ).rejects.toThrow(/too large/);
  });
  it("searches locations explicitly and validates provider coordinates", async () => {
    let requested = "";
    const service = new WeatherService(async (url) => {
      requested = url.toString();
      return Response.json({
        results: [
          {
            name: "Oslo",
            admin1: "Oslo",
            country: "Norway",
            latitude: 59.9,
            longitude: 10.75,
          },
        ],
      });
    });
    const results = await service.search("Oslo, Norway");
    expect(new URL(requested).origin).toBe(
      "https://geocoding-api.open-meteo.com",
    );
    expect(new URL(requested).searchParams.get("name")).toBe("Oslo, Norway");
    expect(results).toEqual([
      { name: "Oslo, Norway", latitude: 59.9, longitude: 10.75 },
    ]);
    await expect(service.search("x")).rejects.toThrow();
    await expect(
      new WeatherService(async () =>
        Response.json({
          results: [{ name: "bad", latitude: 1000, longitude: 0 }],
        }),
      ).search("Oslo"),
    ).rejects.toThrow();
  });
});
