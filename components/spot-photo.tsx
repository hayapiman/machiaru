import { useState } from "react";
import { Image, View } from "react-native";
import type { ImageStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";
import { brand } from "@/lib/brand";

export function SpotPhoto({ photoId, style }: { photoId: number; style: StyleProp<ImageStyle> }) {
  const [failed, setFailed] = useState(false);
  const signed = trpc.photos.signedUrl.useQuery(
    { photoId },
    { enabled: photoId > 0, staleTime: 45 * 60 * 1000, retry: false },
  );
  const uri = signed.data?.url;
  if (!uri || failed) {
    return <View style={[style, { backgroundColor: "#F7E7CC", alignItems: "center", justifyContent: "center" }]}><Ionicons name="image-outline" size={22} color={brand.terracotta} /></View>;
  }
  return <Image source={{ uri }} style={style} resizeMode="cover" onError={() => setFailed(true)} />;
}
