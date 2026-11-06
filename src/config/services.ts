/**
 * ============================================================================
 *  SERVICE DIRECTORY CONTENT
 * ============================================================================
 * Each entry produces one service page at /services/{slug} plus a card in the
 * directory and homepage grid. Add a service by adding an object here — the
 * routes, sitemap entries, navigation dropdown, search and filtering all pick
 * it up automatically.
 *
 * Writing guidance: keep copy specific to the trade. Avoid invented statistics,
 * pricing promises, response-time guarantees, or licensing claims.
 * ============================================================================
 */

import type { Service, ServiceCategory } from '@/types'

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: 'exterior',
    name: 'Roofing & Exterior',
    description:
      'The parts of your home that take the weather — roofs, windows, doors, siding and hardscape.',
  },
  {
    id: 'systems',
    name: 'Home Systems',
    description: 'Plumbing, heating, cooling and electrical work that keeps the house running.',
  },
  {
    id: 'remodeling',
    name: 'Remodeling',
    description: 'Kitchen, bathroom and bedroom projects that change how a space actually lives.',
  },
  {
    id: 'restoration',
    name: 'Restoration',
    description: 'Response and recovery when water gets somewhere it should not be.',
  },
  {
    id: 'specialty',
    name: 'Specialty Services',
    description: 'Pest control and locksmith work that calls for a dedicated specialist.',
  },
]

