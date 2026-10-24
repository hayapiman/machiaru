import type { RoutePoint } from "../drizzle/schema";

type MapCoordinate = { latitude: number; longitude: number };

function encodePolyline(points: MapCoordinate[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = "";
  const encodeValue = (value: number) => {
    let remaining = value < 0 ? ~(value << 1) : value << 1;
    while (remaining >= 0x20) {
      encoded += String.fromCharCode(((0x20 | (remaining & 0x1f)) + 63));
      remaining >>= 5;
    }
    encoded += String.fromCharCode(remaining + 63);
  };
  for (const point of points) {
    const latitude = Math.round(point.latitude * 1e5);
    const longitude = Math.round(point.longitude * 1e5);
    encodeValue(latitude - previousLatitude);
    encodeValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return encoded;
}

function sampleRoute(points: RoutePoint[], maximum = 70): MapCoordinate[] {
  if (points.length <= maximum) {
    return points.map(({ latitude, longitude }) => ({ latitude, longitude }));
  }
  const sampled: MapCoordinate[] = [];
  const stride = (points.length - 1) / (maximum - 1);
  for (let i = 0; i < maximum; i += 1) {
    const point = points[Math.round(i * stride)];
    sampled.push({ latitude: point.latitude, longitude: point.longitude });
  }
  return sampled;
}

export async function fetchStaticMap(input: {
  center: MapCoordinate;
  zoom: number;
  size: { width: number; height: number };
  routePoints: RoutePoint[];
  markers: MapCoordinate[];
}): Promise<{ mimeType: string; base64: string; center: MapCoordinate; zoom: number; size: { width: number; height: number } }> {
  const apiBase = process.env.MANUS_API_URL;
  const apiKey = process.env.MANUS_API_KEY;
  if (!apiBase || !apiKey) {
    throw new Error("Maps service is not available in this environment.");
  }

  const url = new URL("/v1/maps/proxy/maps/api/staticmap", apiBase);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("center", `${input.center.latitude},${input.center.longitude}`);
  const zoom = Math.max(3, Math.min(19, input.zoom));
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${input.size.width}x${input.size.height}`);
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "roadmap");

  if (input.routePoints.length > 1) {
    const encoded = encodePolyline(sampleRoute(input.routePoints));
    url.searchParams.set("path", `color:0xD05A3AFF|weight:6|enc:${encoded}`);
  }
  for (const marker of input.markers.slice(0, 200)) {
    url.searchParams.append(
      "markers",
      `color:0xD05A3A|${marker.latitude},${marker.longitude}`,
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Maps service returned ${response.status}.`);
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
  if (!mimeType.startsWith("image/")) {
    throw new Error("Maps service did not return an image.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { mimeType, base64: bytes.toString("base64"), center: input.center, zoom, size: input.size };
}
