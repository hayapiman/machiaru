import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HapticTab } from "@/components/haptic-tab";
import { brand, typeface } from "@/lib/brand";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom, 8);
  const tabBarHeight = 58 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: brand.terracotta,
        tabBarInactiveTintColor: brand.muted,
        tabBarLabelStyle: { fontFamily: typeface.medium, fontSize: 10, marginTop: 1 },
        tabBarStyle: {
          paddingTop: 7,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: brand.paperLight,
          borderTopColor: brand.line,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "地図", tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={typeof color === "string" ? color : brand.terracotta} /> }} />
      <Tabs.Screen name="records" options={{ title: "記録", tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={typeof color === "string" ? color : brand.terracotta} /> }} />
      <Tabs.Screen name="groups" options={{ title: "みんな", tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={typeof color === "string" ? color : brand.terracotta} /> }} />
      <Tabs.Screen name="profile" options={{ title: "わたし", tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={typeof color === "string" ? color : brand.terracotta} /> }} />
    </Tabs>
  );
}
