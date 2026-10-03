import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Circle, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Brand } from "@/components/brand";
import { NavQuickActions } from "@/components/nav-quick-actions";
import { navForRole, type NavItem } from "@/components/nav-config";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
  variant?: "desktop" | "mobile";
}

/** Shared item geometry for every navigation control. In the collapsed rail every
 * item is a 48×44px control centered with `margin-inline: auto`, so icons are
 * mathematically centered, never clipped and never pushed against the edges. */
const itemBase =
  "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";
const itemExpanded = "w-full px-3 py-2";
const itemCollapsed = "mx-auto h-11 w-12 justify-center px-0";

/** Shared icon sizing: consistent 20px, explicit current-color stroke. */
const ICON_CLASS = "h-5 w-5 shrink-0 stroke-current";
const CHILD_ICON_CLASS = "h-4 w-4 shrink-0 stroke-current";

/** High-contrast colors for every icon state on the dark navy rail. */
const INACTIVE_ITEM = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const INACTIVE_GROUP = "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

/** Active route: indigo → violet gradient with a subtle glow (see .nav-active). */
const ACTIVE_ITEM = "nav-active";

/**
 * Safe data-driven icon resolution: never call an unvalidated component. Lucide
 * icons are React.forwardRef components — valid components are either plain
 * functions or forwardRef objects ({ $$typeof: react.forward_ref }). Anything
 * else falls back to a visible icon and logs a development warning.
 */
const REACT_FORWARD_REF = Symbol.for("react.forward_ref");

function isReactComponent(value: unknown): value is LucideIcon {
  return (
    typeof value === "function" ||
    (typeof value === "object" &&
      value !== null &&
      (value as { $$typeof?: symbol }).$$typeof === REACT_FORWARD_REF)
  );
}

function resolveIcon(icon: LucideIcon | undefined): LucideIcon {
  if (isReactComponent(icon)) return icon;
  console.warn("[HR Signal AI] Navigation item is missing a valid icon; rendering a fallback.");
  return Circle;
}

/** Adds an accessible, non-clipped tooltip to any collapsed control. */
function NavTooltip({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  if (!disabled) return <>{children}</>;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center" sideOffset={10} className="z-50">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Data-driven navigation shared by the desktop sidebar and the mobile drawer, so
 * both shells always expose the same routes. Expanded and collapsed states share
 * the same item component — only the geometry classes change.
 */
export function SidebarNav({ collapsed = false, onNavigate, className, variant = "desktop" }: SidebarNavProps) {
  const { profile } = useAuth();
  const groups = navForRole(profile?.role);
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Keep the group containing the active route expanded.
  useEffect(() => {
    const active = groups.find((group) => group.items.some((item) => location.pathname.startsWith(item.to)));
    if (active) setOpenGroups((current) => ({ ...current, [active.label]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const renderItem = (item: NavItem, isChild = false) => {
    const Icon = resolveIcon(item.icon);
    return (
      <NavTooltip label={item.label} disabled={collapsed}>
        <NavLink
          to={item.to}
          onClick={onNavigate}
          aria-label={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              itemBase,
              isChild ? "gap-2.5 px-3 py-2" : collapsed ? itemCollapsed : itemExpanded,
              isActive
                ? ACTIVE_ITEM
                : isChild
                  ? cn(INACTIVE_ITEM, "text-sidebar-foreground/90")
                  : INACTIVE_ITEM,
            )
          }
        >
          <Icon className={isChild ? CHILD_ICON_CLASS : ICON_CLASS} aria-hidden="true" />
          {!collapsed ? <span className="truncate">{item.label}</span> : null}
        </NavLink>
      </NavTooltip>
    );
  };

  return (
    <div className={cn("flex h-full flex-col gap-1 overflow-hidden", className)}>
      {/* Brand: centered 40px mark when collapsed, wordmark when expanded. */}
      <div
        className={cn(
          "flex h-header shrink-0 items-center border-b border-sidebar-border/60 bg-sidebar-secondary/30 px-3",
          collapsed && "justify-center px-0",
        )}
      >
        <Brand collapsed={collapsed} to={profile?.role === "founder" ? "/executive" : "/dashboard"} />
      </div>

      {/* Add / Upload Data: square icon button when collapsed. */}
      <div className={cn("shrink-0 px-3 pb-2", collapsed && "flex justify-center px-2")}>
        <NavQuickActions collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <nav
        aria-label="Main navigation"
        className={cn("hr-scroll-area flex-1 overflow-y-auto px-3 pb-4", collapsed && "px-0")}
      >
        <ul className="flex flex-col gap-1">
          {groups.map((group) => {
            const hasChildren = group.items.length > 1;
            const isOpen = openGroups[group.label] ?? false;
            const GroupIcon = resolveIcon(group.icon);
            const groupActive = group.items.some((item) => location.pathname.startsWith(item.to));

            if (!hasChildren && group.items.length === 1) {
              return <li key={group.label}>{renderItem(group.items[0])}</li>;
            }

            return (
              <li key={group.label}>
                <NavTooltip label={group.label} disabled={collapsed}>
                  <button
                    type="button"
                    onClick={() => setOpenGroups((current) => ({ ...current, [group.label]: !isOpen }))}
                    aria-expanded={hasChildren ? isOpen : undefined}
                    aria-label={collapsed ? group.label : undefined}
                    className={cn(
                      itemBase,
                      collapsed ? itemCollapsed : "w-full px-3 py-2",
                      groupActive && !collapsed ? "text-sidebar-foreground" : INACTIVE_GROUP,
                    )}
                  >
                    <GroupIcon className={ICON_CLASS} aria-hidden="true" />
                    {!collapsed ? (
                      <>
                        <span className="truncate">{group.label}</span>
                        <ChevronDown
                          className={cn("ml-auto h-3.5 w-3.5 shrink-0 stroke-current transition-transform", isOpen && "rotate-180")}
                          aria-hidden="true"
                        />
                      </>
                    ) : null}
                  </button>
                </NavTooltip>

                {!collapsed && isOpen ? (
                  <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                    {group.items.map((item) => (
                      <li key={item.to}>{renderItem(item, true)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      {variant === "mobile" ? null : (
        <div className={cn("shrink-0 border-t border-sidebar-border py-3", collapsed ? "px-0 text-center" : "px-4")}>
          {collapsed ? (
            <span className="mx-auto block h-px w-8 bg-sidebar-border/60" aria-hidden="true" />
          ) : (
            <p className="text-[11px] leading-snug text-sidebar-muted">
              Verified workforce data · deterministic risk engine
            </p>
          )}
        </div>
      )}
    </div>
  );
}
