/** Only inspect the signed-in account switcher or that account's own profile heading. */
export function ownBlueBadge(doc: Document, username: string, pathname: string): boolean | undefined {
  const ownProfile = pathname.replace(/\/$/, '').toLowerCase() === '/' + username.toLowerCase();
  const roots = [doc.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
    ...(ownProfile && username ? [doc.querySelector('[data-testid="UserName"]')] : [])];
  const view = doc.defaultView;
  if (!view) return undefined;
  const isBlue = (value: string) => ['rgb(29,155,240)', 'rgb(29,161,242)', '#1d9bf0', '#1da1f2'].includes(value.toLowerCase().replace(/\s/g, ''));
  for (const root of roots) {
    for (const icon of root?.querySelectorAll('[data-testid="icon-verified"], [aria-label="Verified account" i], [aria-label="认证账号"], [aria-label="已认证账号"]') ?? []) {
      const style = view.getComputedStyle(icon);
      if (isBlue(style.color) || isBlue(style.fill)) return true;
    }
  }
  // No badge is not evidence of no subscription: Basic has long posts without a blue badge.
  return undefined;
}
