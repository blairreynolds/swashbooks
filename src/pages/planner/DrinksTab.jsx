import { DRINK_TYPES } from '../../lib/plannerCalc'
import { Field, NumField, ConfirmButton, SourceBadge, SourceSelect, JumpChips } from './widgets'

const NEW_DRINK = {
  cocktail: { serving_oz: 5, ingredients: [{ name: '', oz: 1.5, source: 'beam' }] },
  beer: { serving_oz: 12, ingredients: [{ name: '', oz: 12, source: 'nick' }] },
  na: { serving_oz: 12, ingredients: [{ name: '', oz: 8, source: 'rd' }] },
}

function DrinkCard({ d, store }) {
  const set = (patch) => store.update('planner_drinks', d.id, patch)
  const ingredients = d.ingredients ?? []
  const setIng = (i, patch) => set({ ingredients: ingredients.map((ing, j) => (j === i ? { ...ing, ...patch } : ing)) })
  const total = ingredients.reduce((s, i) => s + (Number(i.oz) || 0), 0)

  return (
    <div id={`drink-${d.id}`} className="card flex flex-col gap-3 scroll-mt-20" style={d.active ? undefined : { opacity: 0.6 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="input font-display !text-lg !w-auto flex-1 min-w-48"
          value={d.name}
          placeholder="Drink name"
          onChange={(e) => set({ name: e.target.value })}
        />
        <span className="chip chip-muted">{DRINK_TYPES[d.type] ?? d.type}</span>
        <label className="flex items-center gap-1.5 text-sm text-muted cursor-pointer">
          <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} /> Active
        </label>
        <ConfirmButton onConfirm={() => store.remove('planner_drinks', d.id)}>Remove drink</ConfirmButton>
      </div>

      <div className="grid md:grid-cols-[2fr_1fr_1fr] gap-3">
        <Field label="Menu description">
          <input className="input" value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Serving size (oz)">
          <NumField value={d.serving_oz} min="0" step="0.25" onChange={(v) => set({ serving_oz: v })} />
        </Field>
        <Field label="Garnish">
          <input className="input" value={d.garnish ?? ''} onChange={(e) => set({ garnish: e.target.value })} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[1fr_90px_150px_130px_32px] gap-2 text-[10px] uppercase tracking-wider text-faint">
          <span>Ingredient</span><span>oz / serving</span><span>Source</span><span /><span />
        </div>
        {ingredients.map((ing, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_150px_130px_32px] gap-2 items-center">
            <input className="input" value={ing.name} placeholder="Ingredient" onChange={(e) => setIng(i, { name: e.target.value })} />
            <NumField value={ing.oz} min="0" step="0.25" onChange={(v) => setIng(i, { oz: v })} />
            <SourceSelect value={ing.source || 'you'} onChange={(v) => setIng(i, { source: v })} />
            <span><SourceBadge source={ing.source || 'you'} /></span>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              title="Remove ingredient"
              onClick={() => set({ ingredients: ingredients.filter((_, j) => j !== i) })}
            >×</button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-sm" onClick={() => set({ ingredients: [...ingredients, { name: '', oz: 1, source: 'you' }] })}>
            + Add ingredient
          </button>
        </div>
      </div>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <Field label="Notes" className="flex-1 min-w-60 max-w-md">
          <input className="input" value={d.notes ?? ''} placeholder="Prep notes, assignments…" onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <div className="text-right">
          <div className="text-faint text-xs">Total per serving</div>
          <div className="font-mono text-lg">{total.toFixed(2)} oz</div>
        </div>
      </div>
    </div>
  )
}

export default function DrinksTab({ store }) {
  const { plan } = store
  const drinks = [...plan.drinks].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  async function addDrink(type) {
    const sort = Math.max(-1, ...plan.drinks.map((d) => d.sort_order ?? 0)) + 1
    const row = await store.insert('planner_drinks', {
      event_year_id: plan.settings.event_year_id, type, name: `New ${DRINK_TYPES[type]}`, active: true,
      description: '', garnish: '', notes: '', sort_order: sort, ...NEW_DRINK[type],
    })
    setTimeout(() => document.getElementById(`drink-${row.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-faint text-sm">Recipes — amounts are per single serving. Only active cocktails share the even serving split.</p>
        <div className="flex gap-2 print:hidden">
          <button className="btn" onClick={() => addDrink('beer')}>+ Beer/Wine</button>
          <button className="btn" onClick={() => addDrink('na')}>+ N/A</button>
          <button className="btn btn-primary" onClick={() => addDrink('cocktail')}>+ Cocktail</button>
        </div>
      </div>
      {Object.keys(DRINK_TYPES).map((type) => {
        const group = drinks.filter((d) => d.type === type)
        if (!group.length) return null
        return (
          <div key={type} className="flex flex-col gap-3">
            <div className="section-title">{DRINK_TYPES[type]}</div>
            <JumpChips items={group.map((d) => ({ id: d.id, name: d.name, dim: !d.active }))} prefix="drink" />
            {group.map((d) => <DrinkCard key={d.id} d={d} store={store} />)}
          </div>
        )
      })}
      {!drinks.length && <div className="card text-faint text-sm text-center py-8">No drinks yet.</div>}
    </>
  )
}
