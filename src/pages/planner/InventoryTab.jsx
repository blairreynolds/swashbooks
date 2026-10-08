import { calcNeededIngredients, calcShoppingList, ozPerUnit } from '../../lib/plannerCalc'
import { NumField, SourceSelect } from './widgets'
import { fmtInt } from '../../lib/format'

function NeededCells({ item, neededOz, bottleOz }) {
  if (!(neededOz > 0)) {
    return (
      <>
        <td className="td-num text-faint" title="Not used by any active recipe or bar assignment">—</td>
        <td className="td-num text-faint">—</td>
      </>
    )
  }
  const per = ozPerUnit(item.unit, bottleOz)
  if (!per) {
    return (
      <>
        <td className="td-num text-muted">{fmtInt(neededOz)} oz</td>
        <td className="td-num text-faint" title={`Can't convert oz to "${item.unit}" — set the unit to oz or bottles to compare`}>?</td>
      </>
    )
  }
  const neededQty = neededOz / per
  const short = Math.max(0, neededQty - (Number(item.in_hand) || 0))
  return (
    <>
      <td className="td-num text-muted">{neededQty.toFixed(1)}</td>
      <td className={`td-num font-semibold ${short > 0 ? 'text-gold' : 'text-grn'}`}>{short > 0 ? `+${short.toFixed(1)}` : '✓'}</td>
    </>
  )
}

export default function InventoryTab({ store, state }) {
  const { plan } = store
  const items = [...plan.inventory].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const needed = calcNeededIngredients(state)
  const bottleOz = state.event.bottleOz
  const set = (id, patch) => store.update('planner_inventory', id, patch)

  // Ingredients the plan needs that have no inventory row (matched by exact name, any case).
  const tracked = new Set(items.map((i) => i.name.trim().toLowerCase()))
  const shopping = calcShoppingList(state)
  const untracked = Object.values(shopping)
    .flatMap((bySrc) => Object.values(bySrc))
    .filter((it) => it.oz > 0 && !tracked.has(it.name.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  function addItem(defaults = {}) {
    const sort = Math.max(-1, ...plan.inventory.map((i) => i.sort_order ?? 0)) + 1
    store.insert('planner_inventory', {
      event_year_id: plan.settings.event_year_id, name: '', source: 'you', in_hand: 0, unit: 'bottles', notes: '', sort_order: sort, ...defaults,
    })
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-faint text-sm">
          On hand vs. needed. "Needed" is shown in each item's own unit — oz, or bottles at {bottleOz} oz each.
        </p>
        <button className="btn btn-primary print:hidden" onClick={() => addItem()}>+ Add item</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th><th>Source</th><th className="td-num">In hand</th><th>Unit</th>
              <th className="td-num">Needed</th><th className="td-num">Still need</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><input className="input min-w-44" value={item.name} placeholder="Item name" onChange={(e) => set(item.id, { name: e.target.value })} /></td>
                <td><SourceSelect className="min-w-36" value={item.source} onChange={(v) => set(item.id, { source: v })} /></td>
                <td><NumField className="!w-24 text-right" value={item.in_hand} min="0" step="0.5" onChange={(v) => set(item.id, { in_hand: v })} /></td>
                <td><input className="input !w-24" value={item.unit} onChange={(e) => set(item.id, { unit: e.target.value })} /></td>
                <NeededCells item={item} neededOz={needed[item.name.toLowerCase()] || 0} bottleOz={bottleOz} />
                <td><input className="input min-w-40" value={item.notes ?? ''} placeholder="Notes" onChange={(e) => set(item.id, { notes: e.target.value })} /></td>
                <td>
                  <button type="button" className="btn btn-sm btn-danger" title="Remove item" onClick={() => store.remove('planner_inventory', item.id)}>×</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={8} className="text-faint text-center py-6">No inventory items yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {untracked.length > 0 && (
        <div className="card flex flex-col gap-2 print:hidden">
          <div className="section-title">Needed but not in inventory</div>
          <p className="text-faint text-xs">
            Recipe ingredients with no inventory row of the exact same name. Add a row to track them —
            or rename an existing row (e.g. "Mai Tai Mix") to match the recipe.
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {untracked.map((it) => (
              <button
                key={`${it.source}:${it.name}`}
                type="button"
                className="btn btn-sm"
                title={`${fmtInt(it.oz)} oz needed — click to add an inventory row`}
                onClick={() => addItem({ name: it.name, source: it.source, unit: it.source === 'beam' || it.source === 'nick' ? 'bottles' : 'oz' })}
              >
                + {it.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
