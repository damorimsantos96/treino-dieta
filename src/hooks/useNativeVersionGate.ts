import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Updates from "expo-updates";
import { supabase } from "@/lib/supabase";

function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

export function useNativeVersionGate() {
  const [needsReinstall, setNeedsReinstall] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [minVersion, setMinVersion] = useState("");
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);

  useEffect(() => {
    if (__DEV__ || Platform.OS === "web") return;
    async function check() {
      try {
        const { data } = await supabase
          .from("app_version_config")
          .select("min_runtime_version, apk_download_url, release_notes")
          .eq("id", 1)
          .single();
        if (!data) return;
        const currentVersion = Updates.runtimeVersion;
        const minRuntimeVersion = data.min_runtime_version?.trim();
        if (!currentVersion || !minRuntimeVersion) return;

        if (semverLt(currentVersion, minRuntimeVersion)) {
          setMinVersion(minRuntimeVersion);
          setDownloadUrl(data.apk_download_url ?? "");
          setReleaseNotes(data.release_notes);
          setNeedsReinstall(true);
        } else {
          setNeedsReinstall(false);
        }
      } catch {}
    }
    check();
  }, []);

  return { needsReinstall, downloadUrl, minVersion, releaseNotes };
}