export const SERVICES: Service[] = [
  {
    slug: 'roofing',
    name: 'Roofing',
    category: 'exterior',
    icon: 'home',
    image: '/images/service-roofing.jpg',
    featured: true,
    heroHeadline: 'Roofing Options for a Full Replacement or New Install',
    heroSubheadline:
      'Understand what a roof replacement involves, compare materials, and see whether roofing providers are listed in your area.',
    shortDescription:
      'Full roof replacement, tear-offs and new installations, with materials and questions explained before you commit.',
    intro: [
      'A roof is the one part of your home that works every single day, in every season, usually without a second thought — until a stain appears on the ceiling or a shingle shows up in the driveway. A full replacement is a large, structural purchase, and it is normal to feel unsure about how to compare one quote to another.',
      'This page is here to make that comparison less of a guess. You will find the situations that typically lead to a roofing project, the main material categories and how they differ, and the questions worth asking before signing anything. When you are ready, you can check whether roofing providers are listed for your ZIP code.',
    ],
    commonNeeds: [
      {
        title: 'Storm and hail damage',
        description:
          'Missing shingles, dented flashing or granules collecting in the gutters usually mean the roof needs an inspection before the next heavy rain.',
      },
      {
        title: 'Age-related wear',
        description:
          'Most asphalt roofs are rated for roughly 20 to 30 years. Curling edges, bald patches and visible attic daylight are signs the covering is near the end of its service life.',
      },
      {
        title: 'Leaks that keep coming back',
        description:
          'Water travels along decking, so a small ceiling stain is rarely the whole story. Repeat patching often costs more than a planned replacement.',
      },
      {
        title: 'Buying or selling a home',
        description:
          'Roof age and condition come up in nearly every home inspection. A written assessment gives both sides of a transaction something concrete to work from.',
      },
      {
        title: 'Ventilation and skylight changes',
        description:
          'New penetrations, ridge vents and attic ventilation are best planned together with the roofing layer rather than added years later.',
      },
    ],
    options: [
      {
        title: 'Architectural asphalt shingles',
        description:
          'The most common choice for US homes. Layered shingles look more dimensional than flat three-tab, come in a wide color range, and are comparatively straightforward to install and repair.',
      },
      {
        title: 'Metal roofing',
        description:
          'Standing-seam or panel systems that shed snow and rain well and typically carry long service-life ratings. Higher upfront material cost and fewer qualified installers in some areas.',
      },
      {
        title: 'Tile and slate',
        description:
          'Heavy, long-lasting options that suit certain architectural styles. They usually require structural review because of the weight, plus specialized labor.',
      },
      {
        title: 'Low-slope and flat systems',
        description:
          'For porches, additions and modern flat rooflines, contractors use membrane systems such as TPO, EPDM or modified bitumen instead of shingles.',
      },
    ],
    processNote:
      'Roofing requests are shared with independent roofing contractors who have told us they cover your area. We do not perform roof work, inspect roofs or set pricing — the contractor confirms scope, materials, permits and warranty terms with you directly.',
    faqs: [
      {
        question: 'How long does a roof replacement usually take?',
        answer:
          'Most single-family asphalt roof replacements take one to three days once materials are on site and weather cooperates. Larger homes, steep pitches, tile or slate, and structural repairs extend that timeline. Your contractor should give you a written schedule that accounts for tear-off, decking repair and inspection.',
      },
      {
        question: 'Should I repair my roof or replace it?',
        answer:
          'Repair tends to make sense when damage is isolated and the roof still has meaningful service life left. Replacement is usually the better conversation when the covering is near the end of its rated life, damage covers a large area, or leaks keep returning in different spots. An on-site inspection is the only way to get a real answer.',
      },
      {
        question: 'Does a new roof require a permit?',
        answer:
          'In most US jurisdictions, yes — especially for a full tear-off or any structural change. Permit requirements are set locally, so ask the contractor who will pull the permit and confirm it will be inspected before final payment.',
      },
      {
        question: 'Will homeowners insurance cover roof damage?',
        answer:
          'Coverage depends on the cause of damage, your policy and its deductible. Sudden storm or hail damage is commonly covered; wear and tear from age generally is not. Your insurer — not a roofing company — makes that determination, so file a claim and read the adjuster report before committing to work.',
      },
    ],
    related: ['roof-repair', 'window-installation', 'water-damage'],
    metaTitle: 'Roofing Services & Roof Replacement Options',
    metaDescription:
      'Explore roof replacement materials, common roofing needs and the questions to ask a contractor. Check whether roofing providers are listed in your ZIP code.',
    searchTerms: ['roof replacement', 'shingles', 'roofer', 'metal roof', 'tear-off'],
  },
  {
    slug: 'roof-repair',
    name: 'Roof Repair',
    category: 'exterior',
    icon: 'wrench',
    image: '/images/service-roof-repair.jpg',
    featured: false,
    heroHeadline: 'Targeted Roof Repairs for Leaks, Flashing and Storm Damage',
    heroSubheadline:
      'Fix the specific problem instead of the whole roof — when the roof still has life left in it.',
    shortDescription:
      'Leak tracing, shingle replacement, flashing and storm-damage repairs handled by independent roofing contractors.',
    intro: [
      'Not every roof problem needs a new roof. A cracked vent boot, a failed chimney flashing or a handful of wind-lifted shingles can often be corrected in a single visit for a fraction of replacement cost — provided the rest of the covering is still sound.',
      'The catch is diagnosis. Water rarely enters where the stain appears, so a repair that only addresses the visible area tends to fail again after the next storm. Below is what roofing repairs usually cover and how to think about repair versus replacement before you spend anything.',
    ],
    commonNeeds: [
      {
        title: 'Active leaks and ceiling stains',
        description:
          'Drips during rain, brown rings on ceilings, or damp attic insulation. Fast attention limits damage to decking, insulation and interior finishes.',
      },
      {
        title: 'Flashing failures',
        description:
          'Chimneys, skylights, valleys and sidewalls are where most leaks start. Flashing and sealant age faster than the shingles around them.',
      },
      {
        title: 'Wind-lifted or missing shingles',
        description:
          'A small missing section exposes the underlayment and lets the next storm lift the neighboring courses.',
      },
      {
        title: 'Gutter and ice dam damage',
        description:
          'Backed-up gutters push water under the bottom courses and rot the fascia. Clearing and repairing now prevents interior damage later.',
      },
      {
        title: 'Vent and penetration issues',
        description:
          'Plumbing vents, exhaust fans and satellite mounts are common points of failure that need proper re-sealing rather than caulk over caulk.',
      },
    ],
    options: [
      {
        title: 'Shingle and section replacement',
        description:
          'Lifting and replacing damaged courses with matching material. Best when the roof is otherwise in good condition and the shingle line is still available.',
      },
      {
        title: 'Flashing and sealant repair',
        description:
          'Rebuilding metal flashing around penetrations and sidewalls. A proper repair replaces failed metal rather than covering it.',
      },
      {
        title: 'Leak detection and moisture checks',
        description:
          'Some contractors use moisture meters, hose testing or attic inspection to trace the actual entry point before quoting a repair.',
      },
      {
        title: 'Emergency tarping',
        description:
          'After a storm, a temporary tarp can stop active water intrusion while you wait for an adjuster or a scheduled repair.',
      },
    ],
    processNote:
      'Roof repair requests go to independent roofing contractors who list repair coverage in your area. We do not diagnose leaks or quote repairs — the contractor inspects the roof and tells you whether a repair or replacement is the honest recommendation.',
    faqs: [
      {
        question: 'How much does a roof repair cost?',
        answer:
          'Repair pricing depends on access, pitch, the number of problem areas and whether damaged decking has to be replaced. Contractors typically charge a minimum service call plus materials. Ask for the diagnostic fee and what it includes before authorizing work, and get it in writing.',
      },
      {
        question: 'Can a roof be repaired in winter?',
        answer:
          'Many repairs can be done in cold weather, though adhesive-backed shingles need warmer conditions to seal properly. Some contractors prefer temporary sealing in winter and permanent repair in spring. Ask how the season affects your specific repair.',
      },
      {
        question: 'Will a repair void my roof warranty?',
        answer:
          'Improper or unauthorized repairs can affect manufacturer warranty coverage. Check the original roofing warranty terms and ask the contractor whether their work is compatible with it, especially on a roof that is still under a material warranty.',
      },
      {
        question: 'How quickly should a leak be addressed?',
        answer:
          'Treat an active leak as urgent. Water damages insulation, drywall and framing, and sustained moisture can lead to mold growth within days. If water is already inside the house, arrange for it to be contained while the roof repair is scheduled.',
      },
    ],
    related: ['roofing', 'water-damage', 'door-installation'],
    metaTitle: 'Roof Repair: Leaks, Flashing & Storm Damage',
    metaDescription:
      'Learn what roof repairs cover, how leaks are traced and when repair beats replacement. Check whether roof repair providers are listed in your ZIP code.',
    searchTerms: ['leak repair', 'shingle repair', 'flashing', 'storm damage', 'roof leak'],
  },
  {
    slug: 'plumbing',
    name: 'Plumbing',
    category: 'systems',
    icon: 'droplets',
    image: '/images/service-plumbing.jpg',
    featured: true,
    heroHeadline: 'Plumbing Help for Leaks, Clogs and Water Heaters',
    heroSubheadline:
      'From a dripping fixture to a repipe, understand the job before a plumber is standing in your kitchen.',
    shortDescription:
      'Leaks, clogged drains, water heaters, fixture replacements and repipes handled by independent plumbers.',
    intro: [
      'Plumbing problems have a way of arriving at the worst possible moment — the night before guests arrive, or the morning a home inspection is scheduled. Some are genuinely minor, like a worn faucet cartridge. Others, like a slab leak or a failing main shutoff valve, get expensive quickly if ignored.',
      'This page walks through the plumbing situations homeowners ask about most, the options a plumber is likely to present, and the details worth confirming before work starts. Once you know roughly what you are dealing with, you can check whether plumbing providers are listed in your area.',
    ],
    commonNeeds: [
      {
        title: 'Leaks and dripping fixtures',
        description:
          'Faucets, supply lines, toilets and under-sink fittings. Small leaks waste water and quietly damage cabinets and subfloor.',
      },
      {
        title: 'Slow or blocked drains',
        description:
          'A single slow sink is usually local; multiple slow drains can point to a main line problem that needs a camera inspection.',
      },
      {
        title: 'Water heater replacement',
        description:
          'Tank or tankless, gas or electric. Age, recovery rate, venting and available space all shape which units fit your home.',
      },
      {
        title: 'Low water pressure',
        description:
          'Corroded galvanized pipe, a failing pressure regulator, or a partially closed valve can all be the cause. Diagnosis matters more than guesswork.',
      },
      {
        title: 'Fixture and bathroom upgrades',
        description:
          'Replacing a toilet, vanity faucet or shower valve often pairs well with a remodeling project, so the wall is opened only once.',
      },
    ],
    options: [
      {
        title: 'Repair and replace components',
        description:
          'Cartridges, supply hoses, shutoff valves and toilet internals are inexpensive parts with a short labor window — usually the first thing a plumber quotes.',
      },
      {
        title: 'Drain cleaning and camera inspection',
        description:
          'Cabling clears most clogs. A camera scope shows whether the line is root-invaded, bellied or cracked, which changes the recommendation entirely.',
      },
      {
        title: 'Water heater service',
        description:
          'Flush and anode service extends tank life; replacement involves capacity sizing, venting and code clearances. Tankless units add venting and gas-supply considerations.',
      },
      {
        title: 'Repiping and main line work',
        description:
          'Older galvanized or failing polybutylene systems are sometimes replaced with copper or PEX. Main line repairs may require permits and inspection.',
      },
    ],
    processNote:
      'Plumbing requests are shared with independent licensed plumbers who cover your area. Safe Home Network does not perform plumbing work or quote repairs; the plumber diagnoses the issue and presents options and pricing directly to you.',
    faqs: [
      {
        question: 'How do I know if I need an emergency plumber?',
        answer:
          'Active flooding, sewage backing up, no water at all, or the smell of gas alongside a water heater problem are all reasons to act immediately. Shut off the water at the main valve if it is safe to do so, and call a plumber or your utility. Slow drains and dripping faucets can usually wait for a scheduled visit.',
      },
      {
        question: 'Should I repair or replace my water heater?',
        answer:
          'As a rough guide, a tank unit past ten to twelve years old with a leaking tank is usually a replacement. Units that still hold pressure but need a thermocouple or heating element are often worth repairing. Ask the plumber to test the tank and explain the remaining service life before deciding.',
      },
      {
        question: 'Why does my drain keep clogging?',
        answer:
          'Repeated clogs in the same fixture usually mean buildup or a mechanical problem further down the line rather than a fresh blockage. A camera inspection is the reliable way to see whether roots, a collapsed section or accumulated grease is responsible.',
      },
      {
        question: 'Do plumbers need permits for their work?',
        answer:
          'Many installations and most line replacements require a permit and inspection in US jurisdictions. Ask who pulls the permit and confirm the inspection is included in the quote, particularly for water heater replacement and repiping.',
      },
    ],
    related: ['water-damage', 'bathroom-remodeling', 'hvac'],
    metaTitle: 'Plumbing Services: Leaks, Drains & Water Heaters',
    metaDescription:
      'Understand common plumbing needs, repair versus replacement options and the questions to ask before hiring. Check plumbing availability in your ZIP code.',
    searchTerms: ['plumber', 'leak', 'clogged drain', 'water heater', 'repipe'],
  },
  {
    slug: 'hvac',
    name: 'HVAC',
    category: 'systems',
    icon: 'wind',
    image: '/images/service-hvac.jpg',
    featured: true,
    heroHeadline: 'Heating and Cooling Help for the Whole System',
    heroSubheadline:
      'Maintenance, repair and replacement decisions for furnaces, heat pumps, AC systems and ductwork.',
    shortDescription:
      'Furnace and heat pump service, AC repair, ductwork and maintenance plans from independent HVAC contractors.',
    intro: [
      'A heating and cooling system is the most expensive equipment in most homes and the one homeowners think about least until it stops working. Modern systems are also more tightly coupled than they look: duct sizing, refrigerant charge, airflow and thermostat settings all affect whether equipment performs the way its rating promises.',
      'Here you will find what falls under HVAC work, the difference between maintaining, repairing and replacing a system, and the questions that separate a careful contractor from a quick swap. Availability for heating and cooling requests is seasonal, so check your ZIP code when you are ready.',
    ],
    commonNeeds: [
      {
        title: 'Uneven heating or cooling',
        description:
          'Rooms that never match the thermostat often point to airflow or duct problems rather than an undersized unit.',
      },
      {
        title: 'System not keeping up',
        description:
          'A unit that runs constantly in extreme weather may be low on refrigerant, dirty, or simply past its useful capacity.',
      },
      {
        title: 'Short cycling and strange noises',
        description:
          'Frequent starts, banging, rattling or screeching usually warrant a service call before a bigger failure follows.',
      },
      {
        title: 'Age and efficiency decisions',
        description:
          'Systems nearing the end of their rated life raise the maintenance-versus-replacement question, especially with rising energy costs.',
      },
      {
        title: 'Ductwork and air quality',
        description:
          'Leaky or disconnected ducts waste conditioned air; filtration and humidity control affect comfort and indoor air quality.',
      },
    ],
    options: [
      {
        title: 'Maintenance and tune-ups',
        description:
          'Seasonal cleaning, filter changes, electrical checks and refrigerant level verification. The cheapest way to extend equipment life and catch small failures early.',
      },
      {
        title: 'Repair of existing equipment',
        description:
          'Motors, capacitors, igniters, control boards and refrigerant leaks. Cost-effectiveness depends on age, part availability and how often the unit has failed.',
      },
      {
        title: 'Full system replacement',
        description:
          'Typically involves matching indoor and outdoor components, confirming refrigerant type and verifying duct capacity. Ask about load calculation rather than a like-for-like size swap.',
      },
      {
        title: 'Duct sealing and airflow correction',
        description:
          'Sealing leaks, correcting returns and balancing rooms can improve comfort without replacing equipment at all.',
      },
    ],
    processNote:
      'HVAC requests are shared with independent heating and cooling contractors who list coverage in your area. Safe Home Network does not install or repair equipment; the contractor performs the load assessment, recommends equipment and provides pricing directly.',
    faqs: [
      {
        question: 'How often should HVAC equipment be serviced?',
        answer:
          'Most manufacturers recommend professional maintenance once a year for each system — cooling in spring, heating in fall. Between visits, changing air filters on the schedule your system calls for is the single most useful thing a homeowner can do.',
      },
      {
        question: 'When is it better to replace rather than repair?',
        answer:
          'Common decision points are a repair costing a significant share of replacement, equipment past ten to fifteen years old, repeated failures in the same season, or a compressor failure on an aging unit. Ask for the age, expected remaining life and the cost of both paths in writing.',
      },
      {
        question: 'Should I replace the furnace and AC at the same time?',
        answer:
          'If both are the same age and near end of life, replacing together usually saves labor and avoids mismatched components later. If one is clearly newer, keep it and make sure the new equipment is compatible with the existing coil and refrigerant type.',
      },
      {
        question: 'Why does my energy bill spike in extreme weather?',
        answer:
          'Equipment works harder and runs longer in extreme temperatures, so some increase is normal. A sharp, sustained jump can also indicate a refrigerant leak, failing blower motor, or duct leakage. A service visit with static pressure and refrigerant checks will tell you which.',
      },
    ],
    related: ['ac-repair', 'electrical', 'water-damage'],
    metaTitle: 'HVAC Services: Heating, Cooling & Ductwork',
    metaDescription:
      'Explore HVAC maintenance, repair and replacement options, plus the questions to ask a contractor. Check heating and cooling availability in your ZIP code.',
    searchTerms: ['furnace', 'heat pump', 'ductwork', 'air conditioning', 'tune-up'],
  },
  {
    slug: 'ac-repair',
    name: 'AC Repair',
    category: 'systems',
    icon: 'snowflake',
    image: '/images/service-ac-repair.jpg',
    featured: false,
    heroHeadline: 'Air Conditioning Repair Before the Heat Sets In',
    heroSubheadline:
      'Diagnose warm air, weak airflow and short cycling with a technician who tests instead of guessing.',
    shortDescription:
      'Diagnostics, refrigerant checks, capacitor and compressor repairs, and AC replacement guidance.',
    intro: [
      'When an air conditioner stops cooling, the temptation is to blame the biggest component. In practice, a large share of no-cooling calls come down to a failed capacitor, a clogged condensate line, a dirty coil or a tripped breaker — inexpensive fixes that need proper diagnosis rather than parts swapping.',
      'This page covers the symptoms homeowners report most often, what a technician actually tests, and when repair stops making financial sense. Cooling availability is seasonal in many markets, so check your ZIP code before assuming a same-day appointment is possible.',
    ],
    commonNeeds: [
      {
        title: 'Blowing warm air',
        description:
          'The indoor unit runs but the air is not cold. Low refrigerant, a failed compressor or a dirty condenser coil are common causes.',
      },
      {
        title: 'Weak airflow',
        description:
          'Restricted filters, failing blower motors or blocked ducts reduce airflow, and low airflow can freeze the indoor coil.',
      },
      {
        title: 'Short cycling',
        description:
          'Frequent on-off cycles strain the compressor and often trace back to an oversized unit, thermostat placement or low charge.',
      },
      {
        title: 'Water around the indoor unit',
        description:
          'A clogged condensate drain or a frozen coil produces overflow that can damage ceilings and flooring.',
      },
      {
        title: 'Rising energy bills',
        description:
          'A system working harder than it used to is often an early warning of a refrigerant or airflow problem.',
      },
    ],
    options: [
      {
        title: 'Diagnostic service call',
        description:
          'A technician checks electrical components, refrigerant pressures, temperature split and airflow before recommending anything. Ask about the diagnostic fee up front.',
      },
      {
        title: 'Component repair',
        description:
          'Capacitors, contactors, motors and control boards are common, relatively inexpensive repairs. Refrigerant leaks require locating and repairing the leak, not just recharging.',
      },
      {
        title: 'Coil cleaning and tune-up',
        description:
          'Cleaning condenser and evaporator coils and checking the condensate line restores efficiency and prevents repeat calls.',
      },
      {
        title: 'System replacement',
        description:
          'When a compressor, coil or refrigerant type is at issue on aging equipment, replacement is often the better long-term decision — and existing refrigerant rules affect what can be serviced.',
      },
    ],
    processNote:
      'AC repair requests are shared with independent HVAC contractors who list cooling coverage in your area. We do not diagnose or repair air conditioning equipment; the contractor confirms the fault, parts availability and pricing with you directly.',
    faqs: [
      {
        question: 'Why is my AC running but not cooling?',
        answer:
          'The most common causes are low refrigerant from a leak, a dirty condenser coil, restricted airflow from a clogged filter, or a failing compressor. Because the symptoms overlap, a technician should measure pressures and temperature differential instead of assuming a recharge will fix it.',
      },
      {
        question: 'How long should an air conditioner last?',
        answer:
          'Most central air conditioners are expected to last roughly twelve to fifteen years with regular maintenance, though climate, usage and installation quality all affect that. Repairs on a system beyond that range should be weighed against replacement, especially if parts are hard to source.',
      },
      {
        question: 'Is it worth recharging refrigerant every summer?',
        answer:
          'No. Refrigerant is a closed system — if it needs recharging, it is leaking. Adding refrigerant without locating the leak is a short-term patch that also raises cost and environmental impact. Ask for leak detection and a repair option.',
      },
      {
        question: 'Should I repair or replace a 15-year-old AC unit?',
        answer:
          'Compare the repair cost against replacement, consider the refrigerant type and parts availability, and weigh expected remaining life. A single affordable repair can still be sensible; repeated failures in the same season usually point toward replacement.',
      },
    ],
    related: ['hvac', 'electrical', 'roof-repair'],
    metaTitle: 'AC Repair: Diagnostics, Repairs & Replacement',
    metaDescription:
      'Learn why air conditioners stop cooling, what a technician checks and when to repair or replace. Check AC repair availability in your ZIP code.',
    searchTerms: ['air conditioning', 'AC not cooling', 'refrigerant', 'capacitor', 'compressor'],
  },
  {
    slug: 'water-damage',
    name: 'Water Damage Restoration',
    category: 'restoration',
    icon: 'waves',
    image: '/images/service-water-damage.jpg',
    featured: true,
    heroHeadline: 'Water Damage Restoration When Every Hour Counts',
    heroSubheadline:
      'Understand the drying process, what insurance needs, and how restoration differs from a plumbing repair.',
    shortDescription:
      'Emergency water extraction, structural drying, moisture documentation and cleanup coordination.',
    intro: [
      'Water damage gets worse on a clock. Within the first day, drywall and insulation absorb moisture; within a couple of days, swelling and microbial growth become realistic concerns. The difference between a small cleanup and a rebuild is often how quickly water is extracted and drying equipment is running.',
      'This page explains what a restoration company actually does, how it differs from the plumber who fixes the source, and what to document for an insurance claim. Restoration availability changes quickly during storms, so confirm your ZIP code rather than assuming immediate service.',
    ],
    commonNeeds: [
      {
        title: 'Burst pipes and supply line failures',
        description:
          'A failed washing machine hose or frozen pipe can release hundreds of gallons before anyone notices.',
      },
      {
        title: 'Appliance and water heater leaks',
        description:
          'Slow leaks behind appliances saturate cabinets and subfloor long before they are visible.',
      },
      {
        title: 'Roof and window intrusion',
        description:
          'Storm-driven rain entering through failed flashing or damaged shingles soaks ceilings, insulation and wall cavities.',
      },
      {
        title: 'Sewage backups and sump failures',
        description:
          'Category 3 water requires protective handling and disposal, and often removal of affected porous materials.',
      },
      {
        title: 'Basement and crawlspace moisture',
        description:
          'Chronic dampness and condensation need both drying and a plan to stop the water from returning.',
      },
    ],
    options: [
      {
        title: 'Emergency extraction and drying',
        description:
          'Standing water is extracted, then air movers and dehumidifiers run until materials reach documented dry standards.',
      },
      {
        title: 'Moisture monitoring and documentation',
        description:
          'Restoration technicians record readings and photographs throughout the job — documentation insurers typically expect with a claim.',
      },
      {
        title: 'Contaminated water cleanup',
        description:
          'Sewage and floodwater require containment, protective equipment and removal of materials that cannot be safely dried.',
      },
      {
        title: 'Repairs and rebuild',
        description:
          'Drywall, flooring, trim and paint restoration. Some companies handle both drying and rebuild; others stop at drying, so confirm scope in writing.',
      },
    ],
    processNote:
      'Water damage requests are shared with independent restoration companies that list coverage in your area. Safe Home Network does not perform extraction or drying. Because these situations are urgent, call your insurer or a restoration company directly if water is actively entering your home.',
    faqs: [
      {
        question: 'How quickly does water damage become a mold problem?',
        answer:
          'Mold can begin developing on wet porous materials within roughly 24 to 48 hours in warm, humid conditions. That is why extraction and drying equipment should be started the same day when possible, rather than waiting for a scheduled appointment.',
      },
      {
        question: 'Does homeowners insurance cover water damage restoration?',
        answer:
          'Policies commonly cover sudden accidental discharge, like a burst pipe, and often exclude long-term seepage, neglected maintenance and flooding. Flood coverage is usually separate. Read your policy and speak with your insurer before authorizing large amounts of work.',
      },
      {
        question: 'Can I dry the area myself with fans?',
        answer:
          'Household fans move air but do not remove moisture from the air the way dehumidifiers do, and they cannot dry inside wall cavities. For anything beyond a small surface spill, professional drying with moisture readings is the safer choice.',
      },
      {
        question: 'Will my floors and drywall need to be removed?',
        answer:
          'It depends on the material, the water category and how long it was wet. Some hardwood can be dried in place with specialty equipment; saturated carpet padding, laminate and certain drywall sections usually need removal. The restorer documents the readings that justify either approach.',
      },
    ],
    related: ['plumbing', 'roof-repair', 'pest-control'],
    metaTitle: 'Water Damage Restoration: Drying & Cleanup',
    metaDescription:
      'Understand emergency water extraction, structural drying and insurance documentation. Check water damage restoration availability in your ZIP code.',
    searchTerms: ['flood', 'water extraction', 'mold', 'burst pipe', 'drying'],
  },
  {
    slug: 'pest-control',
    name: 'Pest Control',
    category: 'specialty',
    icon: 'bug',
    image: '/images/service-pest-control.jpg',
    featured: true,
    heroHeadline: 'Pest Control That Solves the Problem, Not Just the Sighting',
    heroSubheadline:
      'Identify what you are dealing with, understand treatment options, and know what ongoing service includes.',
    shortDescription:
      'Inspection, treatment and prevention for ants, roaches, rodents, termites, spiders and stinging insects.',
    intro: [
      'Seeing one pest does not always mean an infestation, and seeing none does not mean the problem is gone. Effective pest control starts with identification and inspection: different species need different treatments, and the same treatment applied to the wrong pest wastes money and time.',
      'This page covers the pests homeowners ask about most, how treatment plans differ from one-time visits, and the questions to ask before signing a recurring service agreement. Then you can check whether pest control providers are listed in your area.',
    ],
    commonNeeds: [
      {
        title: 'Ants and roaches in the kitchen',
        description:
          'Trails along counters and cabinets usually mean a colony nearby. Baiting and exclusion work better than surface spraying alone.',
      },
      {
        title: 'Rodents in the attic or garage',
        description:
          'Droppings, gnaw marks and scratching at night. Rodents need both removal and sealing of entry points, or they return.',
      },
      {
        title: 'Termites and wood-destroying insects',
        description:
          'Mud tubes, frass and hollow-sounding wood. Termite work often requires a specialized inspection and, in many states, a licensed applicator.',
      },
      {
        title: 'Spiders, wasps and hornets',
        description:
          'Nests around eaves, porches and outbuildings. Stinging insect removal is best handled with protective equipment.',
      },
      {
        title: 'Seasonal perimeter prevention',
        description:
          'Recurring perimeter treatment aimed at keeping pests from establishing inside during seasonal activity peaks.',
      },
    ],
    options: [
      {
        title: 'One-time inspection and treatment',
        description:
          'A targeted visit for an identified problem, often with a follow-up window. Suitable when activity is localized and the source is clear.',
      },
      {
        title: 'Recurring maintenance plans',
        description:
          'Scheduled perimeter and interior treatments with a service warranty. Compare contract length, cancellation terms and what a callback visit covers.',
      },
      {
        title: 'Baiting and exclusion',
        description:
          'Bait stations for rodents and certain insects, combined with sealing entry points. Exclusion is what prevents repeat problems.',
      },
      {
        title: 'Specialty and wildlife removal',
        description:
          'Termites, bed bugs, and wildlife such as squirrels or raccoons usually require specialists and sometimes separate licensing.',
      },
    ],
    processNote:
      'Pest control requests are shared with independent pest management providers who list coverage in your area. Safe Home Network does not apply treatments. The provider inspects, identifies the pest and explains the treatment plan and any warranty directly to you.',
    faqs: [
      {
        question: 'Are the chemicals used in pest control safe for pets and children?',
        answer:
          'Licensed applicators use products according to label directions, which include re-entry intervals and handling requirements. Ask the provider which products will be used, what the re-entry time is, and how to protect pets and children during and after treatment.',
      },
      {
        question: 'Do I need a recurring plan or a one-time visit?',
        answer:
          'A one-time treatment can resolve a defined, localized issue. Recurring plans make more sense for pests with seasonal pressure or a history of reinfestation. Read the contract terms carefully — length, cancellation, and what counts as a covered callback vary widely.',
      },
      {
        question: 'How long does it take to get rid of roaches or bed bugs?',
        answer:
          'Roaches typically require multiple visits and sanitation cooperation to break the breeding cycle. Bed bugs generally need specialized treatment protocols and often two treatments. Any provider promising elimination in a single visit without inspection deserves scrutiny.',
      },
      {
        question: 'What should I do before the technician arrives?',
        answer:
          'Clear access to baseboards and cabinets, secure pets, and remove or cover food and dishes in treated areas as instructed. Ask the provider for a preparation list — following it improves results and reduces the need for return visits.',
      },
    ],
    related: ['water-damage', 'roof-repair', 'locksmith'],
    metaTitle: 'Pest Control: Inspection, Treatment & Prevention',
    metaDescription:
      'Compare one-time treatments and recurring pest plans, learn what to ask a provider and check pest control availability in your ZIP code.',
    searchTerms: ['exterminator', 'termites', 'rodents', 'roaches', 'ants', 'wasp nest'],
  },
  {
    slug: 'electrical',
    name: 'Electrical',
    category: 'systems',
    icon: 'zap',
    image: '/images/service-electrical.jpg',
    featured: true,
    heroHeadline: 'Electrical Work That Starts With Safety',
    heroSubheadline:
      'Panel upgrades, outlet and lighting work, EV chargers and troubleshooting from licensed electricians.',
    shortDescription:
      'Panel upgrades, circuit additions, lighting, outlet repair and EV charger installation by licensed electricians.',
    intro: [
      'Electrical work is the one home service category where the wrong shortcut is genuinely dangerous. Flickering lights, warm outlets and breakers that trip repeatedly are not quirks to live with — they are signals that a circuit is overloaded, a connection is loose, or the panel is at its limit.',
      'This page covers the electrical jobs homeowners most often need, what a licensed electrician inspects before quoting, and why panel capacity so often determines the answer. When you are ready, check whether licensed electricians are listed in your area.',
    ],
    commonNeeds: [
      {
        title: 'Breakers that keep tripping',
        description:
          'An overloaded circuit, a failing breaker or a fault in the wiring. Repeated tripping is a symptom that needs diagnosis, not a bigger breaker.',
      },
      {
        title: 'Outlets and switches that fail',
        description:
          'Warm plates, scorch marks, buzzing or dead outlets suggest loose connections or worn devices that should be replaced promptly.',
      },
      {
        title: 'Panel upgrades',
        description:
          'Older panels may lack capacity or use discontinued components. Additions, EV chargers and heat pumps often require an upgrade first.',
      },
      {
        title: 'Lighting and ceiling fans',
        description:
          'New fixtures, recessed lighting and fan installation — including confirming whether a box is rated for fan support.',
      },
      {
        title: 'EV charger and appliance circuits',
        description:
          'Level 2 chargers, ranges, dryers and hot tubs need dedicated circuits, correct wire sizing and often a permit.',
      },
    ],
    options: [
      {
        title: 'Troubleshooting and repair',
        description:
          'Tracing faults, replacing devices and correcting connections. Ask what the diagnostic fee covers and whether it applies to the repair.',
      },
      {
        title: 'Panel replacement or upgrade',
        description:
          'Increasing service capacity, replacing outdated panels and adding dedicated circuits. Usually permitted and inspected.',
      },
      {
        title: 'Circuit and outlet additions',
        description:
          'New dedicated circuits for kitchens, workshops, garages or outdoor equipment, with GFCI protection where required.',
      },
      {
        title: 'Lighting and smart device installation',
        description:
          'Recessed lighting, under-cabinet lighting, dimmers and smart switches — some of which need a neutral wire or compatible dimming.',
      },
    ],
    processNote:
      'Electrical requests are shared with independent licensed electricians who list coverage in your area. Safe Home Network does not perform electrical work. Licensing requirements are set by state and local authorities — ask the electrician for their license number and confirm permits where required.',
    faqs: [
      {
        question: 'Do I need a licensed electrician for small jobs?',
        answer:
          'Many jurisdictions require a licensed electrician for anything beyond replacing a fixture or a switch, and permits for new circuits, panel work and service changes. Requirements vary by state and city, so confirm locally and ask for the license number before work begins.',
      },
      {
        question: 'Why do my lights flicker?',
        answer:
          'A single fixture flickering can be a bulb or dimmer compatibility issue. Lights across the house dimming when an appliance starts often points to a loose service connection or an overloaded panel — which should be checked by an electrician rather than ignored.',
      },
      {
        question: 'How do I know if my electrical panel needs upgrading?',
        answer:
          'Common indicators include a panel with no spare spaces, fuses instead of breakers, a known problematic panel brand, rust or scorching, or plans to add major loads like an EV charger or heat pump. An electrician performs a load calculation to confirm what your service can support.',
      },
      {
        question: 'How long does an EV charger installation take?',
        answer:
          'A straightforward Level 2 installation with capacity available in the panel can take a few hours. Jobs requiring a panel upgrade, a long conduit run or a trench to a detached garage take considerably longer and usually need a permit and inspection.',
      },
    ],
    related: ['hvac', 'kitchen-remodeling', 'locksmith'],
    metaTitle: 'Electrical Services: Panels, Circuits & Lighting',
    metaDescription:
      'Learn when to call a licensed electrician, what panel upgrades involve and how safety issues are diagnosed. Check electrical availability in your ZIP code.',
    searchTerms: ['electrician', 'panel upgrade', 'breaker', 'outlet', 'EV charger'],
  },
  {
    slug: 'kitchen-remodeling',
    name: 'Kitchen Remodeling',
    category: 'remodeling',
    icon: 'chef-hat',
    image: '/images/service-kitchen-remodeling.jpg',
    featured: true,
    heroHeadline: 'Kitchen Remodeling, Planned Before It Is Priced',
    heroSubheadline:
      'Layout, cabinets, countertops and sequencing — the decisions that determine budget and timeline.',
    shortDescription:
      'Full kitchen renovations, cabinet and countertop replacement, layout changes and finish selections.',
    intro: [
      'A kitchen remodel is less a shopping list than a sequence of decisions, and the order matters. Moving a sink changes plumbing; moving a range changes gas and electrical; removing a wall may change structure and permits. The earliest choices set the budget, and late changes are what turn a comfortable project into a stressful one.',
      'This page covers what a kitchen renovation typically includes, the trade-offs between refacing, partial updates and full remodels, and the questions to settle before signing a contract. When you are ready, check whether kitchen remodelers are listed for your ZIP code.',
    ],
    commonNeeds: [
      {
        title: 'Outdated layout that fights daily use',
        description:
          'Poor work triangle, blocked traffic paths and insufficient storage — the problems worth fixing before finishes.',
      },
      {
        title: 'Cabinets at end of life',
        description:
          'Sagging boxes, broken hinges and worn doors. Refacing, painting and full replacement each solve different budgets and different problems.',
      },
      {
        title: 'Countertops and backsplash',
        description:
          'Natural stone, quartz, laminate and solid surface have very different cost, maintenance and fabrication timelines.',
      },
      {
        title: 'Appliance and lighting upgrades',
        description:
          'New appliance sizes, ventilation and task lighting often need electrical and ductwork changes that must be planned early.',
      },
      {
        title: 'Preparing to sell',
        description:
          'Buyers weigh functional kitchens heavily. Sometimes targeted updates deliver more than a full renovation.',
      },
    ],
    options: [
      {
        title: 'Refresh and reface',
        description:
          'New doors and drawer fronts, countertops, hardware and paint over existing cabinet boxes. Lower cost and faster, provided the boxes are square and sound.',
      },
      {
        title: 'Pull-and-replace in the same layout',
        description:
          'New cabinets and finishes without moving plumbing, gas or electrical. A middle path that keeps costs predictable.',
      },
      {
        title: 'Full renovation with layout changes',
        description:
          'Relocating plumbing, appliances and walls. Requires design work, permits and longer timelines, and typically the largest budget.',
      },
      {
        title: 'Additions and open-plan conversions',
        description:
          'Removing a wall or extending the footprint. Requires structural review and a realistic plan for temporary kitchen arrangements.',
      },
    ],
    processNote:
      'Kitchen remodeling requests are shared with independent remodelers whose coverage includes your area. Safe Home Network does not design, build or price kitchens — the remodeler provides drawings, scope, schedule and pricing directly to you.',
    faqs: [
      {
        question: 'How long does a kitchen remodel take?',
        answer:
          'A reface or pull-and-replace may take a few weeks. A full renovation with layout and structural changes commonly takes several months, and cabinet and countertop lead times are often the pacing item. Ask for a written schedule with lead times and a clear statement of who is responsible for each phase.',
      },
      {
        question: 'Do I need a permit for a kitchen remodel?',
        answer:
          'Cosmetic work usually does not require one; plumbing, electrical, gas and structural changes typically do. Permit requirements are local. Confirm in writing which party pulls permits and that inspections are included in the contract price.',
      },
      {
        question: 'What should be decided before getting quotes?',
        answer:
          'Set a realistic budget, decide whether the layout changes, choose a rough appliance package, and establish who is responsible for design. Quotes are far more comparable when the scope is written down before contractors walk in.',
      },
      {
        question: 'Can I live at home during the remodel?',
        answer:
          'Many homeowners do, but plan for a temporary setup: a microwave and kettle station, dishwashing in a bathroom or laundry sink, and dust containment. Ask the contractor how they will protect adjacent rooms and control dust daily.',
      },
    ],
    related: ['bathroom-remodeling', 'electrical', 'plumbing'],
    metaTitle: 'Kitchen Remodeling: Layout, Cabinets & Finishes',
    metaDescription:
      'Plan a kitchen remodel from layout through finishes, understand reface versus full renovation and what to decide before quotes. Check ZIP availability.',
    searchTerms: ['kitchen renovation', 'cabinets', 'countertops', 'backsplash', 'remodel'],
  },
  {
    slug: 'bathroom-remodeling',
    name: 'Bathroom Remodeling',
    category: 'remodeling',
    icon: 'bath',
    image: '/images/service-bathroom-remodeling.jpg',
    featured: true,
    heroHeadline: 'Bathroom Remodeling Where Waterproofing Comes First',
    heroSubheadline:
      'Showers, vanities, tile and accessibility updates — with the details that prevent costly water damage later.',
    shortDescription:
      'Shower and tub replacement, tile, vanities and accessibility updates built around proper waterproofing.',
    intro: [
      'Bathrooms are small rooms with a lot of plumbing, a lot of moisture and very little tolerance for shortcuts. The visible work — tile, glass, finishes — is what sells a bathroom, but the hidden work is what determines whether it still looks right in ten years. Waterproofing behind tile and correct slope at the shower pan are not optional details.',
      'This page explains what a bathroom renovation includes, how a partial update differs from a full remodel, and which questions separate an experienced contractor from a fast one. Then you can check whether bathroom remodelers are listed in your area.',
    ],
    commonNeeds: [
      {
        title: 'Worn tubs, showers and surrounds',
        description:
          'Cracked fiberglass, failing caulk lines and stained grout are the most common triggers for an update.',
      },
      {
        title: 'Water damage around fixtures',
        description:
          'Soft subfloor, loose tile and moisture behind walls. Fixing the source and the substrate matters more than the new finish.',
      },
      {
        title: 'Accessibility and aging in place',
        description:
          'Curbless showers, grab bars, comfort-height toilets and wider doorways make a bathroom safer without looking institutional.',
      },
      {
        title: 'Storage and layout improvements',
        description:
          'Double vanities, linen storage and better lighting transform a small space more than expensive tile does.',
      },
      {
        title: 'Preparing a home for sale',
        description:
          'Updated bathrooms influence buyer perception strongly, particularly when fixtures and grout look clean and current.',
      },
    ],
    options: [
      {
        title: 'Cosmetic refresh',
        description:
          'Paint, fixtures, mirrors, lighting and regrouting without moving plumbing. Quickest and least disruptive, provided the substrate is healthy.',
      },
      {
        title: 'Tub-to-shower conversion',
        description:
          'Removing a tub and building a tiled shower with new waterproofing, drain and often a curbless entry for accessibility.',
      },
      {
        title: 'Full bathroom remodel',
        description:
          'New layout, plumbing relocations, tile and cabinetry. Requires permits and a clear temporary-bathroom plan during construction.',
      },
      {
        title: 'Accessibility modification',
        description:
          'Grab bars, benches, handheld showers and widened entries. Some jurisdictions and programs offer assistance for these improvements.',
      },
    ],
    processNote:
      'Bathroom remodeling requests are shared with independent remodelers who list coverage in your area. We do not perform or price bathroom work. Ask the remodeler how they waterproof wet areas, what the inspection schedule is, and who handles permits.',
    faqs: [
      {
        question: 'How long does a bathroom remodel take?',
        answer:
          'A cosmetic refresh can be finished in days. A full remodel with tile and relocated plumbing commonly takes three to six weeks, largely depending on tile work, inspection timing and material lead times. Ask for a schedule that lists inspections rather than only the finish date.',
      },
      {
        question: 'Why is waterproofing so important behind shower tile?',
        answer:
          'Grout and thinset are not waterproof. A bonded waterproofing membrane or a proper cement board and vapor barrier system keeps moisture out of framing and adjacent rooms. Skipping this is the most common cause of hidden rot behind a newly remodeled shower.',
      },
      {
        question: 'Can I keep my existing layout to save money?',
        answer:
          'Yes — keeping plumbing in place is one of the most effective ways to control cost. Moving a drain or relocating a toilet requires opening floors and often reworking venting, which adds both labor and inspection steps.',
      },
      {
        question: 'Is a walk-in shower or a tub better for resale?',
        answer:
          'It depends on your market and the rest of the home. A home with only one bathroom usually benefits from keeping a tub for families with young children, while a spare or primary bathroom often gains appeal with a large walk-in shower. Ask a local remodeler what buyers in your area respond to.',
      },
    ],
    related: ['kitchen-remodeling', 'plumbing', 'water-damage'],
    metaTitle: 'Bathroom Remodeling: Showers, Tile & Vanities',
    metaDescription:
      'Compare a bathroom refresh with a full remodel, learn why waterproofing matters and what to ask a contractor. Check ZIP code availability.',
    searchTerms: ['bathroom renovation', 'walk-in shower', 'tile', 'vanity', 'tub replacement'],
  },
  {
    slug: 'bedroom-remodeling',
    name: 'Bedroom Remodeling',
    category: 'remodeling',
    icon: 'bed',
    image: '/images/service-bedroom-remodeling.jpg',
    featured: false,
    heroHeadline: 'Bedroom Remodeling for Better Sleep and Better Storage',
    heroSubheadline:
      'Closets, lighting, insulation and finishes that make a bedroom genuinely comfortable.',
    shortDescription:
      'Primary suite updates, closet systems, lighting, insulation and finish work for bedrooms and guest rooms.',
    intro: [
      'Bedroom projects are quieter than kitchens and bathrooms, but they change how a home feels every single day. Noise, drafts, poor closet storage and a single overhead light are the complaints we hear most — and each has a specific, practical fix that does not require rebuilding the room.',
      'This page covers what a bedroom renovation typically includes, from insulation and window updates to closet systems and lighting layers, plus how to plan a primary suite project around the rest of the house. Then check whether remodelers are listed in your ZIP code.',
    ],
    commonNeeds: [
      {
        title: 'Insufficient closet storage',
        description:
          'Reach-in closets that never fit everything. Custom systems and wall reconfiguration recover usable space.',
      },
      {
        title: 'Drafts, noise and temperature swings',
        description:
          'Air sealing, insulation upgrades and better windows address comfort more effectively than a bigger HVAC unit.',
      },
      {
        title: 'Outdated lighting',
        description:
          'A single central fixture is rarely enough. Layered ambient, task and reading light transforms a room.',
      },
      {
        title: 'Converting an attic or basement',
        description:
          'Adding a bedroom requires egress, code-compliant ceiling height and proper moisture control.',
      },
      {
        title: 'Primary suite expansion',
        description:
          'Adding a bathroom or walk-in closet, which often means structural and plumbing work planned together.',
      },
    ],
    options: [
      {
        title: 'Closet and storage systems',
        description:
          'Modular or custom built-ins in existing footprints. Fast, low-disruption, and often the highest-impact change per dollar.',
      },
      {
        title: 'Comfort and envelope upgrades',
        description:
          'Air sealing, insulation, window replacement and door weatherstripping to reduce drafts and outside noise.',
      },
      {
        title: 'Finish renovation',
        description:
          'Flooring, trim, paint, lighting and built-ins that modernize the room without changing its footprint.',
      },
      {
        title: 'Suite additions and conversions',
        description:
          'Adding space, converting an attic, or combining rooms. Requires structural review, permits and egress compliance.',
      },
    ],
    processNote:
      'Bedroom remodeling requests are shared with independent contractors who list coverage in your area. Safe Home Network does not perform design or construction work; the contractor confirms feasibility, permits and pricing with you directly.',
    faqs: [
      {
        question: 'Does a bedroom legally need a closet or window?',
        answer:
          'Requirements vary by jurisdiction. Many areas require two means of egress for a room to be counted as a bedroom, and some require a closet. Local building departments and appraisers apply the definitions, so confirm before listing a room as a bedroom.',
      },
      {
        question: 'How can I make a bedroom quieter?',
        answer:
          'Air sealing around outlets and trim, insulation in exterior and interior walls, solid-core doors and upgraded windows all reduce noise. For severe traffic noise, a contractor may recommend laminated glass or a secondary interior window.',
      },
      {
        question: 'Is a closet system worth it compared with a full renovation?',
        answer:
          'Often yes. A well-designed closet system delivers daily benefits at a fraction of renovation cost and can usually be installed in a day or two. If the room also has comfort and lighting problems, plan those as separate phases.',
      },
      {
        question: 'Can I add a bedroom in a basement?',
        answer:
          'Sometimes, if ceiling height, egress windows and moisture control meet code. Egress is the most common blocker. A contractor familiar with your local code should assess the space before you commit to a plan.',
      },
    ],
    related: ['bathroom-remodeling', 'window-installation', 'door-installation'],
    metaTitle: 'Bedroom Remodeling: Closets, Comfort & Finishes',
    metaDescription:
      'Explore bedroom renovation options including closet systems, insulation, lighting and suite additions. Check whether remodelers cover your ZIP code.',
    searchTerms: ['bedroom renovation', 'closet system', 'primary suite', 'attic conversion'],
  },
  {
    slug: 'window-installation',
    name: 'Window Installation',
    category: 'exterior',
    icon: 'app-window',
    image: '/images/service-window-installation.jpg',
    featured: true,
    heroHeadline: 'Window Replacement That Actually Reduces Drafts',
    heroSubheadline:
      'Glass packages, frame materials and installation method — and how each one affects comfort and cost.',
    shortDescription:
      'Full-frame and insert window replacement, glass upgrades and installation detailing for US homes.',
    intro: [
      'Windows are sold on numbers — U-factor, solar heat gain, condensation resistance — but what homeowners notice is whether the room is still cold near the glass in January and whether the street is still audible at night. Both outcomes depend as much on installation quality and air sealing as on the glass itself.',
      'This page explains the difference between insert and full-frame replacement, how frame materials compare, and which installation details to insist on. Then check whether window installers are listed for your ZIP code.',
    ],
    commonNeeds: [
      {
        title: 'Drafts and cold spots near glass',
        description:
          'Failing seals, single-pane glass and worn weatherstripping. Sometimes a repair or air sealing solves it for far less than replacement.',
      },
      {
        title: 'Foggy double-pane units',
        description:
          'Condensation between panes means the seal has failed. The unit can often be replaced without replacing the entire window frame.',
      },
      {
        title: 'Street noise and outside heat',
        description:
          'Laminated glass and low-solar-gain coatings reduce noise and solar heat, particularly on south and west exposures.',
      },
      {
        title: 'Rotted frames and sills',
        description:
          'Wood rot around the opening usually calls for full-frame replacement rather than an insert, since the rot must be removed.',
      },
      {
        title: 'Energy and comfort upgrades',
        description:
          'Older single-pane windows are a common target when homeowners want a more comfortable house and lower heating and cooling loads.',
      },
    ],
    options: [
      {
        title: 'Insert (pocket) replacement',
        description:
          'New sashes and frame fitted inside the existing jamb. Faster and less invasive, but not appropriate where the frame or sill has rot.',
      },
      {
        title: 'Full-frame replacement',
        description:
          'The entire window and frame are removed and the opening is re-flashed and insulated. Better for water management and older homes.',
      },
      {
        title: 'Glass unit replacement',
        description:
          'For failed sealed units in otherwise sound frames, replacing just the insulated glass can be the most economical fix.',
      },
      {
        title: 'Frame material choices',
        description:
          'Vinyl, fiberglass, aluminum-clad wood and wood each behave differently with temperature movement, maintenance and repainting.',
      },
    ],
    processNote:
      'Window installation requests are shared with independent window contractors who list coverage in your area. Safe Home Network does not measure, sell or install windows. Confirm glass specifications, installation method and warranty terms in writing with the contractor.',
    faqs: [
      {
        question: 'How much can new windows reduce energy bills?',
        answer:
          'Savings vary widely with climate, existing window condition and how leaky the house is. Windows are rarely the single largest efficiency gain — attic insulation and air sealing often deliver more per dollar. Ask for the specific glass ratings rather than a promised percentage.',
      },
      {
        question: 'What do U-factor and SHGC mean?',
        answer:
          'U-factor measures how quickly heat passes through the window; lower is better for insulation. Solar heat gain coefficient measures how much solar heat enters; lower values reduce cooling load in hot climates, while higher values can help in cold climates. Your climate zone determines the sensible target.',
      },
      {
        question: 'Do I need a permit to replace windows?',
        answer:
          'Many jurisdictions require a permit when the opening size changes or when full-frame replacement is performed, and some require it for any replacement. Check with your local building department and confirm who is responsible for the permit.',
      },
      {
        question: 'How long does window installation take?',
        answer:
          'A typical home with ten to fifteen windows takes one to three days with a crew, assuming standard sizes and no rot repair. Custom sizes, full-frame work and stucco or brick openings extend the timeline. Ask how the crew will protect interiors and handle rain delays.',
      },
    ],
    related: ['door-installation', 'roofing', 'bedroom-remodeling'],
    metaTitle: 'Window Installation & Replacement Options',
    metaDescription:
      'Compare insert and full-frame window replacement, glass ratings and frame materials, and what to confirm before signing. Check ZIP availability.',
    searchTerms: ['window replacement', 'double pane', 'glass', 'energy efficient windows'],
  },
  {
    slug: 'door-installation',
    name: 'Door Installation',
    category: 'exterior',
    icon: 'door-open',
    image: '/images/service-door-installation.jpg',
    featured: true,
    heroHeadline: 'Door Installation for Security, Efficiency and Curb Appeal',
    heroSubheadline:
      'Entry, patio and interior doors installed with the flashing and sealing details that stop air and water.',
    shortDescription:
      'Entry doors, patio doors, storm doors and interior doors installed with proper flashing and sealing.',
    intro: [
      'A door has to do three jobs at once: keep weather out, keep the house secure, and look right from the curb. Most door problems trace back to installation rather than the door itself — missing head flashing, an uneven rough opening, or a threshold that was never properly shimmed and sealed.',
      'This page covers entry and patio door replacement, the difference between replacing a slab and the full pre-hung unit, and what to check the day the install is finished. Then you can check whether door installers are listed in your ZIP code.',
    ],
    commonNeeds: [
      {
        title: 'Drafts, daylight and water intrusion',
        description:
          'Worn weatherstripping, a sagging frame or missing flashing. Catching it early prevents rot in the surrounding wall.',
      },
      {
        title: 'Security upgrades',
        description:
          'Hollow-core exterior doors, cheap locksets and unprotected glass are the common weak points in an entry.',
      },
      {
        title: 'Patio and sliding door replacement',
        description:
          'Failed rollers, fogged glass and leaking tracks. Some units can be repaired; others are better replaced as a complete system.',
      },
      {
        title: 'Curb appeal and style updates',
        description:
          'Entry door replacement is one of the most visible exterior updates a homeowner can make, often with color and hardware changes.',
      },
      {
        title: 'Interior door and trim updates',
        description:
          'Hollow flat-panel doors, worn trim and outdated hardware — quick, contained work that finishes a room.',
      },
    ],
    options: [
      {
        title: 'Door slab replacement',
        description:
          'Reusing an existing frame when it is square, solid and properly flashed. Least expensive, but only appropriate in the right conditions.',
      },
      {
        title: 'Pre-hung unit replacement',
        description:
          'A new door and frame installed together as a unit, with the opening re-flashed and insulated. The most reliable approach for exterior doors.',
      },
      {
        title: 'Patio and sliding systems',
        description:
          'Sliding glass, French and multi-panel doors. Confirm rough-opening dimensions, threshold drainage and screen options.',
      },
      {
        title: 'Security-focused upgrades',
        description:
          'Solid-core or reinforced entries, multipoint locksets, security glass and reinforced strike plates — specified together.',
      },
    ],
    processNote:
      'Door installation requests are shared with independent door and carpentry contractors who list coverage in your area. Safe Home Network does not install doors. Ask the contractor about flashing method, materials and whether the opening needs repair before the new door goes in.',
    faqs: [
      {
        question: 'How long does it take to replace an exterior door?',
        answer:
          'A pre-hung entry door in a sound opening usually takes a few hours. Damage to the rough opening, rot repair, or a change in door size can turn it into a multi-day job. Ask the contractor to inspect the opening before quoting.',
      },
      {
        question: 'Do I need a permit for a new exterior door?',
        answer:
          'Replacing a door in the same opening generally does not require a permit, but enlarging an opening, adding a new door, or changing a wall can. Rules vary by jurisdiction, so confirm locally — especially for new openings in load-bearing walls.',
      },
      {
        question: 'What is flashing and why does it matter?',
        answer:
          'Flashing is the layered water-shedding detail at the door head, jambs and sill. It directs water away from the wall assembly. Without proper flashing, water can enter behind siding and cause rot that is invisible until it is expensive.',
      },
      {
        question: 'Can I just replace the door and keep the frame?',
        answer:
          'If the frame is square, dry, and flashed correctly, a slab or insert replacement is reasonable and less expensive. If the frame is out of square, rotted or leaking, replacing the whole pre-hung unit is the more durable choice.',
      },
    ],
    related: ['window-installation', 'locksmith', 'roofing'],
    metaTitle: 'Door Installation: Entry, Patio & Interior Doors',
    metaDescription:
      'Compare slab and pre-hung door replacement, security upgrades and flashing details, and what to check after install. Check ZIP code availability.',
    searchTerms: ['front door', 'patio door', 'storm door', 'pre-hung', 'door replacement'],
  },
  {
    slug: 'concrete-paving',
    name: 'Concrete & Paving',
    category: 'exterior',
    icon: 'layers',
    image: '/images/service-concrete-paving.jpg',
    featured: true,
    heroHeadline: 'Concrete and Paving Work That Holds Up to Weather',
    heroSubheadline:
      'Driveways, walkways and patios — base preparation, drainage and joints decide how long they last.',
    shortDescription:
      'Driveways, sidewalks, patios and asphalt work, including repairs, sealing and full replacement.',
    intro: [
      'Concrete looks simple from the outside, which is exactly why so much of it fails early. Base preparation, subgrade compaction, drainage slope and joint spacing are what determine whether a slab cracks in the first winter or stays flat for thirty years. The finish is the last decision, not the first.',
      'This page covers the flatwork homeowners most often need, how repair compares with replacement, and the questions to ask before the truck arrives. When you are ready, check whether concrete and paving providers are listed in your area.',
    ],
    commonNeeds: [
      {
        title: 'Cracked or settled driveways',
        description:
          'Hairline cracks are often cosmetic; vertical displacement and wide cracks usually signal a base or drainage problem underneath.',
      },
      {
        title: 'Trip hazards on walkways',
        description:
          'Lifted slabs and uneven joints. Grinding or mudjacking may be an option; sometimes replacement is the safer choice.',
      },
      {
        title: 'New patio or parking pad',
        description:
          'Adding outdoor living space or a widened drive, which requires planning for drainage and local impervious-surface rules.',
      },
      {
        title: 'Asphalt maintenance',
        description:
          'Crack filling, seal coating, patching and overlays extend asphalt life when the base is still intact.',
      },
      {
        title: 'Poor site drainage',
        description:
          'Water pooling against foundations and in low spots. Regrading and proper pitch prevent bigger structural problems.',
      },
    ],
    options: [
      {
        title: 'Concrete replacement',
        description:
          'Removal, base re-compaction and a new pour with control joints and proper slope. The durable answer when base or subgrade has failed.',
      },
      {
        title: 'Repair and slab lifting',
        description:
          'Crack repair, epoxy injection, grinding trip hazards, or foam/mudjacking to lift settled slabs without a full tear-out.',
      },
      {
        title: 'Asphalt paving and sealing',
        description:
          'New asphalt, patching, overlays and seal coating. Seal coating protects the surface but does not fix a failed base.',
      },
      {
        title: 'Pavers and decorative finishes',
        description:
          'Stamped concrete, exposed aggregate and unit pavers. Some finishes require more maintenance and resealing than plain concrete.',
      },
    ],
    processNote:
      'Concrete and paving requests are shared with independent contractors who list coverage in your area. Safe Home Network does not pour or repair flatwork. The contractor confirms subgrade conditions, thickness, reinforcement, slope and pricing directly with you.',
    faqs: [
      {
        question: 'How long before I can drive on new concrete?',
        answer:
          'Concrete typically needs about seven days to reach a reasonable working strength and is usually safe to drive on after that, though full cure takes longer. Cold, wet weather extends the wait. Follow the specific instructions from the contractor rather than a general rule.',
      },
      {
        question: 'Why did my driveway crack so quickly?',
        answer:
          'Common causes are an inadequately compacted base, missing or too widely spaced control joints, slabs poured too thin for the load, or water pooling under the slab. Cracks that are even and narrow are often expected behavior; wide, offset cracks are not.',
      },
      {
        question: 'Is seal coating asphalt every year necessary?',
        answer:
          'Usually not. Seal coating every one to three years is a common recommendation for residential driveways, but over-applying can cause the surface to become brittle and crack. New asphalt should typically cure for several months before the first seal.',
      },
      {
        question: 'Do I need a permit for a new driveway or patio?',
        answer:
          'Many municipalities require permits for new driveways, sidewalk cuts and changes in impervious surface coverage, and some limit how much of a lot can be paved. Confirm local requirements before work starts.',
      },
    ],
    related: ['roofing', 'door-installation', 'window-installation'],
    metaTitle: 'Concrete & Paving: Driveways, Patios, Asphalt',
    metaDescription:
      'Understand concrete and asphalt installation, base preparation, repair versus replacement and permit considerations. Check ZIP code availability.',
    searchTerms: ['driveway', 'patio', 'sidewalk', 'asphalt', 'seal coating', 'pavers'],
  },
  {
    slug: 'locksmith',
    name: 'Locksmith',
    category: 'specialty',
    icon: 'key-round',
    image: '/images/service-locksmith.jpg',
    featured: true,
    heroHeadline: 'Locksmith Help for Lockouts, Rekeys and Lock Upgrades',
    heroSubheadline:
      'Know what a legitimate locksmith should ask for, and what a fair job looks like before anyone touches your door.',
    shortDescription:
      'Home lockouts, rekeys, lock replacement, smart locks and deadbolt upgrades from local locksmiths.',
    intro: [
      'Locksmith work is one of the few home services where the homeowner is often in a hurry and under pressure — locked out in a parking lot at night, or just after moving into a home with unknown keys. That combination attracts both good operators and bad ones, so knowing a few basics makes a real difference.',
      'This page explains the common locksmith jobs, how rekeying compares with replacement, and what to confirm before a technician starts. Then you can check whether locksmith coverage is confirmed for your area.',
    ],
    commonNeeds: [
      {
        title: 'Home lockouts',
        description:
          'A locked door, a broken key or a jammed mechanism. Non-destructive entry is the skill to ask about.',
      },
      {
        title: 'Moving into a new home',
        description:
          'You do not know who holds keys to an unfamiliar house. Rekeying is usually faster and less expensive than replacing hardware.',
      },
      {
        title: 'Deadbolt and security upgrades',
        description:
          'Standard builder-grade locksets and short screws are common weak points. ANSI-graded deadbolts and reinforced strikes improve them.',
      },
      {
        title: 'Broken or worn hardware',
        description:
          'Loose cylinders, snapped keys and failing latches. Often a hardware replacement rather than a full locksmith visit.',
      },
      {
        title: 'Smart lock installation',
        description:
          'Keypad and app-based locks need the right door prep, deadbolt alignment and a realistic plan for battery and connectivity.',
      },
    ],
    options: [
      {
        title: 'Rekeying existing locks',
        description:
          'The cylinders are re-pinned to a new key while the existing hardware stays. Cost-effective and fast when hardware is in good condition.',
      },
      {
        title: 'Lock replacement',
        description:
          'New locksets or deadbolts when hardware is worn, mismatched or not up to the security level you want.',
      },
      {
        title: 'Key duplication and master keying',
        description:
          'Extra keys, or a single key for multiple doors. Ask about restricted keyways if you want duplication controlled.',
      },
      {
        title: 'Smart lock installation and setup',
        description:
          'Deadbolt replacement with app or keypad access, including user codes and access history for guests or renters.',
      },
    ],
    processNote:
      'Locksmith requests are shared with independent locksmiths whose coverage is confirmed for your area. Safe Home Network does not dispatch or perform locksmith work. For a lockout, call a local locksmith directly and confirm pricing before work begins.',
    faqs: [
      {
        question: 'How do I avoid a locksmith scam?',
        answer:
          'Ask for the company name and a physical local address, confirm a written price before any work starts, ask whether drilling is required, and pay by card rather than cash only. Be cautious with national call centers that route to whoever is available and quote unrealistically low prices.',
      },
      {
        question: 'Should I rekey or replace my locks?',
        answer:
          'Rekeying changes who can use the lock while keeping the hardware. Replacement makes sense when the hardware is worn, was installed poorly, or when you want a higher security grade. For a new home with sound locks, rekeying is usually the practical choice.',
      },
      {
        question: 'Can a locksmith open a door without damaging it?',
        answer:
          'In most residential lockouts, yes — a competent locksmith uses non-destructive techniques. Drilling is sometimes necessary for a failed or high-security cylinder. Ask before approving a destructive approach, and ask what the replacement cost will be if drilling is required.',
      },
      {
        question: 'Do locksmiths need a license?',
        answer:
          'Licensing rules vary by state and some municipalities require registration or a license number on advertising. Ask for the license or registration number where required, and verify it with the issuing authority before authorizing work.',
      },
    ],
    related: ['door-installation', 'electrical', 'pest-control'],
    metaTitle: 'Locksmith Services: Lockouts, Rekeys & Locks',
    metaDescription:
      'Learn how rekeying compares with replacement, what to confirm before a locksmith starts and how to avoid scams. Check locksmith coverage by ZIP code.',
    searchTerms: ['lockout', 'rekey', 'deadbolt', 'smart lock', 'key duplication'],
  },
]

/* -------------------------------------------------------------------------- */
/*  Derived helpers — used by routing, navigation, search and SEO             */
/* -------------------------------------------------------------------------- */

export const SERVICE_BY_SLUG: Record<string, Service> = SERVICES.reduce(
  (acc, service) => {
    acc[service.slug] = service
    return acc
  },
  {} as Record<string, Service>,
)

export const getService = (slug: string): Service | undefined => SERVICE_BY_SLUG[slug]

export const servicePath = (slug: string): string => `/services/${slug}`

export const featuredServices = (): Service[] => SERVICES.filter((service) => service.featured)

export const servicesByCategory = (categoryId: string): Service[] =>
  SERVICES.filter((service) => service.category === categoryId)

export const relatedServices = (service: Service): Service[] =>
  service.related
    .map((slug) => SERVICE_BY_SLUG[slug])
    .filter((related): related is Service => Boolean(related))
