import type { RoutePoint } from "@/drizzle/schema";

type Coordinate = { latitude: number; longitude: number };
type DemoPhoto = { id: string; source: number; credit: string };

function makeRoute(coordinates: Coordinate[], startedAt: number, speedMps: number): RoutePoint[] {
  return coordinates.map((coordinate, index) => ({
    ...coordinate,
    timestamp: startedAt + index * 180_000,
    speedMps,
  }));
}

export const demoGroupFixture = {
  name: "週末よりみち部",
  label: "架空のデモデータ",
  members: ["さくら", "ゆうと", "みお"],
  walks: [
    {
      id: "sample-walk-sakura",
      author: "さくら",
      title: "川辺の朝さんぽ",
      startedAt: Date.UTC(2026, 9, 20, 7, 35),
      durationSeconds: 26 * 60,
      distanceMeters: 1480,
      stepCount: 2320,
      routeData: makeRoute([
        { latitude: 35.6815, longitude: 139.7675 },
        { latitude: 35.6820, longitude: 139.7682 },
        { latitude: 35.6826, longitude: 139.7690 },
        { latitude: 35.6831, longitude: 139.7694 },
        { latitude: 35.6838, longitude: 139.7687 },
        { latitude: 35.6833, longitude: 139.7679 },
      ], Date.UTC(2026, 9, 20, 7, 35), 1.22),
    },
    {
      id: "sample-walk-yuto",
      author: "ゆうと",
      title: "橋をまわる寄り道ルート",
      startedAt: Date.UTC(2026, 9, 19, 16, 10),
      durationSeconds: 42 * 60,
      distanceMeters: 2210,
      stepCount: 3490,
      routeData: makeRoute([
        { latitude: 35.6809, longitude: 139.7664 },
        { latitude: 35.6803, longitude: 139.7673 },
        { latitude: 35.6800, longitude: 139.7682 },
        { latitude: 35.6807, longitude: 139.7692 },
        { latitude: 35.6812, longitude: 139.7686 },
      ], Date.UTC(2026, 9, 19, 16, 10), 1.18),
    },
    {
      id: "sample-walk-mio",
      author: "みお",
      title: "夕方の小道めぐり",
      startedAt: Date.UTC(2026, 9, 18, 17, 20),
      durationSeconds: 21 * 60,
      distanceMeters: 1160,
      stepCount: 1810,
      routeData: makeRoute([
        { latitude: 35.6820, longitude: 139.7660 },
        { latitude: 35.6826, longitude: 139.7654 },
        { latitude: 35.6833, longitude: 139.7662 },
        { latitude: 35.6840, longitude: 139.7670 },
      ], Date.UTC(2026, 9, 18, 17, 20), 1.25),
    },
  ],
  spots: [
    {
      id: "sample-spot-river",
      title: "鴨川の夕暮れ",
      author: "さくら",
      description: "川沿いで少し休んで、光が水面に映るのを眺めました。",
      latitude: 35.6838,
      longitude: 139.7687,
      photos: [{ id: "river-photo", source: require("../assets/demo/riverside.jpg") as number, credit: "Unsplash" }] as DemoPhoto[],
    },
    {
      id: "sample-spot-cafe",
      title: "角の小さな喫茶店",
      author: "みお",
      description: "歩き終わりに抹茶のお店でひと休み。",
      latitude: 35.6807,
      longitude: 139.7692,
      photos: [{ id: "cafe-photo", source: require("../assets/demo/matcha-cafe.jpeg") as number, credit: "Pexels" }] as DemoPhoto[],
    },
  ],
};
