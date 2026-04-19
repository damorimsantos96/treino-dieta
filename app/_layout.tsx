import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles/global.css";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { useNativeVersionGate } from "@/hooks/useNativeVersionGate";
import { UpdateBanner } from "@/components/ui/UpdateBanner";
import { NativeUpdateModal } from "@/components/ui/NativeUpdateModal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      retry: 2,
    },
  },
});

function UpdateLayer() {
  const { isUpdatePending } = useAppUpdate();
  const { needsReinstall, downloadUrl, minVersion, releaseNotes } = useNativeVersionGate();
  return (
    <>
      <UpdateBanner visible={isUpdatePending} />
      <NativeUpdateModal
        visible={needsReinstall}
        downloadUrl={downloadUrl}
        minVersion={minVersion}
        releaseNotes={releaseNotes}
      />
    </>
  );
}

export default function RootLayout() {
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    async function loadSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted) setSession(session);
      } catch {
        if (isMounted) setSession(null);
      }
    }

    loadSession();

    try {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (isMounted) setSession(session);
        }
      );
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      setSession(null);
    }

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [setSession]);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="configuracoes/index"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
      </Stack>
      <UpdateLayer />
    </QueryClientProvider>
  );
}
