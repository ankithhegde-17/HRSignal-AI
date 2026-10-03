import { Link } from "react-router-dom";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToneBadge } from "@/components/shared/badges";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { initials } from "@/lib/format";
import { useAuth } from "@/providers/auth-provider";

export function UserMenu() {
  const { profile, user, signOut } = useAuth();
  const role = (profile?.role ?? "hr") as Role;
  const name = profile?.full_name ?? user?.email ?? "Signed in";
  const settingsPath = role === "founder" ? "/executive/settings" : "/settings";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Account menu">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-col items-start leading-tight lg:flex">
            <span className="max-w-[10rem] truncate text-xs font-medium text-foreground">{name}</span>
            <span className="text-[11px] text-muted-foreground">{ROLE_LABELS[role]}</span>
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground lg:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user?.email}</span>
          <ToneBadge tone={role === "founder" ? "insight" : "primary"} className="mt-1 w-fit">
            {ROLE_LABELS[role]}
          </ToneBadge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={settingsPath}>
            <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={settingsPath}>
            <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
