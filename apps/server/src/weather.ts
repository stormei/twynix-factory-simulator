import { z } from "zod";
import {
  solarSiteSchema,
  weatherSchema,
  type SolarSite,
  type WeatherConfig,
} from "@twynix/shared-types";

type Fetcher = (url: URL, options: RequestInit) => Promise<Response>;
const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string().max(100),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        admin1: z.string().max(100).optional(),
        country: z.string().max(100).optional(),
      }),
    )
    .max(10)
    .optional(),
});
const responseSchema = z.object({
  hourly_units: z.object({
    time: z.literal("unixtime"),
    temperature_2m: z.literal("°C"),
    cloud_cover: z.literal("%"),
    global_tilted_irradiance_instant: z.literal("W/m²"),
  }),
  hourly: z.object({
    time: z.array(z.number()).min(2).max(192),
    temperature_2m: z.array(z.number()).min(2).max(192),
    cloud_cover: z.array(z.number()).min(2).max(192),
    global_tilted_irradiance_instant: z.array(z.number()).min(2).max(192),
  }),
});

/** Explicit user-triggered downloads only; fixed provider URLs, bounded responses and concurrency. */
export class WeatherService {
  private busy = false;
  private cache = new Map<
    string,
    { expires: number; value: unknown; fetchedAt: number }
  >();
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  private async json(url: URL): Promise<{ value: unknown; fetchedAt: number }> {
    const key = url.toString(),
      cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached;
    if (this.busy)
      throw Error("Another weather request is running; try again shortly");
    this.busy = true;
    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(12000),
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw Error(
          `Weather provider returned ${response.status}; saved weather is unchanged`,
        );
      if (!response.body)
        throw Error("Weather provider returned an empty response");
      const reader = response.body.getReader();
      let size = 0,
        body = "";
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 500000) throw Error("Weather response too large");
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        await reader.cancel();
      }
      const value: unknown = JSON.parse(body);
      if (this.cache.size >= 32)
        this.cache.delete(this.cache.keys().next().value!);
      const entry = {
        expires: this.now() + 15 * 60000,
        value,
        fetchedAt: this.now(),
      };
      this.cache.set(key, entry);
      return entry;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      )
        throw Error("Weather request timed out; saved weather is unchanged");
      if (error instanceof TypeError)
        throw Error(
          "Could not reach the weather service. Check internet access; saved weather is unchanged",
        );
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async search(input: unknown) {
    const query = z.string().trim().min(2).max(100).parse(input);
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({
      name: query,
      count: "5",
      language: "en",
      format: "json",
    }).toString();
    const response = geocodingSchema.parse((await this.json(url)).value);
    return (response.results ?? []).map((r) => ({
      name: [r.name, r.admin1, r.country]
        .filter((s, i, all) => s && all.indexOf(s) === i)
        .join(", ")
        .slice(0, 100),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  }
  async forecast(input: unknown): Promise<WeatherConfig> {
    const site: SolarSite = solarSiteSchema.parse(input);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(site.latitude),
      longitude: String(site.longitude),
      tilt: String(site.tilt),
      azimuth: String(site.azimuth - 180),
      hourly: "temperature_2m,cloud_cover,global_tilted_irradiance_instant",
      timezone: "UTC",
      timeformat: "unixtime",
      forecast_days: "7",
    }).toString();
    const download = await this.json(url);
    const response = responseSchema.parse(download.value);
    const h = response.hourly;
    if (
      [
        h.temperature_2m.length,
        h.cloud_cover.length,
        h.global_tilted_irradiance_instant.length,
      ].some((length) => length !== h.time.length)
    )
      throw Error("Weather response has incomplete hourly data");
    const samples = h.time.map((time, i) => ({
      time,
      irradiance: h.global_tilted_irradiance_instant[i],
      temperature: h.temperature_2m[i],
      cloudCover: h.cloud_cover[i],
    }));
    const start = Math.max(
      samples[0].time,
      Math.floor(this.now() / 3600000) * 3600,
    );
    return weatherSchema.parse({
      mode: "forecast",
      site,
      startTime: new Date(start * 1000).toISOString(),
      forecast: {
        provider: "Open-Meteo",
        fetchedAt: new Date(download.fetchedAt).toISOString(),
        samples,
      },
    });
  }
}
