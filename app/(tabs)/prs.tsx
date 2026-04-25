import { ScrollView, View } from "react-native";
import { PRSection } from "@/components/PRSection";

export default function PRsScreen() {
  return (
    <View className="flex-1 bg-surface-900">
      <ScrollView contentContainerClassName="px-4 pt-6 pb-8">
        <PRSection />
      </ScrollView>
    </View>
  );
}
