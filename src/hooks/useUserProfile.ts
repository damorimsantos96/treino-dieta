import { useQuery } from "@tanstack/react-query";
import { getProfile } from "@/lib/api";
import { UserMetrics } from "@/utils/calculations";

const FALLBACK: UserMetrics = {
  heightCm: 172,
  birthDate: new Date("1996-07-01"),
};

export function useUserMetrics(): UserMetrics {
  const { data: profile } = useQuery({
    queryKey: ["user_profile"],
    queryFn: getProfile,
  });

  if (!profile) return FALLBACK;

  return {
    heightCm: profile.height_cm ?? FALLBACK.heightCm,
    birthDate: profile.birth_date ? new Date(profile.birth_date) : FALLBACK.birthDate,
  };
}
