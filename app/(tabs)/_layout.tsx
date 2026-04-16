import { Tabs, router } from "expo-router";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/stores/auth";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  name,
  focused,
}: {
  name: IoniconName;
  focused: boolean;
}) {
  return (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IoniconName)}
      size={24}
      color={focused ? "#22c55e" : "#475569"}
    />
  );
}

export default function TabsLayout() {
  const { session, loading } = useAuthStore();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/(auth)/login");
    }
  }, [session, loading]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#1e293b",
          borderTopColor: "#334155",
          paddingBottom: 8,
          paddingTop: 4,
          height: 64,
        },
        tabBarActiveTintColor: "#22c55e",
        tabBarInactiveTintColor: "#475569",
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="hoje"
        options={{
          title: "Hoje",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="registrar"
        options={{
          title: "Registrar",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="add-circle" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="corridas"
        options={{
          title: "Corridas",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="walk" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="prs"
        options={{
          title: "PRs",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="trophy" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="analises"
        options={{
          title: "Análises",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bar-chart" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
