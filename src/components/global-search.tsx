import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Loader2, Search, UserSearch, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/lib/db";
import { useAuth } from "@/providers/auth-provider";

interface SearchResults {
  employees: Array<{ id: string; full_name: string; code: string; job_title: string | null }>;
  departments: Array<{ id: string; name: string; code: string }>;
  candidates: Array<{ id: string; full_name: string; current_stage: string }>;
}

/** Global search across workforce entities, with role-aware destinations. */
export function GlobalSearch({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isFounder = profile?.role === "founder";

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ["global-search", debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const like = `%${debounced}%`;
      const [employees, departments, candidates] = await Promise.all([
        supabase.from("hr_employees").select("id, full_name, code, job_title").ilike("full_name", like).limit(6),
        supabase.from("hr_departments").select("id, name, code").ilike("name", like).limit(5),
        isFounder
          ? Promise.resolve({ data: [] as SearchResults["candidates"], error: null })
          : supabase.from("hr_candidates").select("id, full_name, current_stage").ilike("full_name", like).limit(5),
      ]);
      return {
        employees: (employees.data ?? []) as SearchResults["employees"],
        departments: (departments.data ?? []) as SearchResults["departments"],
        candidates: (candidates.data ?? []) as SearchResults["candidates"],
      };
    },
  });

  const hasResults = useMemo(
    () => Boolean(data && (data.employees.length || data.departments.length || data.candidates.length)),
    [data],
  );

  const go = (path: string) => {
    setOpen(false);
    setTerm("");
    navigate(path);
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={className ?? "h-9 w-full justify-start gap-2 text-muted-foreground sm:w-64 lg:w-80"}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="truncate text-sm">Search employees, departments…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline-block">
          Ctrl K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search employees, departments and candidates…" value={term} onValueChange={setTerm} />
        <CommandList>
          {isFetching ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Searching…
            </div>
          ) : null}
          {!isFetching && debounced.length >= 2 && !hasResults ? (
            <CommandEmpty>No matching records found.</CommandEmpty>
          ) : null}
          {debounced.length < 2 ? (
            <CommandEmpty>Type at least two characters to search.</CommandEmpty>
          ) : null}

          {data?.employees.length ? (
            <CommandGroup heading="Employees">
              {data.employees.map((employee) => (
                <CommandItem
                  key={employee.id}
                  value={`employee ${employee.full_name} ${employee.code}`}
                  onSelect={() => go(`/workforce/employees?employee=${employee.id}`)}
                >
                  <Users className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{employee.full_name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{employee.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {data?.departments.length ? (
            <CommandGroup heading="Departments">
              {data.departments.map((department) => (
                <CommandItem
                  key={department.id}
                  value={`department ${department.name} ${department.code}`}
                  onSelect={() => go(`/workforce/departments?department=${department.id}`)}
                >
                  <Building2 className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{department.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {data?.candidates.length ? (
            <CommandGroup heading="Candidates">
              {data.candidates.map((candidate) => (
                <CommandItem
                  key={candidate.id}
                  value={`candidate ${candidate.full_name}`}
                  onSelect={() => go(`/recruitment?candidate=${candidate.id}`)}
                >
                  <UserSearch className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{candidate.full_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
