import type { WeatherConfig } from "@twynix/shared-types";
export const weatherFixture: WeatherConfig = {
  mode: "forecast",
  site: {
    name: "Oslo, Norway",
    latitude: 59.9139,
    longitude: 10.7522,
    tilt: 30,
    azimuth: 180,
  },
  startTime: "2026-06-21T10:00:00.000Z",
  forecast: {
    provider: "Open-Meteo",
    fetchedAt: "2026-06-21T09:30:00.000Z",
    samples: Array.from({ length: 12 }, (_, i) => ({
      time: Date.UTC(2026, 5, 21, 10 + i) / 1000,
      irradiance: Math.max(0, 800 - i * 60),
      temperature: 20 - i * 0.5,
      cloudCover: 20 + i * 3,
    })),
  },
};
export function forecastResponse() {
  const samples = weatherFixture.forecast!.samples;
  return {
    hourly_units: {
      time: "unixtime",
      temperature_2m: "°C",
      cloud_cover: "%",
      global_tilted_irradiance_instant: "W/m²",
    },
    hourly: {
      time: samples.map((s) => s.time),
      temperature_2m: samples.map((s) => s.temperature),
      cloud_cover: samples.map((s) => s.cloudCover),
      global_tilted_irradiance_instant: samples.map((s) => s.irradiance),
    },
  };
}
