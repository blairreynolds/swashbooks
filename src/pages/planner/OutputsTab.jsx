import { useState } from 'react'
import { SOURCES, calcShoppingList, calcByBar, calcServingsAtBar, findInventory } from '../../lib/plannerCalc'
import { SourceBadge } from './widgets'
import { fmtInt } from '../../lib/format'

const OUTPUTS = [
  { key: 'beam', label: 'Beam-Suntory Order' },
  { key: 'shopping', label: 'Shopping List' },
  { key: 'distribution', label: 'Distribution' },
  { key: 'barsheet', label: 'Bar Sheets' },
  { key: 'menubrief', label: 'Menu Brief' },
]

const Empty = ({ children }) => <div className="card text-faint text-sm text-center py-8">{children}</div>

const byOzDesc = (a, b) => b.oz - a.oz

function BeamOrder({ state }) {
  const items = Object.values(calcShoppingList(state).beam || {}).sort(byOzDesc)
  const { bottleOz, attendees, drinksPer, overageSpirits, name } = state.event
  if (!items.length) return <Empty>No Beam-Suntory items found. Tag ingredients with the "Beam-Suntory" source.</Empty>
  return (
    <div className="card">
      <div className="mb-3">
        <div className="font-display text-lg">{name} — Beam-Suntory Sponsorship Request</div>
        <div className="text-faint text-xs">Based on {attendees} attendees × {drinksPer} drinks, {overageSpirits}% overage buffer</div>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Spirit / product</th><th className="td-num">Total oz needed</th><th className="td-num">750ml bottles</th><th className="td-num">Cases (12-pk)</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const bottles = Math.ceil(item.oz / bottleOz)
            const inv = findInventory(state, item.name)
            const inHand = inv ? inv.inHand : 0
            const stillNeed = Math.max(0, bottles - inHand)
            return (
              <tr key={item.name}>
                <td className="font-semibold">{item.name}</td>
                <td className="td-num">{fmtInt(item.oz)}</td>
                <td className="td-num">{bottles} <span className="text-faint text-xs">({inHand} on hand)</span></td>
                <td className={`td-num font-semibold ${stillNeed > 0 ? 'text-gold' : 'text-grn'}`}>
                  {stillNeed > 0 ? `${Math.ceil(stillNeed / 12)} cases` : '✓ covered'}
                </td>
                <td className="text-faint text-xs">{inv?.notes || ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const SHOPPING_SECTIONS = [
  { key: 'you', label: 'You Buy (BG Reynolds + specialty)' },
  { key: 'rd', label: 'Restaurant Depot' },
  { key: 'nick', label: 'Bar Manager (Nick) supplies' },
  { key: 'sponsor', label: 'Sponsored / Provided' },
]

function ShoppingList({ state }) {
  const list = calcShoppingList(state)
  const { bottleOz, snpOz } = state.event
  const sections = SHOPPING_SECTIONS
    .map((sec) => ({ ...sec, items: Object.values(list[sec.key] || {}).sort(byOzDesc) }))
    .filter((sec) => sec.items.length)
  if (!sections.length) return <Empty>Add drinks with ingredients to generate a shopping list.</Empty>
  return sections.map((sec) => (
    <div key={sec.key} className="card">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-semibold" style={{ color: SOURCES[sec.key].color }}>{sec.label}</span>
        <span className="text-faint text-xs">{sec.items.length} items</span>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Item</th><th className="td-num">oz needed</th><th className="td-num">Bottles / containers</th><th className="td-num">Stor'n Pours ({snpOz} oz)</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {sec.items.map((item) => (
            <tr key={item.name}>
              <td className="font-semibold">{item.name}</td>
              <td className="td-num">{fmtInt(item.oz)}</td>
              <td className="td-num">{Math.ceil(item.oz / bottleOz)}</td>
              <td className="td-num">{Math.ceil(item.oz / snpOz)}</td>
              <td className="text-faint text-xs">{findInventory(state, item.name)?.notes || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ))
}

function Distribution({ state }) {
  const rows = calcByBar(state).filter((b) => b.ingredients.length)
  const { bottleOz, snpOz, galOz } = state.event
  if (!rows.length) return <Empty>Assign drinks to bars (Bars tab) to generate a distribution list. Servings are calculated automatically from attendee count.</Empty>
  return rows.map(({ bar, ingredients }) => (
    <div key={bar.id} className="card">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-display text-lg">{bar.name}</span>
        <span className="text-faint text-sm">{bar.location}</span>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {bar.drinks.filter((a) => a.drinkId).map((a) => {
          const d = state.drinks.find((x) => x.id === a.drinkId)
          if (!d) return null
          const srv = a.override > 0 ? a.override : Math.round(calcServingsAtBar(state, a.drinkId, bar.id))
          return <span key={a.id} className="chip chip-green">{d.name}: {srv} srv</span>
        })}
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Ingredient</th><th>Source</th><th className="td-num">oz total</th><th className="td-num">Bottles</th><th className="td-num">Stor'n Pours</th><th className="td-num">Backup gallons</th></tr>
        </thead>
        <tbody>
          {[...ingredients].sort(byOzDesc).map((ing) => {
            const isLiquid = !['beam', 'nick'].includes(ing.source) || ing.name.toLowerCase().includes('mix')
            return (
              <tr key={ing.name}>
                <td className="font-semibold">{ing.name}</td>
                <td><SourceBadge source={ing.source} /></td>
                <td className="td-num">{fmtInt(ing.oz)}</td>
                <td className="td-num">{isLiquid ? '—' : Math.ceil(ing.oz / bottleOz)}</td>
                <td className="td-num">{isLiquid ? Math.ceil(ing.oz / snpOz) : '—'}</td>
                <td className="td-num text-faint">{isLiquid ? Math.ceil(ing.oz / galOz) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {bar.notes && <div className="text-faint text-xs mt-2 pt-2 border-t border-bdr">📌 {bar.notes}</div>}
    </div>
  ))
}

function BarSheets({ state }) {
  if (!state.bars.length) return <Empty>No bars yet.</Empty>
  return state.bars.map((bar) => {
    const drinks = bar.drinks.map((a) => state.drinks.find((d) => d.id === a.drinkId)).filter(Boolean)
    return (
      <div key={bar.id} className="card break-inside-avoid">
        <div className="flex justify-between items-baseline mb-3 gap-4">
          <div>
            <div className="font-display text-xl">{bar.name}</div>
            <div className="text-faint text-sm">{bar.location}</div>
          </div>
          <div className="text-right text-xs text-muted">
            <div>Shift 1: {bar.shift1}</div>
            <div>Shift 2: {bar.shift2}</div>
          </div>
        </div>
        {bar.equipment.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-3">
            {bar.equipment.map((e) => <span key={e} className="chip chip-muted">{e}</span>)}
          </div>
        )}
        {drinks.length ? (
          <>
            <div className="text-faint text-[10px] uppercase tracking-widest font-semibold mb-1">Menu</div>
            {drinks.map((d, i) => (
              <div key={`${d.id}-${i}`} className="py-2 border-b border-bdr">
                <div className="flex justify-between items-baseline gap-3">
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-xs text-muted">{d.servingOz} oz serving · {d.garnish || 'no garnish'}</div>
                </div>
                {d.description && <div className="text-sm text-muted mt-0.5">{d.description}</div>}
                <div className="flex gap-1.5 flex-wrap mt-1.5">
                  {d.ingredients.map((ing, j) => (
                    <span key={j} className="chip chip-muted font-normal">{ing.oz} oz {ing.name}</span>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : <div className="text-faint text-sm">No drinks assigned</div>}
        {bar.notes && <div className="mt-3 p-2 rounded bg-card2 text-sm text-muted">📌 {bar.notes}</div>}
      </div>
    )
  })
}

function MenuBrief({ state }) {
  const bars = state.bars
    .map((bar) => ({ bar, drinks: bar.drinks.map((a) => state.drinks.find((d) => d.id === a.drinkId)).filter(Boolean) }))
    .filter((b) => b.drinks.length)
  if (!bars.length) return <Empty>Assign drinks to bars to generate the menu brief.</Empty>
  return (
    <>
      <div className="card">
        <div className="font-display text-lg">{state.event.name} — Menu Brief</div>
        <div className="text-faint text-sm">For graphic design. Each bar's assigned drinks with full descriptions and garnish.</div>
      </div>
      {bars.map(({ bar, drinks }) => (
        <div key={bar.id} className="card break-inside-avoid">
          <div className="flex items-baseline justify-between gap-3 mb-3 pb-2 border-b border-bdr flex-wrap">
            <div>
              <div className="font-display text-xl">{bar.name}</div>
              <div className="text-faint text-sm">{bar.location}</div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {bar.equipment.map((e) => <span key={e} className="chip chip-muted">{e}</span>)}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {drinks.map((d, i) => {
              const isNA = d.type === 'na'
              return (
                <div
                  key={`${d.id}-${i}`}
                  className="grid grid-cols-[1fr_auto] gap-4 p-3 rounded bg-card2"
                  style={{ borderLeft: `3px solid ${isNA ? SOURCES.rd.color : 'var(--gold)'}` }}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{d.name}</span>
                      {isNA && <SourceBadge source="rd" />}
                    </div>
                    {d.description
                      ? <div className="text-sm text-muted">{d.description}</div>
                      : <div className="text-xs text-faint italic">No description added</div>}
                  </div>
                  <div className="text-right">
                    {d.garnish && (
                      <>
                        <div className="text-[10px] uppercase tracking-wider text-faint font-semibold">Garnish</div>
                        <div className="text-sm">{d.garnish}</div>
                      </>
                    )}
                    <div className="text-xs text-faint mt-1">{d.servingOz} oz</div>
                  </div>
                </div>
              )
            })}
          </div>
          {bar.notes && <div className="text-faint text-xs mt-3 pt-2 border-t border-bdr">📌 {bar.notes}</div>}
        </div>
      ))}
    </>
  )
}

const VIEWS = { beam: BeamOrder, shopping: ShoppingList, distribution: Distribution, barsheet: BarSheets, menubrief: MenuBrief }

export default function OutputsTab({ state }) {
  const [which, setWhich] = useState('beam')
  const View = VIEWS[which]
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div className="flex gap-1 flex-wrap">
          {OUTPUTS.map((o) => (
            <button key={o.key} className={`btn btn-sm ${which === o.key ? 'btn-primary' : ''}`} onClick={() => setWhich(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      <View state={state} />
    </>
  )
}
