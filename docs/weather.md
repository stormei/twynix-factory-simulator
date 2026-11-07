# Location-based solar weather

The solar project's **Weather & location** view supports place-name search or direct WGS84 latitude/longitude entry. Coordinates are not inferred from the computer or browser. Panel orientation applies to all simulated fields in this release: tilt 0–90° (0 = horizontal) and compass direction 0–360° (0 north, 90 east, 180 south, 270 west). The backend converts direction to Open-Meteo's south-zero convention.

## Using it

1. Pause the simulator and open **Weather & location**.
2. Search for a place and choose a result, or enter a name and coordinates yourself. Check the coordinates; city search identifies a representative location rather than the exact farm boundary.
3. Set the panel tilt and direction, then click **Load 7-day forecast**. This explicitly downloads and applies a forecast, resetting simulation initial conditions. No automatic periodic downloads occur.
4. Choose **Simulation start (UTC)** within the forecast coverage, or click **Start here** next to an hourly row. Applying a different start time also resets initial conditions. A forecast starting at night correctly produces no solar generation; select a daytime hour to inspect daytime production.
5. Click **Save**, then **Start**. Forecast samples, site/orientation, download timestamp and start time are persisted in the project, including JSON exports. A saved project can replay without internet access. Reset replays the same samples; it does not fetch today's weather.
6. Select **Manual conditions** while paused to restore manual irradiance/temperature controls. The saved forecast and site remain available for later replay. Simulation speed changes how quickly the weather clock advances, using the existing fixed 100 ms physics steps.

The live strip shows the selected location, simulated UTC clock, panel irradiance, air temperature, cloud cover and sun elevation. The hourly preview exposes the downloaded data. Day/night is based on the selected position and simulated date/time, not the computer clock. There is no automatic browser geolocation, map service, or request on each simulation step.

## Data and physics

The server queries Open-Meteo's forecast API for `global_tilted_irradiance_instant`, `temperature_2m` and `cloud_cover`, with the site's coordinates, tilt and direction. Radiation is in W/m² on the specified panel plane; temperature is °C. Seven days (normally 168 hourly samples) are requested. The provider may use a nearby model grid cell and interpolated weather; this is a forecast, not a local irradiance measurement or a guaranteed energy yield.

Instantaneous hourly samples are linearly interpolated at simulation time. NOAA's approximate geometric sun-position equations calculate elevation and compass azimuth using UTC, latitude and longitude. Irradiance is forced to zero when the geometric sun is at/below the horizon, including polar night. There is no refraction, terrain horizon, tracking, snow accumulation, wind-dependent cooling or precise intra-hour cloud movement. Instantaneous samples and interpolation prioritize smooth operational simulation; they are not a replacement for interval-mean radiation and a calibrated yield study.

Provider radiation already includes forecast cloud effects and panel orientation. The synthetic sinusoidal cloud attenuation is therefore disabled in forecast mode; cloud cover is displayed rather than multiplying irradiance a second time. Individual field `ShadingPercent` still applies. The forecast's air temperature feeds the existing cell-temperature and inverter thermal models. `AirTemperature` is a new read-only PV tag showing the actual air temperature used. The existing `AmbientTemperature` and `IrradianceSetpoint` tags remain manual commands; their writes are disabled/rejected in forecast mode at the backend as well as in the UI. Manual mode preserves the prior simulation behavior.

Forecast end is explicit: the runtime pauses at the last saved timestamp and logs a warning. It does not loop, silently hold the final day's weather, fetch new data, or switch to artificial sun. Load a fresh forecast, choose an earlier start, or switch to manual conditions to continue. A paused run freezes the weather clock and all process physics.

## Boundaries and networking

Only explicit search/download actions need internet. The browser calls the same authenticated/same-origin simulator API; provider networking is performed by the backend at fixed HTTPS URLs. Place searches transmit the entered place name to Open-Meteo's geocoding API (GeoNames data). Forecast requests transmit coordinates and panel orientation to Open-Meteo. No project equipment, OPC UA credentials or other project contents are sent. Downloads have a 12-second timeout, a 500 kB response cap, bounded concurrency, and an in-memory 15-minute cache limited to 32 requests. The original retrieval timestamp is retained on cache hits.

