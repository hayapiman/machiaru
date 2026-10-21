import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { brand, typeface } from "@/lib/brand";

export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: brand.paper }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 34, gap: 18 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: 20 }}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Heading({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        {eyebrow ? <Text style={{ color: brand.terracotta, fontSize: 11, letterSpacing: 1.2, fontFamily: typeface.bold }}>{eyebrow}</Text> : null}
        <Text style={{ color: brand.ink, fontSize: 27, lineHeight: 34, fontFamily: typeface.bold }}>{title}</Text>
        {subtitle ? <Text style={{ color: brand.muted, fontSize: 13, lineHeight: 20, fontFamily: typeface.regular }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View style={[{
      backgroundColor: brand.card,
      borderColor: brand.line,
      borderWidth: 1,
      borderRadius: 20,
      padding: 16,
      shadowColor: brand.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    }, style]}>
      {children}
    </View>
  );
}

export function AppButton({
  label,
  onPress,
  variant = "primary",
  small = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "soft" | "outline" | "danger";
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const palette = {
    primary: { backgroundColor: brand.terracotta, color: brand.white, borderColor: brand.terracotta },
    soft: { backgroundColor: "#F8E2D5", color: brand.terracottaDark, borderColor: "#F8E2D5" },
    outline: { backgroundColor: brand.card, color: brand.ink, borderColor: brand.line },
    danger: { backgroundColor: "#F7E8E2", color: brand.terracottaDark, borderColor: "#F1D5CB" },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: small ? 38 : 50,
        paddingHorizontal: small ? 14 : 18,
        borderRadius: small ? 14 : 17,
        borderWidth: 1,
        borderColor: palette.borderColor,
        backgroundColor: palette.backgroundColor,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : pressed ? 0.84 : 1,
        flexDirection: "row",
      }]}
    >
      {loading ? <ActivityIndicator color={palette.color} /> : <Text style={{ color: palette.color, fontFamily: typeface.bold, fontSize: small ? 12 : 15 }}>{label}</Text>}
    </Pressable>
  );
}

export function Tag({ children, tone = "paper" }: { children: ReactNode; tone?: "paper" | "yellow" | "green" | "red" }) {
  const tones = {
    paper: { backgroundColor: "#F2E6D4", color: brand.muted },
    yellow: { backgroundColor: "#FBEDC7", color: "#8B6B1D" },
    green: { backgroundColor: "#E7EDE2", color: brand.sage },
    red: { backgroundColor: "#F8E2D5", color: brand.terracottaDark },
  }[tone];
  return <View style={{ alignSelf: "flex-start", borderRadius: 20, backgroundColor: tones.backgroundColor, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: tones.color, fontFamily: typeface.medium, fontSize: 11 }}>{children}</Text></View>;
}

export function Metric({ label, value, unit, accent = false }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <View style={{ minWidth: 68, gap: 2 }}>
      <Text style={{ color: brand.muted, fontSize: 10, fontFamily: typeface.medium }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
        <Text style={{ color: accent ? brand.terracotta : brand.ink, fontSize: 21, fontFamily: typeface.bold, fontVariant: ["tabular-nums"] }}>{value}</Text>
        {unit ? <Text style={{ color: brand.muted, fontSize: 10, fontFamily: typeface.medium }}>{unit}</Text> : null}
      </View>
    </View>
  );
}

export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}><Text style={{ color: brand.ink, fontSize: 16, fontFamily: typeface.bold }}>{children}</Text>{aside}</View>;
}

export function EmptyNote({ title, body }: { title: string; body: string }) {
  return <View style={{ paddingVertical: 18, alignItems: "center", gap: 5 }}><Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 15 }}>{title}</Text><Text style={{ color: brand.muted, textAlign: "center", fontFamily: typeface.regular, fontSize: 12, lineHeight: 18 }}>{body}</Text></View>;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function formatPace(speedMps: number): string {
  if (!Number.isFinite(speedMps) || speedMps <= 0) return "—";
  return `${(speedMps * 3.6).toFixed(1)}`;
}
