import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth";
import { View, ActivityIndicator } from "react-native";

export default function Index() {
  const { session, loading } = useAuthStore();

  if (loading) {
    return (
      <View className="flex-1 bg-surface-900 items-center justify-center">
        <ActivityIndicator color="#22c55e" size="large" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)/hoje" />;
  }

  return <Redirect href="/(auth)/login" />;
}