The backend validates inputs, response units, finite numeric values, matching array lengths, consecutive hourly timestamps, sample limits, and start-time coverage. Failed/invalid downloads leave saved project data unchanged. There are no credentials in project JSON. The bundled public Open-Meteo endpoints are intended for non-commercial prototyping under the provider's terms; commercial deployments need an eligible provider arrangement before enabling downloads. The simulator itself does not provision a weather-service subscription.

API routes:

- `GET /api/weather/locations?query=...` returns up to five candidate names and coordinates.
- `POST /api/weather/forecast` accepts `{name, latitude, longitude, tilt, azimuth}` and returns a validated weather configuration. This route alone does not change the running project. The UI then applies it through the normal project boundary, which requires a paused/stopped runtime.
- Project `weather` is optional, so older project files remain valid. The runtime's `weather` snapshot is null in manual mode, otherwise it contains simulated time, irradiance, air temperature, cloud cover, sun angles and an exhausted flag.

## OPC UA

The panel's existing `Irradiance`, `CellTemperature`, power/current tags and inverter generation follow forecast conditions. Read actual air temperature at `ns=2;s=project/solar-farm/equipment/pv1/AirTemperature` (and `pv2`/`pv3`).

The project's `simulation` object additionally publishes read-only `ForecastWeatherActive` and `ForecastExhausted` (Boolean); `WeatherUnixTime` (UTC seconds), `WeatherIrradiance` (W/m² before field shading), `WeatherTemperature` (°C), `WeatherCloudCover` (%), `SunElevation` (degrees above geometric horizon) and `SunAzimuth` (degrees clockwise from north), all numeric values as Double. Forecast-only numeric values are zero when forecast mode is inactive; check `ForecastWeatherActive`. Inputs are sampled at the start of each 100 ms process step.

Tests cover seasonal/geographic sun position, polar day/night, interpolation, no double cloud attenuation, field shading, forecast-owned commands, deterministic offline replay, forecast exhaustion, malformed provider responses, request construction, caching, failure handling and the complete UI save/reload/manual-mode flow. A live request against the provider is a separate smoke check, not a network dependency of automated tests.

## References

- [Open-Meteo forecast API](https://open-meteo.com/en/docs): radiation semantics, panel-plane irradiance and orientation conventions.
- [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api): place search and GeoNames attribution.
- [NOAA solar-position equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF): approximate equation of time, declination, solar time and position.
- [Open-Meteo terms](https://open-meteo.com/en/terms) and [licence](https://open-meteo.com/en/licence).

## Automatic ThingsBoard location and forecast sync

`Simulation.WeatherConfiguration` is a read-only OPC UA **String** containing the project's saved weather configuration as JSON (`mode`, `site`, `startTime`, and optional `forecast`). It publishes `"null"` when no weather configuration exists. The existing schema bounds forecast data to 192 hourly samples. Location and forecast are one value to prevent mixed configurations during updates. This tag describes the saved forecast; it does not download or refresh forecasts on a schedule.

Subscribe to `WeatherConfiguration` under the Simulation mapping in ThingsBoard, using the same name as key and relative path. The existing uplink converter preserves the JSON string as telemetry on `Twynix Solar - Simulation`. A dashboard formatter can parse it to show the selected location, panel orientation, provider/retrieval time, and daily forecast summaries. Handle `null`, missing forecasts and malformed values explicitly, and escape site/provider text before rendering HTML. Changes applied in the simulator trigger subscription updates, including while stopped; replacing a project rebuilds the OPC UA address space, so the integration may need its normal reconnect/rescan interval. Save the project to retain the changes across a backend restart. Renaming the project still requires updating existing FQN-based ThingsBoard mapping patterns.
