import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRunActivities,
  getRunSessions,
  upsertRunSession,
  deleteRunSession,
} from "@/lib/api";
import { RunSession } from "@/types";
import { subMonths } from "date-fns";

export function useRunSessions(months = 3) {
  const from = subMonths(new Date(), months);
  return useQuery({
    queryKey: ["run_sessions", months],
    queryFn: () => getRunSessions(from, new Date(), 200),
  });
}

export function useRunActivities(months = 3) {
  const from = subMonths(new Date(), months);
  return useQuery({
    queryKey: ["run_activities", months],
    queryFn: () => getRunActivities(from, new Date(), 500),
  });
}

export function useAllRunSessions() {
  return useQuery({
    queryKey: ["run_sessions", "all"],
    queryFn: () => getRunSessions(undefined, undefined, 5000),
  });
}

export function useUpsertRunSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Partial<RunSession> & { date: string; interval_type: string }) =>
      upsertRunSession(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run_sessions"] });
    },
  });
}

export function useDeleteRunSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRunSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run_sessions"] });
    },
  });
}
