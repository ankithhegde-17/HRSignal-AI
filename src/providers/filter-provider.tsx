import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { dateRangeForDays } from "@/lib/format";

export interface GlobalFilters {
  departmentId: string;
  teamId: string;
  days: number;
  from: string;
  to: string;
}

interface FilterContextValue extends GlobalFilters {
  setDepartmentId: (value: string) => void;
  setTeamId: (value: string) => void;
  setDays: (value: number) => void;
  setCustomRange: (from: string, to: string) => void;
  reset: () => void;
}

const DEFAULT_DAYS = 30;

function defaultState(): GlobalFilters {
  const range = dateRangeForDays(DEFAULT_DAYS);
  return { departmentId: "all", teamId: "all", days: DEFAULT_DAYS, from: range.start, to: range.end };
}

const FilterContext = createContext<FilterContextValue | undefined>(undefined);

/**
 * Header-level filters shared by every workspace page so a department, team or
 * date selection applies consistently across the shell. The team filter is
 * dependent on the department filter: selecting a department resets the team
 * selection so a team from another department can never survive.
 */
export function FilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GlobalFilters>(defaultState);

  const value = useMemo<FilterContextValue>(
    () => ({
      ...state,
      setDepartmentId: (departmentId) =>
        setState((current) =>
          departmentId === current.departmentId
            ? current
            : { ...current, departmentId, teamId: "all" },
        ),
      setTeamId: (teamId) => setState((current) => ({ ...current, teamId })),
      setDays: (days) => {
        const range = dateRangeForDays(days);
        setState((current) => ({ ...current, days, from: range.start, to: range.end }));
      },
      setCustomRange: (from, to) => setState((current) => ({ ...current, days: 0, from, to })),
      reset: () => setState(defaultState()),
    }),
    [state],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useGlobalFilters() {
  const context = useContext(FilterContext);
  if (!context) throw new Error("useGlobalFilters must be used inside <FilterProvider>");
  return context;
}
