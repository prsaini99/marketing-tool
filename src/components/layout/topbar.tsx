import { AccountSwitcher } from "./account-switcher";
import { UserMenu } from "./user-menu";
import type { AccountBusinessMap } from "@/lib/active-business";

interface TopbarProps {
  businesses: Array<{ id: string; name: string }>;
  accountToBusiness: AccountBusinessMap;
}

export function Topbar({ businesses, accountToBusiness }: TopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex items-center gap-2">
        <AccountSwitcher
          businesses={businesses}
          accountToBusiness={accountToBusiness}
        />
      </div>
      <div className="flex items-center gap-3">
        <UserMenu />
      </div>
    </header>
  );
}
