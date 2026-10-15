// Tabs a crew member can be granted. Keys match the database's has_tab() checks
// (migration 006). Settings isn't listed: it is admin-only.
export const TAB_ACCESS = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'transactions', label: 'Transactions', path: '/transactions' },
  { key: 'bills', label: 'Bills', path: '/bills' },
  { key: 'invoices', label: 'Invoices', path: '/invoices' },
  { key: 'donations', label: 'Donations', path: '/donations' },
  { key: 'sponsors', label: 'Sponsors', path: '/sponsors' },
  { key: 'contacts', label: 'Contacts', path: '/contacts' },
  { key: 'budget', label: 'Budget', path: '/budget' },
  { key: 'planner', label: 'Planner', path: '/planner' },
  { key: 'import', label: 'Import', path: '/import' },
]
