import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDailyLog, upsertDailyLog } from "@/lib/api";
import { DailyLog } from "@/types";
import { format } from "date-fns";

export function useDailyLog(date: Date) {
  return useQuery({
    queryKey: ["daily_log", format(date, "yyyy-MM-dd")],
    queryFn: () => getDailyLog(date),
  });
}

export function useUpsertDailyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (log: Partial<DailyLog> & { date: string }) =>
      upsertDailyLog(log),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["daily_log", data.date] });
      qc.invalidateQueries({ queryKey: ["daily_logs"] });
    },
  });
}
