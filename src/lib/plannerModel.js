// Seed plan from the standalone planner's DEFAULT_STATE (pre-loaded from the
// crew's spreadsheet). Ids are assigned when the plan is created.
export const PLANNER_DEFAULTS = {
  event: {
    attendees: 700, drinksPer: 2, snpOz: 128, galOz: 128, bucketOz: 512, bottleOz: 25.4,
    overageSpirits: 10, overageMix: 15, overageGarnish: 20,
  },
  bars: [
    { name: 'VIP Welcome', location: 'Main Entrance', shift1: '2 Volunteers 5–7pm only', shift2: 'Closed', equipment: ['Air Pot'], notes: 'Opens 5–7pm only. Welcome drink station.', drinks: [], volumeWeight: 0.75 },
    { name: 'Port Pub', location: 'Service Bar', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Speed Rail'], notes: 'Canned & sponsored products.', drinks: [], volumeWeight: 1.0 },
    { name: 'Starboard Tavern', location: 'Service Bar 2', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Air Pot'], notes: '', drinks: [], volumeWeight: 1.0 },
    { name: 'Gun Deck', location: 'Main Bar', shift1: '2 Bartenders', shift2: '2 Bartenders', equipment: ['Slushee Machine', 'Air Pot', 'Kegerator'], notes: 'Main bar. Slushee = Hurricane only.', drinks: [], volumeWeight: 1.5 },
    { name: 'Orc Belly', location: 'Card Room', shift1: '1 Bartender + 2 Volunteers', shift2: '1 Bartender + 2 Volunteers', equipment: ['Air Pot'], notes: '', drinks: [], volumeWeight: 1.0 },
    { name: 'Second Star to the Right', location: 'Sports Bar', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Air Pot'], notes: 'Skull shot glasses. Gold cube ice.', drinks: [], volumeWeight: 1.0 },
    { name: "Calypso's Cabin", location: "Nana's Closet", shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Ice Bin/Cooler', 'Dump Bucket'], notes: 'Seltzer and pineapple on site to dilute.', drinks: [], volumeWeight: 1.0 },
    { name: "Tiki's Sunset Hideaway", location: 'Bowling Alley', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Portable Bar', 'Air Pot'], notes: 'Sponsored by Just Rum. Skull glasses.', drinks: [], volumeWeight: 1.0 },
    { name: 'Velvet Corsair Masquerade', location: 'Antler Main', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Portable Bar', 'Air Pot', 'Dump Bucket'], notes: '', drinks: [], volumeWeight: 1.0 },
    { name: 'Bilge', location: 'Gym Room', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Ice Bin/Cooler', 'Dump Bucket'], notes: 'Ginger Cult + shot station.', drinks: [], volumeWeight: 1.0 },
    { name: "Davy Jones' Locker", location: '1st Floor Hall', shift1: '1 Bartender', shift2: '1 Bartender', equipment: ['Ice Bin/Cooler', 'Dump Bucket'], notes: 'Red cube ice. Shot glasses.', drinks: [], volumeWeight: 1.0 },
  ],
  drinks: [
    { type: 'cocktail', name: "Cruz 'n Cola", active: true, servingOz: 5.25, description: "Can't beat the classic with Cruzan Dark Rum.", ingredients: [{ name: 'Cruzan Dark Rum', oz: 1.25, source: 'beam' }, { name: 'Cola', oz: 4.0, source: 'nick' }], garnish: 'Lime wedge', notes: 'Standard' },
    { type: 'cocktail', name: 'Effen Bloody Mary', active: true, servingOz: 5.25, description: 'For a Bloody Effen good time.', ingredients: [{ name: 'Vodka (Effen)', oz: 1.25, source: 'beam' }, { name: 'Bloody Mix', oz: 4.0, source: 'you' }], garnish: 'Celery stick', notes: 'Pre-batch mix' },
    { type: 'cocktail', name: 'Hurricane (Slush)', active: true, servingOz: 8, description: 'BG Reynolds Hurricane — Overproof Rum + Fassionola.', ingredients: [{ name: 'Hurricane Mix', oz: 4.0, source: 'you' }, { name: 'Overproof Rum', oz: 2.0, source: 'beam' }, { name: 'Water', oz: 2.0, source: 'nick' }], garnish: 'Pineapple wedge', notes: 'Slushee machine only — Gun Deck' },
    { type: 'cocktail', name: 'Hot Toddy', active: true, servingOz: 4.5, description: 'Warms yer innerds — Jim Beam Black, Honey, Lemon.', ingredients: [{ name: 'Whiskey (Jim Beam Black)', oz: 1.5, source: 'beam' }, { name: 'Hot Water', oz: 2.0, source: 'nick' }, { name: 'Toddy Mix (Honey + Lemon)', oz: 1.0, source: 'you' }], garnish: 'Lemon curl', notes: 'Air Pot for hot water' },
    { type: 'cocktail', name: "Dark 'n Stormy", active: true, servingOz: 7.5, description: 'Ginger Cult Ginger Beer + Cruzan Dark.', ingredients: [{ name: 'Ginger Cult GB', oz: 6.0, source: 'sponsor' }, { name: 'Cruzan Dark Rum', oz: 1.5, source: 'beam' }], garnish: 'Lime', notes: 'Ginger Cult sponsored' },
    { type: 'cocktail', name: 'Happy Thoughts', active: true, servingOz: 7.5, description: 'A wink to the moon — -196 seltzer, Honey, Gin, Fairy Dust.', ingredients: [{ name: '-196 Seltzer', oz: 6.0, source: 'beam' }, { name: 'Honey Mix', oz: 0.5, source: 'you' }, { name: 'Gin', oz: 1.0, source: 'beam' }], garnish: 'Lemon curl + glitter', notes: 'Second Star to the Right only' },
    { type: 'cocktail', name: 'Peach Bellini', active: true, servingOz: 5, description: 'Even Blackbeard loved his bubbles.', ingredients: [{ name: 'Prosecco', oz: 4.0, source: 'nick' }, { name: 'Peach Syrup/Puree', oz: 1.0, source: 'rd' }], garnish: '', notes: 'Prosecco poured on top of pre-batched syrup' },
    { type: 'cocktail', name: "Shark's Tooth", active: true, servingOz: 3.25, description: 'Stiff, bitter, slightly sweet. Cruzan Dark, Grenadine, Lime, Pineapple.', ingredients: [{ name: 'Cruzan Dark Rum', oz: 1.5, source: 'beam' }, { name: 'Grenadine', oz: 0.75, source: 'you' }, { name: 'Lime Juice', oz: 0.5, source: 'rd' }, { name: 'Pineapple Juice', oz: 0.5, source: 'rd' }], garnish: '', notes: '' },
    { type: 'cocktail', name: 'N/A Mai Tai', active: true, servingOz: 8, description: 'BG Reynolds Mai Tai Mix — tropical without the rum.', ingredients: [{ name: 'BG Reynolds Mai Tai Mix', oz: 6.0, source: 'you' }, { name: 'Seltzer', oz: 2.0, source: 'rd' }], garnish: 'Mint', notes: 'Non-alcoholic' },
    { type: 'cocktail', name: 'SparkleStorm / Sbagliato', active: true, servingOz: 6.5, description: 'Welcome drink — Negroni Sbagliato with sparkle.', ingredients: [{ name: 'Sparkle Mix (Negroni base)', oz: 0.5, source: 'you' }, { name: 'Prosecco', oz: 6.0, source: 'nick' }], garnish: 'Orange peel', notes: 'VIP Welcome only — prosecco poured on top' },
    { type: 'na', name: 'GlitterStorm N/A', active: true, servingOz: 8, description: 'Hurricane Mix + glitter — non-alcoholic.', ingredients: [{ name: 'Hurricane Mix', oz: 7.0, source: 'you' }], garnish: 'Glitter', notes: 'VIP Welcome N/A option' },
  ],
  inventory: [
    { name: 'Cruzan Dark Rum', source: 'beam', inHand: 48, unit: 'bottles', notes: '750ml each' },
    { name: 'Overproof Rum', source: 'beam', inHand: 36, unit: 'bottles', notes: '' },
    { name: 'Whiskey (Jim Beam Black)', source: 'beam', inHand: 50, unit: 'bottles', notes: '' },
    { name: 'Vodka (Effen)', source: 'beam', inHand: 24, unit: 'bottles', notes: '' },
    { name: 'Gin', source: 'beam', inHand: 24, unit: 'bottles', notes: '' },
    { name: '-196 Seltzer', source: 'beam', inHand: 288, unit: 'cans', notes: '' },
    { name: 'Kilbeggan Whiskey', source: 'beam', inHand: 17, unit: 'bottles', notes: 'Skull shots — Second Star' },
    { name: 'Hurricane Mix', source: 'you', inHand: 0, unit: 'bottles', notes: 'BG Reynolds' },
    { name: 'Mai Tai Mix', source: 'you', inHand: 0, unit: 'bottles', notes: 'BG Reynolds' },
    { name: 'Bloody Mix', source: 'you', inHand: 0, unit: 'bottles', notes: 'BG Reynolds custom' },
    { name: 'Honey Mix', source: 'you', inHand: 0, unit: 'bottles', notes: 'BG Reynolds' },
    { name: "Shark's Tooth Mix", source: 'you', inHand: 0, unit: 'bottles', notes: '' },
    { name: 'Lime Juice', source: 'rd', inHand: 0, unit: 'oz', notes: '32oz containers' },
    { name: 'Pineapple Juice', source: 'rd', inHand: 0, unit: 'oz', notes: '46oz containers' },
    { name: 'Orange Juice', source: 'rd', inHand: 0, unit: 'oz', notes: '' },
    { name: 'Peach Syrup/Puree', source: 'rd', inHand: 0, unit: 'oz', notes: '' },
  ],
}

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

// Database rows → the calc engine's state shape.
export function rowsToState(plan, eventYear) {
  const s = plan.settings
  return {
    event: {
      name: eventYear?.label ?? '',
      date: eventYear?.event_date ?? '',
      attendees: num(s.attendees),
      drinksPer: num(s.drinks_per),
      snpOz: num(s.snp_oz, 128),
      galOz: num(s.gal_oz, 128),
      bucketOz: num(s.bucket_oz, 512),
      bottleOz: num(s.bottle_oz, 25.4),
      overageSpirits: num(s.overage_spirits),
      overageMix: num(s.overage_mix),
      overageGarnish: num(s.overage_garnish),
    },
    bars: [...plan.bars].sort(bySort).map((b) => ({
      id: b.id,
      name: b.name ?? '',
      location: b.location ?? '',
      shift1: b.shift1 ?? '',
      shift2: b.shift2 ?? '',
      equipment: b.equipment ?? [],
      notes: b.notes ?? '',
      volumeWeight: num(b.volume_weight, 1),
      drinks: plan.assignments
        .filter((a) => a.bar_id === b.id)
        .sort(bySort)
        .map((a) => ({ id: a.id, drinkId: a.drink_id ?? '', vessel: a.vessel, override: num(a.override_servings) })),
    })),
    drinks: [...plan.drinks].sort(bySort).map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name ?? '',
      active: d.active,
      servingOz: num(d.serving_oz),
      description: d.description ?? '',
      garnish: d.garnish ?? '',
      notes: d.notes ?? '',
      ingredients: (d.ingredients ?? []).map((i) => ({ name: i.name ?? '', oz: num(i.oz), source: i.source || 'you' })),
    })),
    inventory: [...plan.inventory].sort(bySort).map((i) => ({
      id: i.id,
      name: i.name ?? '',
      source: i.source,
      inHand: num(i.in_hand),
      unit: i.unit ?? '',
      notes: i.notes ?? '',
    })),
  }
}

// A state-shaped plan (seed, another year's plan, or a standalone-planner JSON
// export) → planner_replace payload with fresh ids and assignments remapped.
export function stateToPayload(state) {
  if (!state || !Array.isArray(state.bars) || !Array.isArray(state.drinks)) {
    throw new Error("This doesn't look like a planner export (missing bars/drinks).")
  }
  const e = state.event ?? {}
  const drinkIdMap = {}
  const drinks = state.drinks.map((d, i) => {
    const id = crypto.randomUUID()
    if (d.id) drinkIdMap[d.id] = id
    return {
      id,
      type: ['cocktail', 'beer', 'na'].includes(d.type) ? d.type : 'cocktail',
      name: d.name ?? '',
      active: d.active !== false,
      serving_oz: num(d.servingOz, 5),
      description: d.description ?? '',
      garnish: d.garnish ?? '',
      notes: d.notes ?? '',
      ingredients: (d.ingredients ?? []).map((ing) => ({
        name: ing.name ?? '', oz: num(ing.oz), source: ing.source || 'you',
      })),
      sort_order: i,
    }
  })

  const assignments = []
  const bars = state.bars.map((b, i) => {
    const id = crypto.randomUUID()
    ;(b.drinks ?? []).forEach((a, j) => {
      assignments.push({
        id: crypto.randomUUID(),
        bar_id: id,
        // Assignments pointing at a drink that no longer exists stay as an
        // unpicked row, matching how the standalone planner displayed them.
        drink_id: drinkIdMap[a.drinkId] ?? null,
        vessel: a.vessel || 'snp',
        override_servings: num(a.override),
        sort_order: j,
      })
    })
    return {
      id,
      name: b.name ?? '',
      location: b.location ?? '',
      shift1: b.shift1 ?? '',
      shift2: b.shift2 ?? '',
      equipment: Array.isArray(b.equipment) ? b.equipment : [],
      notes: b.notes ?? '',
      volume_weight: num(b.volumeWeight, 1) || 1,
      sort_order: i,
    }
  })

  const inventory = (state.inventory ?? []).map((it, i) => ({
    id: crypto.randomUUID(),
    name: it.name ?? '',
    source: it.source || 'you',
    in_hand: num(it.inHand),
    unit: it.unit || 'bottles',
    notes: it.notes ?? '',
    sort_order: i,
  }))

  const settings = {
    attendees: Math.round(num(e.attendees, 700)) || 700,
    drinks_per: num(e.drinksPer, 2) || 2,
    snp_oz: num(e.snpOz, 128) || 128,
    gal_oz: num(e.galOz, 128) || 128,
    bucket_oz: num(e.bucketOz, 512) || 512,
    bottle_oz: num(e.bottleOz, 25.4) || 25.4,
    overage_spirits: num(e.overageSpirits, 10),
    overage_mix: num(e.overageMix, 15),
    overage_garnish: num(e.overageGarnish, 20),
  }

  return { settings, bars, drinks, assignments, inventory }
}
