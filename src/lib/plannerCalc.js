// Bar-program calculation engine, ported from the standalone planner
// (event-planner/swashball-planner.html). Every function is pure over a
// `state` in the original planner's shape:
//   event:     { name, date, attendees, drinksPer, snpOz, galOz, bucketOz, bottleOz,
//                overageSpirits, overageMix, overageGarnish }
//   bars[]:    { id, name, location, shift1, shift2, equipment[], notes, volumeWeight,
//                drinks[{ id, drinkId, vessel, override }] }
//   drinks[]:  { id, type, name, active, servingOz, description, garnish, notes,
//                ingredients[{ name, oz, source }] }
//   inventory[]: { id, name, source, inHand, unit, notes }
//
// Model:
//   Total cocktail servings = attendees × drinksPer
//   Each active cocktail gets totalServings / numActiveCocktails
//   Each bar serving that cocktail gets cocktailServings × (bar weight / sum of weights
//   of bars serving it); a per-assignment override replaces the calculated number.
//   Active cocktails assigned to no bar count at their full allocation.

export const SOURCES = {
  beam:    { label: 'Beam-Suntory', color: '#e8a020' },
  rd:      { label: 'Restaurant Depot', color: '#5ba0d0' },
  you:     { label: 'You Buy', color: '#3d8c5e' },
  nick:    { label: 'Bar Manager', color: '#9060c0' },
  sponsor: { label: 'Sponsored', color: '#c87030' },
}

export const DRINK_TYPES = { cocktail: 'Cocktail', beer: 'Beer/Wine', na: 'Non-Alcoholic' }

export const EQUIPMENT_OPTIONS = [
  'Kegerator', 'Slushee Machine', 'Air Pot', 'Portable Bar',
  'Ice Bin/Cooler', 'Dump Bucket', "Stor'n Pour Station", 'Speed Rail', 'POS Terminal',
]

export const VESSELS = {
  snp: "Stor'n Pour", gallon: 'Gallon jug', bucket: 'Bucket', bottle: 'Bottle', keg: 'Keg', can: 'Cans',
}

export function getActiveCocktails(state) {
  return state.drinks.filter((d) => d.active && d.type === 'cocktail')
}

export function getTotalServings(state) {
  const { attendees, drinksPer } = state.event
  return attendees * drinksPer
}

export function getServingsPerCocktail(state) {
  const active = getActiveCocktails(state)
  if (!active.length) return 0
  return getTotalServings(state) / active.length
}

export function getBarsServingDrink(state, drinkId) {
  return state.bars.filter((bar) => (bar.drinks || []).some((a) => a.drinkId === drinkId))
}

// Calculated servings of drinkId at barId (before override)
export function calcServingsAtBar(state, drinkId, barId) {
  const drink = state.drinks.find((d) => d.id === drinkId)
  if (!drink || !drink.active) return 0
  const srvPerCocktail = getServingsPerCocktail(state)
  const servingBars = getBarsServingDrink(state, drinkId)
  if (!servingBars.length) return srvPerCocktail
  const totalWeight = servingBars.reduce((s, b) => s + (b.volumeWeight || 1), 0)
  const bar = state.bars.find((b) => b.id === barId)
  const weight = bar ? (bar.volumeWeight || 1) : 1
  return srvPerCocktail * (weight / totalWeight)
}

export function effectiveServings(state, assignment, barId) {
  if (assignment.override > 0) return assignment.override
  return calcServingsAtBar(state, assignment.drinkId, barId)
}

function overageFor(state, source) {
  const { overageSpirits, overageMix } = state.event
  const isSpirit = ['beam', 'nick'].includes(source)
  return 1 + (isSpirit ? overageSpirits : overageMix) / 100
}

// { lowercased ingredient name: oz needed incl. overage }
export function calcNeededIngredients(state) {
  const needed = {}
  const add = (ing, servings) => {
    if (!ing.name) return
    const key = ing.name.toLowerCase()
    needed[key] = (needed[key] || 0) + ing.oz * servings * overageFor(state, ing.source)
  }

  state.bars.forEach((bar) => {
    (bar.drinks || []).forEach((a) => {
      const drink = state.drinks.find((d) => d.id === a.drinkId)
      if (!drink) return
      const servings = effectiveServings(state, a, bar.id)
      ;(drink.ingredients || []).forEach((ing) => add(ing, servings))
    })
  })

  getActiveCocktails(state).forEach((drink) => {
    if (getBarsServingDrink(state, drink.id).length) return
    const servings = getServingsPerCocktail(state)
    ;(drink.ingredients || []).forEach((ing) => add(ing, servings))
  })

  return needed
}

// [{ bar, ingredients: [{ name, source, oz }] }]
export function calcByBar(state) {
  return state.bars.map((bar) => {
    const ingredients = {}
    ;(bar.drinks || []).forEach((a) => {
      const drink = state.drinks.find((d) => d.id === a.drinkId)
      if (!drink) return
      const servings = effectiveServings(state, a, bar.id)
      ;(drink.ingredients || []).forEach((ing) => {
        if (!ing.name) return
        const key = ing.name
        if (!ingredients[key]) ingredients[key] = { name: key, source: ing.source, oz: 0 }
        ingredients[key].oz += ing.oz * servings * overageFor(state, ing.source)
      })
    })
    return { bar, ingredients: Object.values(ingredients) }
  })
}

// { source: { ingredient name: { name, oz, source } } }
export function calcShoppingList(state) {
  const bySource = {}
  Object.keys(SOURCES).forEach((k) => { bySource[k] = {} })

  const addIng = (ing, servings) => {
    if (!ing.name) return
    const src = ing.source || 'you'
    if (!bySource[src]) bySource[src] = {}
    if (!bySource[src][ing.name]) bySource[src][ing.name] = { name: ing.name, oz: 0, source: src }
    bySource[src][ing.name].oz += ing.oz * servings * overageFor(state, src)
  }

  state.bars.forEach((bar) => {
    (bar.drinks || []).forEach((a) => {
      const drink = state.drinks.find((d) => d.id === a.drinkId)
      if (!drink) return
      const servings = effectiveServings(state, a, bar.id)
      ;(drink.ingredients || []).forEach((ing) => addIng(ing, servings))
    })
  })

  getActiveCocktails(state).forEach((drink) => {
    if (getBarsServingDrink(state, drink.id).length) return
    const servings = getServingsPerCocktail(state)
    ;(drink.ingredients || []).forEach((ing) => addIng(ing, servings))
  })

  return bySource
}

// Pre-batch volume across active cocktails at an even split (Setup stat).
export function calcTotalMixOz(state) {
  const per = getServingsPerCocktail(state)
  return getActiveCocktails(state).reduce(
    (sum, d) => sum + (d.ingredients || []).reduce((s, ing) => s + ing.oz * per, 0), 0)
}

// Inventory is counted in its own unit; needed amounts are in oz. Returns oz
// per one unit of `unit`, or null when the unit can't be converted (e.g. cans).
export function ozPerUnit(unit, bottleOz) {
  const u = String(unit || '').trim().toLowerCase()
  if (u === 'oz' || u === 'ounces') return 1
  if (u === 'bottles' || u === 'bottle') return bottleOz
  return null
}

export function findInventory(state, name) {
  return state.inventory.find((i) => i.name.toLowerCase() === name.toLowerCase())
}
