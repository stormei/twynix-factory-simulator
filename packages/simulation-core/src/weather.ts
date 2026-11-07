import type { Project, WeatherConditions } from "@twynix/shared-types";
import { clamp } from "@twynix/equipment-models";

/** NOAA approximate geometric solar position, UTC; no atmospheric refraction correction. */
export function sunPosition(time: number, latitude: number, longitude: number) {
  const date = new Date(time * 1000),
    year = date.getUTCFullYear();
  const day = Math.floor(
    (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(year, 0, 0)) /
      86400000,
  );
  const days =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  const hour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / days) * (day - 1 + (hour - 12) / 24);
  const equation =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const radians = Math.PI / 180;
  const hourAngle =
    (((((hour * 60 + equation + 4 * longitude) % 1440) + 1440) % 1440) / 4 -
      180) *
    radians;
  const lat = latitude * radians;
  const elevation =
    Math.asin(
      clamp(
        Math.sin(lat) * Math.sin(declination) +
          Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
        -1,
        1,
      ),
    ) / radians;
  const azimuth =
    (Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) -
        Math.tan(declination) * Math.cos(lat),
    ) /
      radians +
      180 +
      360) %
    360;
  return { elevation, azimuth };
}

/** Replay immutable forecast samples against simulation time, never the wall clock. */
export function weatherAt(
  project: Project,
  elapsed: number,
): WeatherConditions | null {
  const weather = project.weather;
  if (weather?.mode !== "forecast" || !weather.forecast) return null;
  const samples = weather.forecast.samples;
  const time = Date.parse(weather.startTime) / 1000 + elapsed;
  const exhausted = time >= samples.at(-1)!.time;
  const index = clamp(
    Math.floor((time - samples[0].time) / 3600),
    0,
    samples.length - 2,
  );
  const a = samples[index],
    b = samples[index + 1];
  const ratio = clamp((time - a.time) / 3600, 0, 1);
  const interpolate = (key: "irradiance" | "temperature" | "cloudCover") =>
    a[key] + (b[key] - a[key]) * ratio;
  const sun = sunPosition(time, weather.site.latitude, weather.site.longitude);
  return {
    time: new Date(time * 1000).toISOString(),
    irradiance: sun.elevation <= 0 ? 0 : interpolate("irradiance"),
    temperature: interpolate("temperature"),
    cloudCover: interpolate("cloudCover"),
    sunElevation: sun.elevation,
    sunAzimuth: sun.azimuth,
    exhausted,
  };
}
