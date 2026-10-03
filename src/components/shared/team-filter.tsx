import { Layers } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeamOptions } from "@/hooks/use-lookups";

/**
 * Team filter that is dependent on the selected department: it only offers
 * teams inside that department. When no department is selected the control is
 * disabled with "All teams" as the only sensible value, so a team from another
 * department can never be chosen.
 */
export function TeamSelectFilter({
  departmentId,
  teamId,
  onTeamChange,
  disabled,
  className,
  triggerClassName,
  label = "All teams",
}: {
  departmentId: string;
  teamId: string;
  onTeamChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  label?: string;
}) {
  const noDepartment = departmentId === "all" || !departmentId;
  const { options, isLoading } = useTeamOptions(noDepartment ? null : departmentId);
  const locked = disabled || noDepartment || isLoading;

  return (
    <div className={className}>
      <Select value={teamId} onValueChange={onTeamChange} disabled={locked}>
        <SelectTrigger className={triggerClassName} aria-label="Team filter">
          <Layers className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {noDepartment ? "All teams" : label}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {noDepartment ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Select a department to filter by team.</p>
      ) : null}
    </div>
  );
}
