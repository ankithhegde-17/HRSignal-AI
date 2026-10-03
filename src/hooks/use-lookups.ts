import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/db";
import type { Department, Employee, HrProfile, Team } from "@/lib/types";

export interface LookupOption {
  value: string;
  label: string;
}

export function useDepartments() {
  return useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_departments").select("*").eq("is_active", true).order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Department[];
    },
  });
}

export function useDepartmentOptions(): { options: LookupOption[]; departments: Department[]; isLoading: boolean } {
  const { data, isLoading } = useDepartments();
  const departments = data ?? [];
  return {
    departments,
    isLoading,
    options: departments.map((department) => ({ value: department.id, label: department.name })),
  };
}

export function useEmployeeOptions(search?: string) {
  const term = (search ?? "").trim();
  const query = useQuery<LookupOption[]>({
    queryKey: ["employee-options", term],
    queryFn: async () => {
      let q = supabase
        .from("hr_employees")
        .select("id, full_name, code")
        .neq("status", "exited")
        .order("full_name")
        .limit(50);
      if (term) q = q.ilike("full_name", `%${term}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ id: string; full_name: string; code: string }>).map((employee) => ({
        value: employee.id,
        label: `${employee.full_name} (${employee.code})`,
      }));
    },
  });

  // Normalise the array contract at the boundary. Callers always receive an
  // array — never null or undefined — even while loading or after an error.
  const options: LookupOption[] = Array.isArray(query.data) ? query.data : [];
  return { options, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

export function useEmployeeDirectory() {
  return useQuery<Employee[]>({
    queryKey: ["employees", "directory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select("*")
        .order("full_name")
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });
}

/** HR team members (both roles) used by the executive HR-team view. */
export function useHrProfiles() {
  return useQuery<HrProfile[]>({
    queryKey: ["hr-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_profiles").select("*").order("full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as HrProfile[];
    },
  });
}

export function useTeams() {
  return useQuery<Team[]>({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_teams").select("*").order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Team[];
    },
  });
}

export function useTeamOptions(departmentId?: string | null) {
  const { data, isLoading } = useTeams();
  const teams: Team[] = Array.isArray(data) ? data : [];
  const scoped =
    departmentId && departmentId !== "all" ? teams.filter((team) => team.department_id === departmentId) : teams;
  return {
    teams,
    options: scoped.map((team) => ({ value: team.id, label: team.name })),
    isLoading,
  };
}

export function useTeamNameMap() {
  const { teams } = useTeamOptions();
  return new Map(teams.map((team) => [team.id, team.name]));
}

/** Maps employee id → display name for table rendering. */
export function useEmployeeNameMap() {
  const { data } = useEmployeeDirectory();
  return new Map((data ?? []).map((employee) => [employee.id, employee.full_name]));
}

export function useProfileNameMap() {
  const { data } = useHrProfiles();
  return new Map((data ?? []).map((profile) => [profile.user_id, profile.full_name]));
}
