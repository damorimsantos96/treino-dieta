import { Tabs, router } from "expo-router";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/stores/auth";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({ name, focused }: { name: IoniconName; focused: boolean }) {
  return (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IoniconName)}
      size={22}
      color={focused ? "#10b981" : "#4a4b58"}
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
          backgroundColor: "#1c1d23",
          borderTopColor: "#2c2d36",
          borderTopWidth: 1,
          paddingBottom: 10,
          paddingTop: 6,
          height: 68,
        },
        tabBarActiveTintColor: "#10b981",
        tabBarInactiveTintColor: "#4a4b58",
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.3,
          marginTop: 2,
        },
        tabBarActiveBackgroundColor: "transparent",
      }}
    >
      <Tabs.Screen
        name="hoje"
        options={{
          title: "Hoje",
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="registrar"
        options={{
          title: "Registrar",
          href: null,
          tabBarIcon: ({ focused }) => <TabIcon name="add-circle" focused={focused} />,
          tabBarButton: () => null,
        }}
      />
      <Tabs.Screen
        name="corridas"
        options={{
          title: "Corridas",
          tabBarIcon: ({ focused }) => <TabIcon name="walk" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="prs"
        options={{
          title: "PRs",
          tabBarIcon: ({ focused }) => <TabIcon name="trophy" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="analises"
        options={{
          title: "Análises",
          tabBarIcon: ({ focused }) => <TabIcon name="bar-chart" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
