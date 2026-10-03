import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Employee360Drawer } from "@/components/employee-360/employee-360-drawer";

interface Employee360ContextValue {
  employeeId: string | null;
  openEmployee360: (employeeId: string) => void;
  closeEmployee360: () => void;
}

const Employee360Context = createContext<Employee360ContextValue | undefined>(undefined);

/**
 * Single source of truth for the Employee 360° view. Any module opens the same
 * drawer rather than shipping its own duplicate employee profile.
 */
export function Employee360Provider({ children }: { children: ReactNode }) {
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  const openEmployee360 = useCallback((id: string) => setEmployeeId(id), []);
  const closeEmployee360 = useCallback(() => setEmployeeId(null), []);

  const value = useMemo(
    () => ({ employeeId, openEmployee360, closeEmployee360 }),
    [employeeId, openEmployee360, closeEmployee360],
  );

  return (
    <Employee360Context.Provider value={value}>
      {children}
      <Employee360Drawer employeeId={employeeId} onClose={closeEmployee360} />
    </Employee360Context.Provider>
  );
}

export function useEmployee360() {
  const context = useContext(Employee360Context);
  if (!context) throw new Error("useEmployee360 must be used inside <Employee360Provider>");
  return context;
}
