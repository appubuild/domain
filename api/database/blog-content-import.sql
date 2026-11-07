-- ============================================================================
--  Safe Home Network — blog content import (30 articles)
-- ----------------------------------------------------------------------------
--  GENERATED FILE — do not edit by hand.
--  Source: api/database/content/articles/*.json
--  Regenerate: node scripts/generate-blog-import.mjs
--
--  What it does
--    · 15 blog categories + tags (idempotent: matched on slug)
--    · 30 posts with SEO fields, metadata, category and tag links
--    · articles 1–10 are published, the rest scheduled one per day
--      at 09:00 America/New_York, stored in UTC
--    · safe to re-run: posts are matched on slug and updated in place
--
--  Run api/database/migrations/2026-11-blog-cms-upgrade.sql FIRST.
--  Then import this file. Activate the cron job separately (docs/PUBLISHING.md).
-- ============================================================================

SET NAMES utf8mb4;

/* ---------------------------- 1. Categories ---------------------------- */
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('appliance-repair', 'Appliance Repair', 'Diagnostics, repair-or-replace decisions and what a technician should check for the appliances a home actually runs on.', 'Appliance Repair Guides for Homeowners', 'Plain-English appliance repair guides: what common symptoms mean, which checks are safe to do yourself, and when a qualified technician should take over.', 1, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('electrical', 'Electrical Services', 'Safe diagnostics for the electrical issues homeowners can observe, and clear guidance on what must be handled by a licensed electrician.', 'Electrical Safety Guides for Homeowners', 'Recognise the warning signs of electrical problems in a house — warm outlets, flickering lights, buzzing panels — and know which ones need an electrician today.', 2, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('plumbing', 'Plumbing', 'Leaks, pressure problems, water heaters and drains explained in plain English, with a clear line between a five-minute check and a call to a licensed plumber.', 'Plumbing Guides for Homeowners', 'Practical plumbing guides: how to read the warning signs of a leak, when a slow drain is a symptom rather than a nuisance, and which jobs belong with a licensed plumber.', 3, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('hvac', 'HVAC', 'Heating and cooling guides for the checks a homeowner can safely make, plus the symptoms that mean a technician needs to look at the system.', 'HVAC Guides for Homeowners', 'Understand your heating and cooling system: why the AC is not cooling, what a furnace service actually includes, and how to tell a filter problem from a refrigerant fault.', 4, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('roofing', 'Roofing', 'Roof replacement and installation explained: materials, timelines, quotes and the inspection steps that tell you whether a roof has years left or months.', 'Roofing Guides for Homeowners', 'Plan a roofing project with confidence: how to read the early signs of a leak, what a full replacement involves, and the questions that separate a good quote from a cheap one.', 5, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('roof-repair', 'Roof Repair', 'Targeted roof repairs: how to scope a leak, what a repair should include, and the honest point at which patching stops being worth the money.', 'Roof Repair Guides for Homeowners', 'Roof repair explained: what a proper repair covers, what it should cost, and the age and damage thresholds that make replacement the cheaper long-term choice.', 6, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('water-damage', 'Water Damage Restoration', 'What to do when water gets into a home: immediate mitigation, drying timelines, mold risk and how a restoration job is scoped.', 'Water Damage Guides for Homeowners', 'Practical water damage advice: the first-hour actions that limit loss, what professional drying involves, and the point at which mold becomes the bigger cost.', 7, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('pest-control', 'Pest Control', 'Prevention and treatment guides for the pests that damage property, from subterranean termites to rodents, with the early signs that make treatment cheaper.', 'Pest Control Guides for Homeowners', 'Identify pest problems early: termite warning signs, rodent entry points, and the difference between a DIY fix and a treatment that needs a licensed applicator.', 8, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('kitchen-remodeling', 'Kitchen Remodeling', 'Budgeting and planning a kitchen remodel: where the money actually goes, what drives the range, and how to sequence a project without living in a construction site longer than necessary.', 'Kitchen Remodeling Guides', 'Plan a kitchen remodel with realistic numbers: cabinet and countertop costs, labour percentages, contingency, and the choices that move a budget most.', 9, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('bathroom-remodeling', 'Bathroom Remodeling', 'Planning a bathroom that stays dry and works hard: ventilation, waterproofing, layout constraints and the upgrades that justify their cost.', 'Bathroom Remodeling Guides', 'Bathroom remodel planning made practical: the order of decisions, waterproofing that matters, ventilation requirements and where to spend versus save.', 10, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('window-installation', 'Window Installation', 'Window replacement and upgrade guidance: how to judge whether an old window is worth repairing, what installation quality depends on, and how to read efficiency ratings.', 'Window Installation Guides', 'Window replacement explained: the signs a window is failing, what drives the price, and the installation details that determine whether the new window performs.', 11, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('door-installation', 'Door Installation', 'Exterior and interior door projects: sizing, security, energy performance and the installation details that decide whether a new door closes properly for years.', 'Door Installation Guides', 'Front door replacement explained: how to size a door, choose between steel, fiberglass and wood, and what a proper installation includes.', 12, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('concrete-paving', 'Concrete & Paving', 'Driveways, patios and concrete repair: how a slab is built, why it fails, and the base preparation that separates a 30-year driveway from a five-year one.', 'Concrete & Paving Guides', 'Concrete and paving guides for homeowners: what a driveway replacement should include, how base preparation decides longevity, and when repair beats replacement.', 13, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('locksmith', 'Locksmith', 'Locks, keys and home security: when rekeying is enough, when hardware has to be replaced, and how to avoid the locksmith scams that follow a lockout.', 'Locksmith Guides for Homeowners', 'Rekeying versus replacement explained: costs, when each makes sense, what a locksmith should charge, and how to spot an unlicensed operator.', 14, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);
INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)
VALUES ('hiring-a-pro', 'Hiring a Pro', 'How to vet, quote and manage a home service professional: what a proper proposal contains, the questions that reveal experience, and how to handle changes and payment.', 'Hiring a Home Service Professional', 'Compare home service quotes properly: scope, exclusions, labour rates, warranty and payment terms, plus the questions that expose an inexperienced contractor.', 15, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);

/* ------------------------------- 2. Tags ------------------------------- */
INSERT INTO blog_tags (slug, name) VALUES ('air-conditioning', 'air conditioning')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('appliance-repair', 'appliance repair')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('appliances', 'appliances')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('bathroom-remodeling', 'bathroom remodeling')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('budget', 'budget')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('budgeting', 'budgeting')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('circuit-breakers', 'circuit breakers')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('concrete', 'concrete')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('consumer-protection', 'consumer protection')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('contractors', 'contractors')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('diagnostics', 'diagnostics')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('doors', 'doors')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('driveways', 'driveways')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('efficiency', 'efficiency')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('electrical', 'electrical')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('electrical-safety', 'electrical safety')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('emergency', 'emergency')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('energy', 'energy')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('estimates', 'estimates')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('fire-prevention', 'fire prevention')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('food-safety', 'food safety')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('health', 'health')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('heating', 'heating')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('hiring', 'hiring')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('home-safety', 'home safety')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('home-value', 'home value')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('hvac', 'hvac')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('inspection', 'inspection')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('insurance', 'insurance')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('kitchen-remodeling', 'kitchen remodeling')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('leaks', 'leaks')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('locks', 'locks')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('locksmith', 'locksmith')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('maintenance', 'maintenance')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('mold', 'mold')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('permits', 'permits')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('pest-control', 'pest control')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('planning', 'planning')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('plumbing', 'plumbing')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('prevention', 'prevention')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('project-management', 'project management')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('quotes', 'quotes')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('refrigerator', 'refrigerator')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('repair', 'repair')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('repair-or-replace', 'repair or replace')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('replacement', 'replacement')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('restoration', 'restoration')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('rodents', 'rodents')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('roof-repair', 'roof repair')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('roofing', 'roofing')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('safety', 'safety')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('sealing', 'sealing')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('security', 'security')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('small-spaces', 'small spaces')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('specification', 'specification')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('storm-damage', 'storm damage')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('termites', 'termites')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('timeline', 'timeline')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('ventilation', 'ventilation')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('vetting', 'vetting')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('water-damage', 'water damage')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('water-heaters', 'water heaters')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('waterproofing', 'waterproofing')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO blog_tags (slug, name) VALUES ('windows', 'windows')
ON DUPLICATE KEY UPDATE name = VALUES(name);

/* ------------------------------- 3. Posts ------------------------------ */
-- 01. Common Appliance Problems and When to Call a Repair Professional
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'common-appliance-problems-when-to-call-a-repair-professional', 'Common Appliance Problems and When to Call a Repair Professional', c.id, 'published',
       'Most appliance failures announce themselves before they stop working. Here are the symptoms worth acting on, the checks that are safe to do yourself, and the point where a technician should take over.', '<p>An appliance rarely fails without warning. A fridge runs a little longer, a washer thumps on the spin cycle, an oven takes twenty minutes to reach temperature. Those small changes are the cheapest moment to act, because the repair is usually a part rather than the whole machine.</p>
<p>This guide covers the failures homeowners report most often, what each symptom usually points to, and which checks are genuinely safe to do yourself. It also explains when stopping and calling a qualified appliance technician is the cheaper and safer decision.</p>
<p>One rule applies to every appliance in this article: anything that involves gas, a sealed refrigerant circuit, or opening a panel that exposes mains wiring is a job for a professional. The rest is about gathering evidence so the conversation with a technician starts from facts.</p>
<h2>Start with the three questions that solve most cases</h2>
<p>Before diagnosing anything, answer three questions. They remove a surprising share of service calls that turn out to be user error or a household supply problem.</p>
<ol><li><strong>Is it receiving power?</strong> Check the plug is fully seated, the socket works with another device, and the breaker has not tripped. For a gas appliance, confirm the gas supply was not shut off during other work.</li><li><strong>Is it receiving water or drainage?</strong> Dishwashers and washing machines fail on a kinked inlet hose or a blocked standpipe at least as often as on a pump.</li><li><strong>Did anything change?</strong> A new outlet strip, a kitchen remodel, a power cut, a moved appliance, a filter change — most "it just stopped" stories have a trigger.</li></ol>
<blockquote><p>Never pull an appliance out by its cord, and never test a socket with a screwdriver. A plug-in socket tester costs a few dollars and removes the guesswork.</p></blockquote>
<h2>The failures homeowners meet most often</h2>
<figure class="article-table"><table><thead><tr><th>Appliance</th><th>Typical symptom</th><th>Common causes</th><th>Reasonable first step</th></tr></thead><tbody><tr><td>Refrigerator</td><td>Fridge warm, freezer cold</td><td>Blocked evaporator airflow, dirty condenser coils, door seal, failed fan</td><td>Check seals, clear vents, vacuum the coils</td></tr><tr><td>Dishwasher</td><td>Standing water after a cycle</td><td>Blocked filter, kinked drain hose, disposer plug, failing pump</td><td>Clean the filter and check the drain hose route</td></tr><tr><td>Washing machine</td><td>Won''t drain or spins loudly</td><td>Clogged pump filter, unbalanced load, worn shock absorbers</td><td>Clear the filter, rebalance the load</td></tr><tr><td>Dryer</td><td>Clothes take two cycles</td><td>Lint-blocked duct, crushed vent hose, failing heating element</td><td>Clean the lint path; stop if airflow is still weak</td></tr><tr><td>Oven</td><td>Uneven baking or slow heat-up</td><td>Failed bake element, faulty temperature sensor, worn door seal</td><td>Check the seal and note the temperature pattern</td></tr><tr><td>Range hood</td><td>Weak extraction</td><td>Saturated charcoal filter, blocked duct flap</td><td>Replace the filter, check the exterior flap</td></tr><tr><td>Microwave</td><td>Runs but does not heat</td><td>Failed magnetron or capacitor</td><td>Stop using it — the capacitor holds a lethal charge</td></tr><tr><td>Water heater</td><td>Lukewarm water</td><td>Failed element (electric), sediment build-up, pilot or thermocouple (gas)</td><td>Note whether it is electric or gas before calling</td></tr></tbody></table></figure>
<h2>What a technician actually checks</h2>
<h3>Refrigerant and sealed systems</h3>
<p>If a refrigerator or air conditioner has lost refrigerant, the system has a leak, and the leak must be found and repaired before recharging. Topping up a leaking system is a temporary fix that damages the compressor. This work needs certification and gauges — it is never a homeowner task.</p>
<h2>Repair or replace? A decision homeowners can make</h2>
<p>The industry rule of thumb is simple enough to use: multiply the appliance''s age by the repair cost, and compare the result with the price of a comparable new unit. Above roughly half the replacement price, replacement usually wins — especially for appliances already past their expected service life.</p>
<p>That rule is a starting point, not a verdict. Efficiency matters too: a fifteen-year-old refrigerator can use meaningfully more electricity than a current model, which changes the maths over a few years. Rebates and tax incentives for efficient appliances vary by state and utility, so check locally before assuming a new unit costs the full sticker price.</p>
<figure class="article-table"><table><thead><tr><th>Appliance</th><th>Typical service life</th><th>Repair usually sensible when…</th></tr></thead><tbody><tr><td>Refrigerator</td><td>12–15 years</td><td>Under 10 years old and the sealed system is intact</td></tr><tr><td>Dishwasher</td><td>9–12 years</td><td>A pump, valve or control board, not a leaking tub</td></tr><tr><td>Washing machine</td><td>10–13 years</td><td>Bearings and drum are sound</td></tr><tr><td>Dryer</td><td>10–13 years</td><td>The duct is clear and the drum turns freely</td></tr><tr><td>Oven / range</td><td>13–15 years</td><td>A heating element, igniter or thermostat</td></tr><tr><td>Microwave</td><td>9–10 years</td><td>Rarely worth repairing beyond a fuse or door switch</td></tr></tbody></table></figure>
<h2>The checks worth doing before you book a visit</h2>
<ul><li>Write down the exact model and serial number — it is on a plate inside the door or behind the kick panel, and it determines part availability.</li><li>Record the symptom with a short video, including any sound the machine makes.</li><li>Note what you already tried so the technician is not billed for repeating it.</li><li>Confirm the appliance is level and the door seals sit flush; a misaligned door is a common and cheap fix.</li><li>Ask whether the company''s diagnostic fee is credited against the repair — a fair policy either way, but it should be stated up front.</li></ul>
<h2>When to stop and call a professional</h2>
<p>Stop immediately if you smell gas, see scorched wiring, notice water pooling near an electrical component, or the breaker trips every time the appliance runs. Unplug the appliance if you can reach the plug safely and call a qualified technician or your gas utility.</p>
<p>Also call for anything behind a sealed panel, anything involving refrigerant, and any repair that requires moving a unit heavier than you can handle safely. Appliance injuries are usually back injuries or cuts from sharp sheet-metal edges, both avoidable.</p>
<blockquote><p>If the appliance is still under a manufacturer warranty, call the manufacturer''s authorised service first. Opening the cabinet yourself can void the warranty.</p></blockquote>
<h2>Frequently asked questions</h2>
<h3>How much does an appliance repair usually cost?</h3><p>Pricing depends entirely on the appliance, the part and your market, so any national figure is a guess. Ask for the diagnostic fee, whether it is credited against the repair, and the parts-and-labour price in writing before work begins. Compare the quote with the replacement cost of a comparable unit — that comparison matters more than the absolute number.</p>
<h3>Is it worth repairing a 12-year-old appliance?</h3><p>Sometimes. If the machine is otherwise sound and the fault is a single inexpensive part, repair can buy several more years. If the repair approaches half the price of a new unit, or the appliance is already past its expected service life, replacement is usually the better use of the money.</p>
<h3>Can I repair my own appliances?</h3><p>You can safely do the external checks: power, water, filters, seals, level, and clearing lint or debris. Anything that requires opening a panel, touching a capacitor, working on a gas line or handling refrigerant should be left to a qualified technician — microwave capacitors in particular can hold a lethal charge long after the unit is unplugged.</p>
<h3>Why did the technician ask for the model number first?</h3><p>Because the same symptom can need a different part on different revisions of the same model. The model and serial number identify the exact build, which is what makes a first-visit repair possible instead of a second appointment.</p>
<h2>Where to go next</h2><ul><li><a href="/services">Browse home service categories</a></li><li><a href="/blog/how-to-choose-a-reliable-appliance-repair-service">How to choose a reliable appliance repair service</a></li><li><a href="/blog/refrigerator-not-cooling-common-causes">Refrigerator not cooling: common causes</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/common-appliance-problems-when-to-call-a-repair-professional.svg', 'Illustration of a technician checking the inside of a wall oven while a homeowner looks on',
       'Common Appliance Problems and When to Call a Pro', 'The symptoms homeowners see most often, the checks that are safe to do yourself, and the point where an appliance repair professional should take over.', 'Diagnostic guide to the ten most common appliance failures, with a safe-to-check / call-a-pro split.',
       'appliance repair', 'appliance repair near me, home appliance problems, appliance not working, appliance repair cost, when to call appliance repair, refrigerator repair, washer repair',
       NULL, 0, '/images/blog/common-appliance-problems-when-to-call-a-repair-professional.svg', 'Safe Home Network Editorial',
       '2026-10-24 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'appliance-repair'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional' AND t.slug = 'diagnostics';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional' AND t.slug = 'safety';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional' AND t.slug = 'repair-or-replace';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional' AND t.slug = 'appliances';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'US homeowners deciding whether a failing appliance is a quick fix, a repair job or a replacement.' FROM blog_posts b WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '1265 words' FROM blog_posts b WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'Browse home service categories' FROM blog_posts b WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/how-to-choose-a-reliable-appliance-repair-service
/blog/refrigerator-not-cooling-common-causes
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector scene: technician with a multimeter at an open oven, homeowner holding a manual, warm kitchen background.' FROM blog_posts b WHERE b.slug = 'common-appliance-problems-when-to-call-a-repair-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 02. Refrigerator Not Cooling? Common Causes Homeowners Should Know
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'refrigerator-not-cooling-common-causes', 'Refrigerator Not Cooling? Common Causes Homeowners Should Know', c.id, 'published',
       'A refrigerator that runs but will not cool is usually one of eight things. Start with the checks that cost nothing, then decide whether the sealed system needs a professional.', '<p>The refrigerator is the one appliance where the failure costs money by the hour. Before anything else: if the interior is above 40°F (4°C), food safety becomes the priority. Perishables that have been above that temperature for more than about two hours are better discarded than risked — and that decision should be made before you start troubleshooting.</p>
<p>Once the food is dealt with, the cause is usually one of eight things. Four are safe and sensible for a homeowner to check. Four involve sealed-system or electrical work that belongs with a qualified appliance technician.</p>
<h2>1. Airflow inside the cabinet</h2>
<p>Cold air is produced in the freezer and travels into the fresh-food compartment through a vent, often driven by a fan. Overload the shelves, push a cereal box against the vent, or let the freezer fill to the door and the fridge section stops receiving cold air. The symptom is unmistakable: the freezer is fine, the fridge is warm.</p>
<p>Pull everything away from the vents, leave a couple of inches of clearance at the back, and give the unit a few hours. If the fridge recovers, nothing is broken — the layout was.</p>
<h2>2. Door seals and alignment</h2>
<p>A seal that does not sit flush lets warm, humid room air in continuously. The compressor runs without ever catching up, and you may notice condensation or frost near the door frame. Test with the dollar-bill trick: close the door on a note and pull gently at several points. It should resist all the way around; a spot that slides out freely is a gap.</p>
<p>Clean the gasket with warm soapy water, check the door is level and that the hinges have not sagged. Replacement gaskets are inexpensive and are a reasonable homeowner job on most models.</p>
<h2>3. Condenser coils and ventilation</h2>
<p>Coils at the back or underneath the unit shed heat into the room. When they are caked in dust and pet hair, heat cannot escape and cooling performance drops — often worst in summer, which is when people notice. Vacuum the coils with a brush attachment and clear the gap around the cabinet.</p>
<p>This is one of the few genuinely valuable maintenance tasks on a refrigerator, and it also reduces energy use. Do it twice a year with pets in the house.</p>
<h2>4. Settings and controls</h2>
<p>It sounds trivial until it happens: a child has turned the temperature dial, a demo mode is on, or the control panel was bumped during cleaning. Check the set point against the manual, confirm the unit is not in a display or vacation mode, and look for an error code on the panel.</p>
<p>Also confirm the appliance is plugged into a working socket — a fridge on a switched outlet that someone switched off will run on nothing at all. A refrigerator that is completely silent with the light on points at the control board rather than cooling.</p>
<h2>5. Evaporator fan failure</h2>
<p>The evaporator fan moves air across the cold coil. When it fails, the freezer may still be cold but the fridge section warms, and you may hear nothing where you previously heard a hum. Some models show a fan error code.</p>
<p>You can listen for the fan by opening the freezer door and pressing the door switch; if the fan does not spin up and there is no obstruction, the motor or its control is at fault. Replacement requires dismantling the freezer interior, which is a technician job on most models.</p>
<h2>6. Frost build-up on the evaporator</h2>
<p>A defrost system failure lets ice coat the evaporator until airflow stops entirely. Symptoms include a fridge that gradually warms over days, frost visible at the back of the freezer, and a compressor that runs constantly.</p>
<p>A one-time manual defrost — empty the unit, unplug it, leave the doors open for 24 hours with towels down — will restore cooling temporarily. If the problem returns within weeks, the defrost heater, thermostat or timer needs replacement. That is a technician repair, not a permanent fix.</p>
<h2>7. Start relay or compressor problems</h2>
<p>If the compressor tries to start, clicks, and stops, the start relay may have failed. Sometimes the compressor itself has. You may hear a click every few minutes and feel the side of the cabinet staying cold to the touch.</p>
<p>A failed relay is a modest repair; a failed compressor usually is not, especially on an older unit. A technician diagnoses this with a meter rather than by substitution, which is why it is worth paying for the diagnostic instead of buying parts on suspicion.</p>
<h2>8. Refrigerant leak</h2>
<p>A sealed system that has lost refrigerant cannot cool, no matter how clean the coils are. Signs include a compressor that runs continuously without getting warm, no frost pattern on the evaporator, and sometimes an oily residue at a joint.</p>
<p>Refrigerant work requires certification, gauges and a leak search. Recharging a leaking system is not a repair — it is a delay that damages the compressor. If a technician confirms a leak in an accessible component, repair can be worthwhile; if the leak is in the sealed evaporator of an older unit, replacement is usually the honest recommendation.</p>
<blockquote><p>Never add refrigerant or "top up" a domestic refrigerator yourself. It is illegal without certification in the US, and it does not fix the underlying leak.</p></blockquote>
<h2>A sensible order of work</h2>
<ol><li>Move perishables to a cooler with ice; discard anything that has been warm for hours.</li><li>Confirm power, then check the set point and any error code.</li><li>Clear vents and rebalance the shelves; test the door seals.</li><li>Vacuum the condenser coils and confirm the unit has rear clearance.</li><li>If it still will not cool, book a technician and describe the freezer-versus-fridge pattern — that single detail tells them which subsystem to bring parts for.</li></ol>
<h2>What the freezer-versus-fridge pattern tells a technician</h2>
<figure class="article-table"><table><thead><tr><th>Pattern</th><th>Most likely area</th><th>Typical next step</th></tr></thead><tbody><tr><td>Both sections warm, compressor silent</td><td>Power, control board, start relay</td><td>Electrical diagnosis</td></tr><tr><td>Freezer cold, fridge warm</td><td>Airflow, evaporator fan, damper</td><td>Fan or damper replacement</td></tr><tr><td>Everything warm, compressor hot and running</td><td>Condenser airflow, sealed system</td><td>Coil clean, then pressure test</td></tr><tr><td>Frost at the back of the freezer</td><td>Defrost system</td><td>Heater, thermostat or timer</td></tr><tr><td>Cooling returns after a 24-hour defrost, then fails again</td><td>Defrost system</td><td>Same as above — the defrost is not completing</td></tr></tbody></table></figure>
<h2>Frequently asked questions</h2>
<h3>How long can food stay safe in a fridge that is not cooling?</h3><p>The USDA guidance is that perishable food should be discarded if it has been above 40°F for more than two hours. A closed refrigerator holds cold for roughly four hours; a full freezer rather longer. When in doubt, throw it out — the cost of replacing food is far lower than the cost of a foodborne illness.</p>
<h3>Why is my freezer cold but the refrigerator warm?</h3><p>That pattern almost always means cold air is not reaching the fresh-food compartment: a blocked vent, a failed evaporator fan, a stuck air damper, or heavy frost from a defrost failure. It is rarely a refrigerant problem, which is good news for the repair bill.</p>
<h3>Can I just turn the temperature down to fix it?</h3><p>Lowering the set point masks a mild airflow or seal problem and makes the compressor run continuously, which wastes energy and shortens its life. Find the cause instead; if the unit cannot hold 37°F at the normal setting, something needs attention.</p>
<h3>Is a refrigerator repair worth it on a 10-year-old unit?</h3><p>Often yes for a fan, relay, thermostat or defrost component. A sealed-system repair on a unit near the end of its 12–15 year life is usually not, because the labour is significant and the rest of the appliance is also ageing. Ask for both numbers before deciding.</p>
<h2>Where to go next</h2><ul><li><a href="/services">Browse home service categories</a></li><li><a href="/blog/common-appliance-problems-when-to-call-a-repair-professional">Common appliance problems and when to call a pro</a></li><li><a href="/blog/how-to-choose-a-reliable-appliance-repair-service">How to choose a reliable appliance repair service</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/refrigerator-not-cooling-common-causes.svg', 'Illustration of an open refrigerator with warm air indicated, a thermometer and a technician''s tool bag',
       'Refrigerator Not Cooling? 8 Causes and What to Check', 'Fridge warm but freezer cold? Work through the safe causes first — airflow, seals, coils and controls — then learn which faults need a certified technician.', 'Ordered troubleshooting guide for a refrigerator that is not cooling, with a clear stop line before refrigerant work.',
       'refrigerator not cooling', 'fridge not cold, refrigerator warm but freezer cold, refrigerator repair, refrigerator not cooling but light on, fridge compressor not running, how to check refrigerator condenser coils',
       NULL, 0, '/images/blog/refrigerator-not-cooling-common-causes.svg', 'Safe Home Network Editorial',
       '2026-10-25 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'appliance-repair'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'refrigerator-not-cooling-common-causes';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'refrigerator-not-cooling-common-causes' AND t.slug = 'refrigerator';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'refrigerator-not-cooling-common-causes' AND t.slug = 'diagnostics';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'refrigerator-not-cooling-common-causes' AND t.slug = 'food-safety';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'refrigerator-not-cooling-common-causes' AND t.slug = 'energy';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'refrigerator-not-cooling-common-causes'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with a refrigerator that runs but is not holding temperature, deciding between a DIY check and a service call.' FROM blog_posts b WHERE b.slug = 'refrigerator-not-cooling-common-causes'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '1362 words' FROM blog_posts b WHERE b.slug = 'refrigerator-not-cooling-common-causes'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'Browse home service categories' FROM blog_posts b WHERE b.slug = 'refrigerator-not-cooling-common-causes'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/common-appliance-problems-when-to-call-a-repair-professional
/blog/how-to-choose-a-reliable-appliance-repair-service' FROM blog_posts b WHERE b.slug = 'refrigerator-not-cooling-common-causes'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector: open fridge with a warm-air wavy line, thermometer reading, coils behind the unit.' FROM blog_posts b WHERE b.slug = 'refrigerator-not-cooling-common-causes'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 03. How to Choose a Reliable Appliance Repair Service
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'how-to-choose-a-reliable-appliance-repair-service', 'How to Choose a Reliable Appliance Repair Service', c.id, 'published',
       'Diagnostic fees, parts policies, warranty wording and the questions that reveal how a repair company actually works — a practical checklist for choosing well the first time.', '<p>Appliance repair is one of the few trades where a homeowner often calls someone without any personal reference, in a hurry, with a machine full of food or washing. That combination makes it worth knowing what a good operator looks like before you need one.</p>
<p>This guide is deliberately practical. It covers what to verify, what to ask, how the money usually works, and the specific behaviours that should make you choose someone else.</p>
<h2>Verify three things before you book</h2>
<h3>Manufacturer authorisation</h3>
<p>If your appliance is still under warranty, work by an unauthorised technician can void it. Ask whether the company is authorised for your brand, and check with the manufacturer if the answer is vague. For out-of-warranty work it matters less, but authorisation is a signal that the technician has access to current parts and service documentation.</p>
<h2>Understand how the money works</h2>
<p>None of these structures is inherently dishonest — but the diagnostic fee policy is the one that most often surprises homeowners. A company that credits the fee against the repair is telling you it expects to do the work; a company that charges a full diagnostic and then quotes a separate inflated repair is a different proposition.</p>
<p>Get the total in writing before work starts. A verbal "around two hundred" is not a quote, and it is not enforceable.</p>
<figure class="article-table"><table><thead><tr><th>Charge type</th><th>What it should mean</th><th>What to confirm</th></tr></thead><tbody><tr><td>Diagnostic fee</td><td>Pays for travel and fault-finding</td><td>Is it credited against the repair if you proceed?</td></tr><tr><td>Flat-rate repair</td><td>One price for the job, parts included</td><td>Does it cover the part, labour, and a return visit if the fault persists?</td></tr><tr><td>Time and materials</td><td>Hourly labour plus parts at cost or list</td><td>What is the hourly rate, and is there a minimum?</td></tr><tr><td>Trip charge</td><td>Travel only, on top of labour</td><td>Is it charged again if parts must be ordered?</td></tr></tbody></table></figure>
<h2>Ask these eight questions</h2>
<ol><li>Are you licensed or registered where my state or city requires it, and what is the number?</li><li>Do you carry liability insurance and workers'' compensation?</li><li>Is the diagnostic fee credited if I approve the repair?</li><li>Will you give me a written price before starting work?</li><li>What warranty do you provide on the part, and separately on the labour?</li><li>Do you use original manufacturer parts, and if not, what are you fitting?</li><li>If the part has to be ordered, is the return visit charged?</li><li>What happens if the same fault returns within 30 days?</li></ol>
<blockquote><p>A good sign is a company that answers these by email without being pushed. A bad sign is irritation at being asked.</p></blockquote>
<h2>Parts policy matters more than people expect</h2>
<p>Original equipment manufacturer (OEM) parts fit and carry the manufacturer''s quality control. Aftermarket parts are often perfectly serviceable and cheaper, but quality varies widely by category, and some cheap control boards fail quickly.</p>
<p>Ask which is being fitted and what it changes about the warranty. If a company will not tell you, that is the answer.</p>
<h2>Warranty wording to read closely</h2>
<p>A typical trade warranty covers the part for 90 days to a year and the labour for 30 to 90 days. The wording matters in three places: whether the warranty covers the part only or the whole repair, whether it is void if you use another company, and whether a repeat visit carries a new trip charge.</p>
<p>Ask for the warranty in writing. If a company offers "a guarantee" with no terms, that guarantee is a mood rather than a promise.</p>
<h2>Red flags worth walking away from</h2>
<ul><li>A price quoted over the phone without the model number — it is a number designed to get the visit booked.</li><li>Pressure to decide immediately, or a discount that expires while the technician is standing in your kitchen.</li><li>Refusal to put the diagnosis or the price in writing.</li><li>A diagnosis that changes after the appliance is opened, with no explanation of what was found.</li><li>Cash-only payment with no invoice.</li><li>A call centre that cannot name the technician who will arrive or the company''s local address.</li></ul>
<h2>How to get the best outcome from the visit</h2>
<ul><li>Have the model and serial number ready; it is usually inside the door or behind the kick panel.</li><li>Clear access to the appliance and protect the floor.</li><li>Describe the symptom precisely: when it starts, what it sounds like, what changed.</li><li>Ask the technician to show you the failed part and explain the diagnosis.</li><li>Keep the invoice, the warranty terms and any part numbers for future reference.</li></ul>
<h2>A short checklist before you say yes</h2>
<p>Business name and address confirmed, insurance checked, diagnostic fee policy understood, written price received, parts policy and warranty terms in hand. If any of those is missing, you are not being difficult — you are doing what the company should expect.</p>
<h2>Frequently asked questions</h2>
<h3>Should I use a manufacturer-authorised repair service?</h3><p>If the appliance is under warranty, yes — authorised service is usually required to keep the warranty valid, and it is often free. Out of warranty, authorisation still means access to current parts and documentation, but a well-reviewed independent technician can be equally good and sometimes quicker.</p>
<h3>Is a diagnostic fee normal?</h3><p>Yes. Travel and fault-finding are real work, and a fee is reasonable. What matters is that the policy is stated up front and, ideally, credited against the repair if you approve it.</p>
<h3>How long should an appliance repair warranty last?</h3><p>Common terms are 90 days to one year on parts and 30 to 90 days on labour. Anything shorter than 30 days deserves a question; anything longer than a year on labour is unusual and worth reading carefully.</p>
<h3>Can I get a repair quote over the phone?</h3><p>You can usually get a range, not a quote. Exact pricing needs the model number and often a diagnosis. Be wary of a firm price quoted before anyone knows what is wrong — it tends to be revised upward once the appliance is open.</p>
<h2>Where to go next</h2><ul><li><a href="/services">Browse home service categories</a></li><li><a href="/blog/common-appliance-problems-when-to-call-a-repair-professional">Common appliance problems and when to call a pro</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/how-to-choose-a-reliable-appliance-repair-service.svg', 'Illustration of a homeowner comparing two repair quotes on a clipboard beside a washing machine',
       'How to Choose a Reliable Appliance Repair Service', 'What separates a good appliance repair company from a bad one: licensing, diagnostic fees, parts policy, warranty terms and the questions worth asking.', 'Hiring checklist for appliance repair: credentials, fee structures, warranty terms, red flags.',
       'appliance repair service', 'reliable appliance repair, appliance repair near me, appliance repair company, professional appliance technician, appliance repair estimate, appliance repair warranty',
       NULL, 0, '/images/blog/how-to-choose-a-reliable-appliance-repair-service.svg', 'Safe Home Network Editorial',
       '2026-10-26 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'appliance-repair'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service' AND t.slug = 'hiring';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service' AND t.slug = 'appliance-repair';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service' AND t.slug = 'quotes';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service' AND t.slug = 'consumer-protection';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners about to hire an appliance repair company and comparing local options.' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '1066 words' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'Browse home service categories' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/common-appliance-problems-when-to-call-a-repair-professional
/blog/questions-to-ask-before-hiring-a-home-service-professional
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector: homeowner with clipboard comparing two quotes, washing machine and fridge icons, checkmarks.' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-reliable-appliance-repair-service'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 04. Warning Signs Your Home May Have Electrical Problems
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'warning-signs-your-home-may-have-electrical-problems', 'Warning Signs Your Home May Have Electrical Problems', c.id, 'published',
       'Most house fires of electrical origin start with a symptom someone noticed and dismissed. These eight signs are the ones worth acting on — and three need attention today.', '<p>Electrical faults are unusual among home problems because the early warning is often sensory rather than visible: a warmth you notice when plugging something in, a buzz you hear near the panel, a light that dims when the dryer starts. Those are the moments when an electrician is inexpensive and a fire is not.</p>
<p>This guide lists the signs homeowners report most often, what each usually means, and how quickly it should be looked at. It deliberately does not explain how to open a panel, replace a breaker or re-terminate a cable — those are licensed work for good reasons.</p>
<h2>Signs that need attention today</h2>
<h3>3. Buzzing or crackling at the panel</h3>
<p>Breakers can hum faintly; they should not buzz, crackle or feel hot. Crackling inside a panel is arcing, and arcing generates heat. This is a same-day call. Do not open the panel cover yourself.</p>
<h2>Signs to schedule within a week or two</h2>
<h3>6. Two-prong outlets and missing GFCIs</h3>
<p>Ungrounded two-prong receptacles in kitchens, bathrooms, laundry rooms, garages and outdoors are both a shock risk and a code problem. So is the absence of ground-fault protection in wet areas. Upgrading is not glamorous work, but it is among the highest-value safety improvements in an older home.</p>
<h2>Signs that point at age and capacity</h2>
<h3>8. Insufficient outlets and constant extension cords</h3>
<p>A house that runs on daisy-chained power strips is a house with a capacity problem. Extension cords are for temporary use; used permanently, especially under rugs or through doorways, they overheat. The durable answer is additional circuits — not more strips.</p>
<h2>What is usually harmless</h2>
<ul><li>A faint click from a switch — mechanical, normal.</li><li>A single LED bulb flickering on a dimmer that is not LED-rated — swap the dimmer or the bulb.</li><li>A GFCI that trips when a hair dryer is used in the bathroom — the device is doing its job; if it trips with nothing plugged in, investigate.</li><li>A brief dim when the air conditioner starts — normal on many services, but worth mentioning at the next electrical visit.</li></ul>
<h2>Why these warnings matter more than they seem</h2>
<p>The US Fire Administration attributes a substantial share of home fires to electrical distribution and lighting equipment, with arcing and loose connections among the common mechanisms. The pattern is consistent: a small, ignorable symptom precedes most of them.</p>
<p>Adding arc-fault circuit interrupters (AFCIs) and ground-fault protection where the code requires them is the structural fix. Smoke alarms that actually work are the backstop. Neither substitutes for the other.</p>
<h2>What to do while you wait for the electrician</h2>
<ol><li>Stop using the affected circuit; unplug appliances on it.</li><li>Switch the circuit off at the breaker if you can reach the panel safely.</li><li>Do not open outlets, switches or the panel cover.</li><li>Keep anything flammable away from the area and make sure a smoke alarm is working nearby.</li><li>If you see smoke, flames or smell burning and cannot isolate the circuit, leave the building and call the fire service.</li></ol>
<h2>Frequently asked questions</h2>
<h3>How do I know if flickering lights are dangerous?</h3><p>If one lamp flickers, suspect the bulb, socket or dimmer. If lights across several rooms dim together — especially when a large appliance starts — that points to the service or a connection problem and deserves a professional inspection.</p>
<h3>Is it normal for an outlet cover to feel slightly warm?</h3><p>No. A cover plate should not be noticeably warm. Warmth suggests resistance from a loose connection or an overloaded circuit, both of which are fire risks over time. Have it checked rather than continuing to use that outlet.</p>
<h3>Can I replace a breaker myself?</h3><p>In most US jurisdictions, no — replacing or adding breakers, and any work inside the panel, is licensed electrical work. Beyond the legal question, the panel remains live with the main breaker on, and a mistake can be fatal.</p>
<h3>My house has two-prong outlets. Do they have to be replaced?</h3><p>They are not automatically illegal to keep, but they offer no equipment ground and are a shock risk. In wet areas they are a clear problem. An electrician can explain the realistic options — grounding, GFCI protection, or a partial rewire — and the cost of each.</p>
<h2>Where to go next</h2><ul><li><a href="/services/electrical">See electrical service options</a></li><li><a href="/blog/when-should-you-hire-a-licensed-electrician">When should you hire a licensed electrician?</a></li><li><a href="/blog/common-causes-of-circuit-breaker-trips">Common causes of circuit breaker trips</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/warning-signs-your-home-may-have-electrical-problems.svg', 'Illustration of a homeowner noticing a warm wall outlet with a subtle warning indicator on a home electrical panel',
       '8 Warning Signs of Electrical Problems in a House', 'Warm outlets, buzzing panels, flickering lights and burning smells: what each electrical warning sign usually means and which ones need same-day attention.', 'Symptom-by-symptom electrical safety guide with urgency ratings.',
       'electrical problems in house', 'electrical warning signs, flickering lights cause, warm outlet cover, burning smell electrical, house electrical safety, when to call electrician',
       NULL, 0, '/images/blog/warning-signs-your-home-may-have-electrical-problems.svg', 'Safe Home Network Editorial',
       '2026-10-27 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'electrical'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems' AND t.slug = 'electrical-safety';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems' AND t.slug = 'fire-prevention';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems' AND t.slug = 'diagnostics';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems' AND t.slug = 'safety';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners noticing odd electrical behaviour and unsure whether it is normal or urgent.' FROM blog_posts b WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '772 words' FROM blog_posts b WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See electrical service options' FROM blog_posts b WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/when-should-you-hire-a-licensed-electrician
/blog/common-causes-of-circuit-breaker-trips' FROM blog_posts b WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector: wall outlet with heat waves, hand reaching for it, panel in background with a caution badge.' FROM blog_posts b WHERE b.slug = 'warning-signs-your-home-may-have-electrical-problems'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 05. When Should You Hire a Licensed Electrician?
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'when-should-you-hire-a-licensed-electrician', 'When Should You Hire a Licensed Electrician?', c.id, 'published',
       'Some electrical work is a straightforward swap; the rest is licensed work for legal and safety reasons. Here is where the line sits, and how to check a licence properly.', '<p>"Do I need an electrician for this?" is usually asked in one of two situations: the job looks small, or the job looks expensive. Both deserve an honest answer, because the legal line and the safety line are not always in the same place.</p>
<p>Here is the practical version. It describes what is generally allowed for homeowners, what almost always requires a licensed electrician, and how to verify a licence rather than take it on trust. Local rules vary — the AHJ (authority having jurisdiction) is your city or county building department, and their answer wins.</p>
<h2>Jobs that almost always require a licence</h2>
<ul><li>Anything inside the electrical panel: adding, replacing or moving breakers, or upgrading the service.</li><li>New circuits, new outlets, or extending an existing circuit into another room.</li><li>Kitchen, bathroom and outdoor circuits where GFCI protection and code details apply.</li><li>Replacing or adding hardwired equipment — water heaters, EV chargers, ranges, dryers, HVAC disconnects.</li><li>Rewiring, aluminum branch-circuit remediation, and knob-and-tube or cloth-wiring replacement.</li><li>Grounding and bonding work, including upgrading a service ground.</li><li>Anything requiring a permit, which in most jurisdictions means most of the above.</li></ul>
<blockquote><p>Even where a homeowner is legally permitted to do their own electrical work, an insurer may treat unpermitted work differently after a fire. That asymmetry is worth considering before deciding to save a few hundred dollars.</p></blockquote>
<h2>Jobs a homeowner can generally do</h2>
<p>If the job needs the circuit isolated at the panel and a device removed from the wall, you have crossed into work that most jurisdictions restrict and that carries real shock and fire risk.</p>
<ul><li>Replacing a lamp, a bulb or a plug-in fixture that hangs from an existing outlet.</li><li>Swapping a light switch or receptacle cover — the cover only, not the device behind it.</li><li>Resetting a tripped breaker once and identifying which circuit it protects.</li><li>Replacing a plug-in smoke detector, or testing and vacuuming existing alarms.</li><li>Installing a smart plug, a plug-in timer or a battery-powered doorbell.</li></ul>
<h2>What a licence and a permit actually protect</h2>
<figure class="article-table"><table><thead><tr><th>Safeguard</th><th>What it covers</th><th>What it does not cover</th></tr></thead><tbody><tr><td>Licence</td><td>Minimum training and code knowledge; a complaint route through the state board</td><td>The quality of a specific job</td></tr><tr><td>Permit</td><td>Independent inspection of the work against the adopted code</td><td>Design choices, or work not described on the permit</td></tr><tr><td>Insurance</td><td>Damage to your property, and injuries to workers</td><td>Poor workmanship itself</td></tr><tr><td>Written contract</td><td>Scope, price, schedule, warranty</td><td>Anything not written down</td></tr></tbody></table></figure>
<h2>How to verify an electrician in five minutes</h2>
<ol><li>Ask for the licence number and the name it is issued to.</li><li>Look the number up on your state''s licensing board website — most publish a searchable register.</li><li>Confirm the licence class covers residential work and is current, not expired or suspended.</li><li>Ask for the certificate of insurance and check the dates.</li><li>Ask who will pull the permit; the answer should be the contractor, in their name.</li></ol>
<h2>Why "the handyman can do it cheaper" is often a false economy</h2>
<p>A handyman doing electrical work without a licence is doing work that may not be inspected, may not be insured, and may not be legal. If something goes wrong later, the homeowner is typically the one holding the problem — with an insurer asking for the permit and an inspector asking who did the work.</p>
<p>Where a handyman genuinely helps is everything adjacent to the electrical job: patching drywall after a rewire, painting, mounting a TV on a wall with an existing outlet. Splitting the work that way is both legal and cheaper.</p>
<h2>Signals that a quote is too good</h2>
<ul><li>A price far below two other quotes with no explanation of difference in scope.</li><li>Reluctance to put the scope in writing, or to name the permit.</li><li>No business address, no licence number, and a request for cash.</li><li>"We do not need a permit for that" — sometimes true, often not; the building department decides, not the contractor.</li></ul>
<h2>Questions worth asking every electrician</h2>
<ol><li>Is this job permitted, and who pulls the permit?</li><li>Will the work be inspected, and will you send me the inspection result?</li><li>What is included — materials, patching, cleanup, disposal?</li><li>What warranty do you offer on labour, and for how long?</li><li>Will the same electrician who quoted do the work?</li><li>What happens if the inspection finds something else?</li></ol>
<h2>Frequently asked questions</h2>
<h3>Can I replace a light switch myself?</h3><p>In many jurisdictions a homeowner may replace a like-for-like switch in their own home, but the circuit must be isolated at the panel and the wiring must be correct. If you are unsure how to confirm the power is off, or the box contains aluminum wiring or more wires than the switch needs, stop and hire an electrician.</p>
<h3>Do small electrical jobs need a permit?</h3><p>It depends on the jurisdiction and the job. Replacing a fixture often does not; adding a circuit, an outlet or a hardwired appliance usually does. Call your local building department and ask — they answer this question all day and the answer is free.</p>
<h3>What happens if I sell a house with unpermitted electrical work?</h3><p>A home inspector may flag it, a buyer''s lender may require correction, and an insurer may refuse to cover related damage. The cleanest path is to have the work permitted and inspected, even retroactively where the jurisdiction allows it.</p>
<h3>Is a licensed electrician always more expensive?</h3><p>The hourly rate is usually higher than a handyman''s, but the job is done once, inspected, insured and warrantied. For anything beyond swapping a fixture, the total cost of doing it twice — or of an insurance denial — is the more useful comparison.</p>
<h2>Where to go next</h2><ul><li><a href="/services/electrical">See electrical service options</a></li><li><a href="/blog/warning-signs-your-home-may-have-electrical-problems">Warning signs your home may have electrical problems</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/when-should-you-hire-a-licensed-electrician.svg', 'Illustration of a licensed electrician checking a residential panel while a homeowner reviews a permit document',
       'When Should You Hire a Licensed Electrician?', 'Which electrical jobs legally and practically require a licensed electrician, what a licence and permit actually protect you from, and how to verify both.', 'Decision guide: DIY vs handyman vs licensed electrician, with licence and permit verification steps.',
       'licensed electrician', 'when to hire an electrician, electrician near me, licensed electrician requirements, electrical permit, electrician vs handyman, electrical inspection',
       NULL, 0, '/images/blog/when-should-you-hire-a-licensed-electrician.svg', 'Safe Home Network Editorial',
       '2026-10-28 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'electrical'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'when-should-you-hire-a-licensed-electrician';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'when-should-you-hire-a-licensed-electrician' AND t.slug = 'hiring';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'when-should-you-hire-a-licensed-electrician' AND t.slug = 'electrical';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'when-should-you-hire-a-licensed-electrician' AND t.slug = 'permits';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'when-should-you-hire-a-licensed-electrician' AND t.slug = 'safety';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'when-should-you-hire-a-licensed-electrician'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners planning electrical work and deciding whether a handyman, a DIY approach or a licensed electrician is appropriate.' FROM blog_posts b WHERE b.slug = 'when-should-you-hire-a-licensed-electrician'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '1003 words' FROM blog_posts b WHERE b.slug = 'when-should-you-hire-a-licensed-electrician'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See electrical service options' FROM blog_posts b WHERE b.slug = 'when-should-you-hire-a-licensed-electrician'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/warning-signs-your-home-may-have-electrical-problems
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'when-should-you-hire-a-licensed-electrician'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector: electrician at a panel with a clipboard and licence badge, permit document on a table.' FROM blog_posts b WHERE b.slug = 'when-should-you-hire-a-licensed-electrician'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 06. Common Causes of Circuit Breaker Trips
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'common-causes-of-circuit-breaker-trips', 'Common Causes of Circuit Breaker Trips', c.id, 'published',
       'A breaker that trips is doing its job. The question is which of four faults it is protecting you from — and three of them need an electrician rather than a bigger breaker.', '<p>A tripping breaker is not a malfunction. It is a switch designed to open when current exceeds a safe level, and it is the reason a bad appliance becomes a nuisance instead of a fire.</p>
<p>The useful question is which of four conditions is opening it: an overload, a short circuit, a ground fault, or a breaker that has itself failed. Overloads are a homeowner problem. The other three need an electrician.</p>
<h2>1. Overload: too much on one circuit</h2>
<p>An overload happens when the total draw on a circuit exceeds its rating — a space heater and a hair dryer on the same 15-amp circuit, or a microwave and a kettle in an older kitchen. The breaker warms up and trips, sometimes after several minutes rather than instantly.</p>
<p>The clue is timing and correlation: it trips when specific appliances run together, and it stops tripping when one of them is moved to another circuit. That is a genuine fix, not a workaround, as long as the other circuit has capacity.</p>
<ul><li>Map the circuit: switch the breaker off and note every dead outlet and fixture.</li><li>Add up the watts of everything that was running (appliance labels list watts or amps).</li><li>Move one high-draw appliance to a different circuit, or run them at different times.</li><li>Avoid extension cords and multi-plugs as a permanent solution.</li></ul>
<h2>2. Short circuit: two conductors touching</h2>
<p>A short circuit bypasses the normal load, producing a very large current. The breaker trips immediately, often with a snap or a flash, sometimes with a burning smell. Causes include a damaged cord, a failed appliance, a pinched wire behind a wall, or a receptacle that has come apart internally.</p>
<p>Unplug the appliances on that circuit one at a time and try to reset. If the breaker holds with everything unplugged, the fault is in an appliance or a cord. If it trips with nothing plugged in, the wiring itself is faulty and the circuit should stay off until an electrician inspects it.</p>
<blockquote><p>Never keep resetting a breaker that trips instantly with a bang. Each attempt sends a fault current through the wiring and can start a fire inside a wall.</p></blockquote>
<h2>3. Ground fault: current leaking to earth</h2>
<p>A ground fault is current escaping to earth through moisture, damaged insulation or a faulty appliance. GFCI and AFCI breakers detect it and trip quickly — often the trip is what saves someone from a shock in a bathroom or kitchen.</p>
<p>If a GFCI trips repeatedly with a particular appliance, that appliance is the suspect: a kettle with a damp base, a hair dryer with a worn cord, a pump with a failing seal. Test the appliance on a different GFCI circuit before concluding the wiring is at fault.</p>
<h2>4. A failing breaker or connection</h2>
<p>Breakers wear out. A breaker that is warm to the touch, will not stay reset without any load, or trips at a load well below its rating is suspect. So is a breaker whose terminal has loosened — a loose connection creates heat, and heat nuisance-trips the device.</p>
<p>Diagnosing this requires the panel open while live, which is licensed work. It also explains why "just fit a bigger breaker" is dangerous advice: the breaker is sized to protect the wire, not the appliance.</p>
<h2>The reset procedure that tells you the most</h2>
<ol><li>Unplug or switch off everything on the affected circuit.</li><li>Push the breaker fully to OFF, then firmly to ON.</li><li>If it holds, plug devices back in one at a time until it trips — that device or its cord is the problem.</li><li>If it trips with nothing connected, leave it off and call an electrician.</li><li>If it trips as soon as you touch it, or the panel is warm or buzzing, stop and call an electrician immediately.</li></ol>
<h2>Why upsizing the breaker is never the answer</h2>
<figure class="article-table"><table><thead><tr><th>Approach</th><th>What actually happens</th></tr></thead><tbody><tr><td>Fit a larger breaker</td><td>The wire is now undersized for the protection; it overheats before the breaker trips</td></tr><tr><td>Replace the breaker with the same rating</td><td>Reasonable if the device has failed — but only after the cause is confirmed</td></tr><tr><td>Move appliances to other circuits</td><td>Fine for a genuine overload, provided those circuits have capacity</td></tr><tr><td>Add a dedicated circuit</td><td>The correct fix for a kitchen or laundry that is chronically overloaded</td></tr></tbody></table></figure>
<h2>When to call an electrician</h2>
<ul><li>The breaker trips immediately with nothing plugged in.</li><li>Any burning smell, scorch mark, buzzing or warm panel.</li><li>Repeated tripping after you have removed the obvious overload.</li><li>A GFCI or AFCI that will not reset.</li><li>An older panel with mismatched or double-tapped breakers.</li><li>Any work that requires the panel cover to come off.</li></ul>
<h2>Frequently asked questions</h2>
<h3>Is it safe to reset a tripped breaker?</h3><p>Resetting once after removing the load is normal and safe. Repeatedly resetting a breaker that trips immediately is not — each attempt pushes fault current through the circuit. If it will not hold with everything unplugged, leave it off and call an electrician.</p>
<h3>Why does my breaker trip only sometimes?</h3><p>Intermittent trips usually point to an overload that occurs when specific appliances coincide, or to a marginal connection that heats up under load. Note the time, what was running, and the weather — a pattern is diagnostic information for the electrician.</p>
<h3>Can a bad appliance trip the breaker without damaging it?</h3><p>Yes. A failing motor or a damaged heating element can draw excessive current and trip a healthy breaker. Test by unplugging that appliance and resetting; if the circuit holds, have the appliance looked at rather than the wiring.</p>
<h3>Should I replace an old breaker panel?</h3><p>Sometimes the panel is fine and only a breaker needs replacement; sometimes the panel is obsolete, has known failure modes, or has no capacity left. An electrician can assess it against current code and tell you which of those you are dealing with.</p>
<h2>Where to go next</h2><ul><li><a href="/services/electrical">See electrical service options</a></li><li><a href="/blog/warning-signs-your-home-may-have-electrical-problems">Warning signs your home may have electrical problems</a></li><li><a href="/blog/when-should-you-hire-a-licensed-electrician">When should you hire a licensed electrician?</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/common-causes-of-circuit-breaker-trips.svg', 'Illustration of a homeowner resetting a breaker in a panel with circuit diagrams shown alongside',
       'Why Your Circuit Breaker Keeps Tripping (and What to Do)', 'Overload, short circuit, ground fault or a failing breaker: how to tell which is tripping the circuit, what is safe to check, and when to call an electrician.', 'Four-cause breakdown of repeated breaker trips with safe isolation steps.',
       'circuit breaker keeps tripping', 'breaker trips repeatedly, why does my breaker keep tripping, overloaded circuit, short circuit, ground fault, AFCI GFCI tripping',
       NULL, 0, '/images/blog/common-causes-of-circuit-breaker-trips.svg', 'Safe Home Network Editorial',
       '2026-10-29 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'electrical'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'common-causes-of-circuit-breaker-trips';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-causes-of-circuit-breaker-trips' AND t.slug = 'electrical';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-causes-of-circuit-breaker-trips' AND t.slug = 'circuit-breakers';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-causes-of-circuit-breaker-trips' AND t.slug = 'diagnostics';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'common-causes-of-circuit-breaker-trips' AND t.slug = 'safety';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'common-causes-of-circuit-breaker-trips'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners whose breaker trips repeatedly and who want to understand whether it is an overload or a fault.' FROM blog_posts b WHERE b.slug = 'common-causes-of-circuit-breaker-trips'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '1042 words' FROM blog_posts b WHERE b.slug = 'common-causes-of-circuit-breaker-trips'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See electrical service options' FROM blog_posts b WHERE b.slug = 'common-causes-of-circuit-breaker-trips'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/warning-signs-your-home-may-have-electrical-problems
/blog/when-should-you-hire-a-licensed-electrician' FROM blog_posts b WHERE b.slug = 'common-causes-of-circuit-breaker-trips'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector: electrical panel with one breaker in the tripped position, icons for overload, short and ground fault.' FROM blog_posts b WHERE b.slug = 'common-causes-of-circuit-breaker-trips'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 07. Warning Signs You Need a Plumber (and the Ones You Cannot Ignore)
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'warning-signs-you-need-a-plumber', 'Warning Signs You Need a Plumber (and the Ones You Cannot Ignore)', c.id, 'published',
       'Most plumbing failures give you days of warning before they become an emergency. Here are the eight symptoms worth acting on, the two that cannot wait, and the checks that are safe to do yourself first.', '<p>Plumbing rarely fails without warning. A pipe that bursts on a Sunday night has usually been telling you something for weeks — a faint damp smell under the sink, a water bill that crept up, a drain that gurgles when the washing machine empties.</p>
<p>The value of noticing early is not just money. A supply line leak behind a cabinet can run for months inside a wall cavity before the paint blisters, and by then you are paying for drywall, insulation and possibly mold as well as a washer.</p>
<h2>1. A water bill that jumps without explanation</h2>
<p>Seasonal change explains some variation, but a bill that rises 20% or more with the same household habits usually means water is going somewhere it should not. Toilets are the most common culprit: a flapper that fails to seal can waste hundreds of liters a day while sounding like nothing at all.</p>
<p>Put a few drops of food coloring in the tank and leave it for fifteen minutes without flushing. Color in the bowl means the flapper is leaking and needs replacing — a five-minute job with a part that costs less than a coffee.</p>
<h2>2. Damp patches, musty smells and bubbling paint</h2>
<p>Water travels. A stain on a ceiling rarely sits directly under the leak; it sits under the lowest point the water reached. Look for the source uphill and above: a bathroom above, a roof penetration, a supply line running through the joist space.</p>
<p>A musty smell in a cabinet, a swollen skirting board or paint that bubbles rather than peels all point to slow, ongoing moisture. These are the failures that turn a plumbing bill into a restoration bill.</p>
<h2>3. Pressure that drops when something else runs</h2>
<p>A shower that loses half its flow when the kitchen tap opens is a symptom of a restriction, not of the shower. Common causes are a failing pressure-reducing valve, scale in an older galvanised line, or a partially closed isolation valve someone forgot to reopen after a repair.</p>
<p>If the drop is sudden and affects the whole house, check with a neighbor before calling anyone — a utility-side issue is not your repair.</p>
<h2>4. Drains that are slow in more than one place</h2>
<p>One slow sink is usually a local clog of hair, soap and grease. Two or more slow drains on the same floor, or gurgling from a floor drain when the washer empties, points to a blockage in the main line or a venting problem.</p>
<p>That distinction matters because chemical drain cleaners make main-line blockages worse: they do not clear the clog, they sit in the pipe and corrode it. A plumber with a camera and an auger solves in twenty minutes what a bottle cannot solve at all.</p>
<h2>5. Water where water should not be</h2>
<ul><li>A puddle under the water heater — the tank itself has failed and no repair will fix a rusted shell.</li><li>Water staining around the base of a toilet — a failed wax ring, which is cheap to fix now and expensive after the subfloor softens.</li><li>Green or white crust on copper or brass fittings — a slow weep that has been evaporating for months.</li><li>A washing machine supply hose that feels stiff or has a bubble — replace both hoses before they split, not after.</li></ul>
<h2>6. Noise: banging, hammering, whistling</h2>
<p>A single bang when a tap closes is water hammer, and it is fixable with an arrestor or a new valve. Repeated hammering, a shriek from a tap or a rattle in the wall when a toilet refills all suggest loose pipes or a worn valve washer.</p>
<p>Noise is rarely urgent on its own, but it is the cheapest stage to fix. Loose pipes chafe against joists and fittings, and a chafed pipe is a future leak.</p>
<h2>The two symptoms that cannot wait</h2>
<p>Water you can see running, or a smell of sewage inside the house, are same-day calls. Everything else can usually wait for a scheduled visit during working hours, which is also when you will get the best price.</p>
<blockquote><p>If water is running and you cannot find the isolation valve, turn off the main at the meter. Know where it is before you need it — it takes one minute today and saves a floor later.</p></blockquote>
<h2>What to do before the plumber arrives</h2>
<ol><li>Shut off the supply to the affected fixture, or the whole house if you cannot isolate it.</li><li>Photograph everything — the leak, the damage, the meter reading — before anything is moved.</li><li>Clear access to the fixture and to the main valve; cupboards full of cleaning products cost time.</li><li>Write down when the problem started and what changed just before it did.</li><li>If the water reached carpet or a ceiling, start drying and read our water damage first-24-hours guide.</li></ol>
<h2>Which plumbing jobs are genuinely DIY</h2>
<figure class="article-table"><table><thead><tr><th>Job</th><th>DIY or licensed</th><th>Why</th></tr></thead><tbody><tr><td>Replacing a toilet flapper or fill valve</td><td>DIY</td><td>No soldering, no gas, no permit; shut the supply first</td></tr><tr><td>Swapping a shower head or tap aerator</td><td>DIY</td><td>Threaded parts, hand-tight plus a quarter turn</td></tr><tr><td>Clearing a single sink trap</td><td>DIY</td><td>Bucket underneath, gloves, reassemble in reverse</td></tr><tr><td>Replacing a washing machine hose</td><td>DIY</td><td>Accessible, but buy braided stainless hoses</td></tr><tr><td>Anything inside a wall or under a slab</td><td>Licensed</td><td>Cutting into structure needs a permit in most jurisdictions</td></tr><tr><td>Gas lines, water heater swaps, main line repairs</td><td>Licensed</td><td>Legally restricted work with real safety consequences</td></tr></tbody></table></figure>
<h2>What a plumbing visit actually costs</h2>
<p>Most providers charge a call-out or diagnostic fee that is credited against the repair if you go ahead. Simple fixture repairs sit in the low hundreds; anything requiring access behind a wall or under a floor climbs quickly, and the access work — not the plumbing — is usually the expensive part.</p>
<p>Ask for the diagnostic fee, the hourly rate and the after-hours multiplier before booking, and ask whether the quote includes making good. Those three questions are the difference between two quotes that look similar and two that are not comparable at all.</p>
<h2>Frequently asked questions</h2>
<h3>How do I know if a leak is an emergency?</h3><p>If water is actively running, if it is near electrical fittings, or if it has reached a ceiling or a floor above another room, treat it as an emergency: shut off the supply and call. A slow drip into a bucket is not an emergency, but it should not be left for weeks.</p>
<h3>Can I use chemical drain cleaner on a slow drain?</h3><p>For a single slow sink, a plunger or a manual snake is safer and just as effective. Chemical cleaners are harsh on older pipework and can cause injury if a plumber later opens the drain. For multiple slow drains, skip chemicals entirely and have the main line looked at.</p>
<h3>Is a dripping tap really worth fixing?</h3><p>Yes. A tap dripping once a second wastes thousands of liters a year and the washer usually costs very little. It also keeps the drain wet, which shortens the life of the trap and can stain the basin.</p>
<h3>What should I check before calling a plumber about low pressure?</h3><p>Check whether the drop affects the whole house or one fixture, look for a partly closed isolation valve, clean the aerator on the affected tap, and ask a neighbor whether they have the same problem. Those four checks tell a plumber a lot before the visit.</p>
<h2>Where to go next</h2><ul><li><a href="/services/plumbing">See plumbing service options</a></li><li><a href="/blog/water-heater-problems-repair-or-replace">Water heater problems: repair or replace?</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li><li><a href="/blog/first-24-hours-after-water-damage">The first 24 hours after water damage</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/warning-signs-you-need-a-plumber.svg', 'Illustration of a kitchen faucet with a drip, a pressure gauge and a wrench',
       '8 Warning Signs You Need a Plumber', 'Dripping taps, rising bills, banging pipes and slow drains: the eight plumbing symptoms worth acting on, which are urgent, and what to check first.', 'Symptom-led guide to household plumbing problems with an urgency ranking and pre-visit checklist.',
       'signs you need a plumber', 'plumber near me, when to call a plumber, emergency plumber, water leak signs, low water pressure, plumbing repair cost',
       NULL, 0, '/images/blog/warning-signs-you-need-a-plumber.svg', 'Safe Home Network Editorial',
       '2026-10-30 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'plumbing'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'warning-signs-you-need-a-plumber';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-you-need-a-plumber' AND t.slug = 'plumbing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-you-need-a-plumber' AND t.slug = 'leaks';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-you-need-a-plumber' AND t.slug = 'diagnostics';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'warning-signs-you-need-a-plumber' AND t.slug = 'prevention';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'warning-signs-you-need-a-plumber'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners noticing a plumbing symptom they are not sure is urgent, and renters who need to describe the problem clearly to a landlord.' FROM blog_posts b WHERE b.slug = 'warning-signs-you-need-a-plumber'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '1306 words' FROM blog_posts b WHERE b.slug = 'warning-signs-you-need-a-plumber'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See plumbing service options' FROM blog_posts b WHERE b.slug = 'warning-signs-you-need-a-plumber'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/water-heater-problems-repair-or-replace
/blog/how-to-compare-home-service-estimates
/blog/first-24-hours-after-water-damage' FROM blog_posts b WHERE b.slug = 'warning-signs-you-need-a-plumber'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a chrome faucet with a drip, a pressure gauge chip and a wrench chip on a warm sand background.' FROM blog_posts b WHERE b.slug = 'warning-signs-you-need-a-plumber'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 08. Water Heater Problems: Repair or Replace?
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'water-heater-problems-repair-or-replace', 'Water Heater Problems: Repair or Replace?', c.id, 'published',
       'A water heater usually fails in a way that answers the repair-or-replace question for you. The trick is recognising which symptom you are looking at before you pay for a visit.', '<p>A water heater is one of the few appliances in a home that fails in a way that gives you a clear answer. A leaking tank is finished. A failed element is a repair. Between those two extremes sit the decisions homeowners actually agonise over: an eleven-year-old tank that still works but costs more to run, or a pilot that keeps going out.</p>
<p>The framework below is about turning symptoms into a decision instead of a guess.</p>
<h2>First, identify what kind of unit you have</h2>
<p>Tank, tankless, heat pump or indirect — each has different failure modes and different economics. A tank unit is expected to last around 8–12 years; a tankless unit can run 20 with annual descaling. Knowing the type and the install date matters more than the brand.</p>
<p>If you cannot read the label, the serial number usually encodes the manufacture date. Photograph the label before any technician arrives; it is the first thing they will ask for.</p>
<h2>Symptoms that mean replace, not repair</h2>
<ul><li>Water on the floor from the tank body itself — the steel has corroded through and no liner repair is a real fix.</li><li>A tank that is 10+ years old and now leaking from any point, including the drain valve area.</li><li>Repeated element or thermostat failures in the same year — usually a sign of scale build-up and a tank near the end.</li><li>Rust-colored hot water that continues after flushing the tank and replacing the anode rod.</li><li>A flue that is corroded or a unit that has been back-vented incorrectly.</li></ul>
<h2>Symptoms that are usually a repair</h2>
<figure class="article-table"><table><thead><tr><th>Symptom</th><th>Likely cause</th><th>Typical fix</th></tr></thead><tbody><tr><td>No hot water, breaker fine</td><td>Failed heating element (electric)</td><td>Element swap after testing</td></tr><tr><td>Hot water runs out quickly</td><td>Failed lower element or heavy sediment</td><td>Element or full flush</td></tr><tr><td>Water too hot or scalding</td><td>Thermostat or mixing valve</td><td>Thermostat or valve replacement</td></tr><tr><td>Pilot will not stay lit (gas)</td><td>Thermocouple, flame sensor or venting</td><td>Sensor replacement — gas work, licensed</td></tr><tr><td>Rotten-egg smell</td><td>Bacteria in the anode/water</td><td>Anode replacement and flush</td></tr><tr><td>Ticking or popping sounds</td><td>Sediment boiling under the burner</td><td>Flush; if it returns, plan replacement</td></tr></tbody></table></figure>
<h2>The age-and-cost rule that actually holds</h2>
<p>A common rule in the trade: if the unit is more than halfway through its expected life and the repair costs more than about a third of a replacement, replace it. A $600 repair on a nine-year-old tank buys you a few more years at best, and the next failure usually arrives during a cold snap.</p>
<p>The rule is not a law. If you are selling the house in six months, a repair may be the rational choice. If you are staying, the efficiency gain from a modern unit is itself part of the return.</p>
<blockquote><p>Ask the technician for the measured condition, not just the verdict: tank age, anode condition, sediment level, and whether the relief valve still opens. Those four facts make the decision much less of a sales conversation.</p></blockquote>
<h2>Replacement: what changes the price</h2>
<ol><li>Capacity and recovery rate — a larger tank or a faster recovery unit costs more.</li><li>Fuel type and venting — a gas replacement must match the existing flue or the venting work adds real money.</li><li>Location — a basement or garage swap is straightforward; a closet or attic unit needs code-compliant clearances and often a pan and drain.</li><li>Permits and inspection — most jurisdictions require a permit for a water heater swap, and skipping it can surface at resale.</li><li>Efficiency upgrades — a heat pump water heater costs more upfront and needs space and condensate drainage, but cuts running costs substantially.</li></ol>
<h2>Do not skip the maintenance that prevents this</h2>
<p>Flushing the tank once a year removes the sediment thatshortens element life and causes popping. Checking the anode rod every few years — and replacing it before it is consumed — is the single cheapest way to extend a tank''s life.</p>
<p>Test the temperature and pressure relief valve annually by lifting the lever and letting it snap back. A valve that weeps or will not reseat is a safety device that has failed, and it should be replaced rather than ignored.</p>
<h2>Frequently asked questions</h2>
<h3>How long does a water heater last?</h3><p>Tank units typically last 8–12 years; tankless units 15–20 with annual descaling. Hard water, high usage and a neglected anode rod shorten those numbers considerably.</p>
<h3>Can a leaking water heater be repaired?</h3><p>If the leak is from a fitting, the drain valve or the relief valve, yes. If water is coming through the tank shell or from the base, no — the steel has failed and the unit needs replacing.</p>
<h3>Is it worth replacing a working water heater?</h3><p>Rarely on its own. It becomes worth considering when the unit is near the end of its life, energy costs have risen sharply, or you are already doing adjacent work such as a basement remodel.</p>
<h3>Should I switch to tankless when replacing?</h3><p>Tankless suits homes with gas supply, space constraints and moderate simultaneous demand. It needs a larger gas line and proper venting in most retrofits, so get a quote that includes those items rather than comparing unit prices alone.</p>
<h2>Where to go next</h2><ul><li><a href="/services/plumbing">See plumbing service options</a></li><li><a href="/blog/warning-signs-you-need-a-plumber">Warning signs you need a plumber</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/water-heater-problems-repair-or-replace.svg', 'Illustration of a tank water heater with a temperature gauge and a coin icon',
       'Water Heater: Repair or Replace? A Decision Guide', 'Tank age, leak location and rising energy bills decide most water heater questions. Here is how to tell a repair from a replacement, and what each one costs.', 'Decision framework for failing water heaters: symptom, age and cost thresholds.',
       'water heater repair or replace', 'water heater not working, no hot water, water heater leaking, water heater lifespan, tankless water heater, water heater replacement cost',
       NULL, 0, '/images/blog/water-heater-problems-repair-or-replace.svg', 'Safe Home Network Editorial',
       '2026-10-31 13:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'plumbing'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'water-heater-problems-repair-or-replace';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'water-heater-problems-repair-or-replace' AND t.slug = 'plumbing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'water-heater-problems-repair-or-replace' AND t.slug = 'water-heaters';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'water-heater-problems-repair-or-replace' AND t.slug = 'repair-or-replace';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'water-heater-problems-repair-or-replace' AND t.slug = 'energy';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'water-heater-problems-repair-or-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with a failing tank water heater who need to decide between a repair visit and a replacement quote.' FROM blog_posts b WHERE b.slug = 'water-heater-problems-repair-or-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '922 words' FROM blog_posts b WHERE b.slug = 'water-heater-problems-repair-or-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See plumbing service options' FROM blog_posts b WHERE b.slug = 'water-heater-problems-repair-or-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/warning-signs-you-need-a-plumber
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'water-heater-problems-repair-or-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a tall tank water heater with a dial, a gauge chip, a clock chip and a coin chip.' FROM blog_posts b WHERE b.slug = 'water-heater-problems-repair-or-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 09. Air Conditioner Not Cooling? A Homeowner Troubleshooting Guide
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'ac-not-cooling-troubleshooting-guide', 'Air Conditioner Not Cooling? A Homeowner Troubleshooting Guide', c.id, 'published',
       'An air conditioner that runs but does not cool is usually failing at one of five points. Three of them you can check in ten minutes without tools — and one of them can freeze the coil if you ignore it.', '<p>The most common air conditioning call is not a broken system. It is a system that is working hard against something — a filter packed solid, a thermostat set to fan, a condenser unit boxed in by shrubs, or a coil that has frozen into a block of ice because the airflow is restricted.</p>
<p>Work through the checks below in order. Each one rules out a whole category of fault, and the list ends at the point where the next step needs gauges and refrigerant handling that belong with a licensed technician.</p>
<h2>1. Confirm the thermostat is actually calling for cooling</h2>
<p>Set the thermostat several degrees below room temperature, set the mode to cool rather than auto or fan, and wait five minutes. If the indoor unit runs but the outdoor unit never starts, the problem may be a tripped breaker, a float switch or a control fault rather than the compressor.</p>
<p>Smart thermostats add their own layer: check the app for a schedule override, a demand-response event or a filter reminder that has paused the system.</p>
<h2>2. Change the filter — and check the return</h2>
<p>A clogged filter is the single most common cause of poor cooling, and it is also the one that causes the most expensive damage. Restricted airflow drops the coil temperature until it ices over, and an iced coil cools almost nothing while the compressor runs continuously.</p>
<p>Check the filter every month during cooling season if you have pets or live somewhere dusty, and replace it every one to three months. Confirm that return grilles are not covered by rugs or furniture.</p>
<blockquote><p>If you can see ice on the indoor coil or the refrigerant line, switch the system to fan only — not off — and let the ice melt before running it again. Running a frozen coil can damage the compressor.</p></blockquote>
<h2>3. Look at the outdoor unit</h2>
<ul><li>Is the fan turning? A stopped fan with a humming compressor is a capacitor or motor fault.</li><li>Is the coil clear? Leaves, grass clippings and dryer lint block heat transfer.</li><li>Is there at least two feet of clear space around it? Shrubs and fencing choke the airflow.</li><li>Is the disconnect switch on? Someone doing yard work may have pulled it.</li><li>Check the breaker at the panel: a dedicated AC breaker that has tripped is common after a heatwave.</li></ul>
<h2>4. Check the condensate drain</h2>
<p>A working air conditioner pulls liters of water out of the air every day. If the condensate line clogs, many systems have a float switch that shuts the unit down to prevent a flood — which presents as an AC that will not start at all.</p>
<p>Look for water in the drain pan or a line that has stopped dripping. Flushing the drain with a cup of vinegar a few times a season prevents most of these calls.</p>
<h2>5. Measure the temperature split</h2>
<p>With the system running steadily for fifteen minutes, measure the air at a return grille and at a supply register. A healthy system delivers air 8–11°C (15–20°F) cooler than the return. Much less than that points to low refrigerant, a dirty coil or a duct problem — none of which are homeowner fixes.</p>
<p>This single measurement is the most useful thing you can bring to a technician, because it separates an airflow problem from a refrigeration problem.</p>
<h2>What is never a homeowner job</h2>
<figure class="article-table"><table><thead><tr><th>Task</th><th>Why it belongs with a licensed technician</th></tr></thead><tbody><tr><td>Adding refrigerant</td><td>Requires recovery equipment, gauges and a leak diagnosis; venting refrigerant is illegal</td></tr><tr><td>Cleaning the indoor coil</td><td>Involves opening the plenum and often a drain pan that can overflow</td></tr><tr><td>Electrical diagnosis inside the unit</td><td>Capacitors hold a lethal charge after power is off</td></tr><tr><td>Duct sealing and sizing</td><td>Affects static pressure; poor fixes make cooling worse</td></tr><tr><td>Compressor or motor replacement</td><td>Refrigerant circuit work plus a warranty question</td></tr></tbody></table></figure>
<h2>When it is worth replacing rather than repairing</h2>
<p>Repair makes sense while the system is under about ten years old and the fault is a component — a capacitor, a contactor, a blower motor. Past 12–15 years, a refrigerant leak or a compressor failure usually tips the balance toward replacement, especially if the unit still uses an older refrigerant that is being phased down.</p>
<p>Ask for a written comparison: the repair cost, the age of the system, the expected remaining life and the efficiency of a replacement. A technician who cannot or will not put those numbers in writing is selling, not advising.</p>
<h2>Frequently asked questions</h2>
<h3>Why is my AC running but blowing warm air?</h3><p>The usual causes are a clogged filter, a frozen indoor coil, a thermostat set to fan, or low refrigerant from a leak. Check the filter and look for ice first — both are visible without tools.</p>
<h3>How often should an air conditioner be serviced?</h3><p>Once a year before cooling season. A service should include coil cleaning, a refrigerant charge check, electrical inspection, condensate drain flushing and a filter change.</p>
<h3>Is it normal for the outdoor unit to run constantly on a hot day?</h3><p>Long run times are normal in extreme heat, particularly for a correctly sized unit. Constant running with poor cooling is not — that combination points to airflow or refrigerant problems.</p>
<h3>Can I just add refrigerant myself with a kit?</h3><p>No. Refrigerant is a regulated substance, systems must be charged by weight against measured pressures and temperatures, and adding refrigerant without finding the leak simply delays the same failure.</p>
<h2>Where to go next</h2><ul><li><a href="/services/hvac">See HVAC service options</a></li><li><a href="/blog/furnace-maintenance-checklist">A yearly furnace maintenance checklist</a></li><li><a href="/blog/when-should-you-hire-a-licensed-electrician">When should you hire a licensed electrician?</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/ac-not-cooling-troubleshooting-guide.svg', 'Illustration of a wall-mounted air conditioner beside a sun and a gauge',
       'AC Not Cooling? 7 Things to Check Before You Call', 'If your air conditioner runs but the house stays warm, start with the filter, the thermostat, the outdoor unit and the coil — in that order.', 'Step-by-step AC troubleshooting ladder from thermostat to refrigerant, with a safety line.',
       'air conditioner not cooling', 'AC blowing warm air, air conditioner troubleshooting, AC frozen coil, AC not cooling house, hvac repair near me, air conditioner maintenance',
       NULL, 0, '/images/blog/ac-not-cooling-troubleshooting-guide.svg', 'Safe Home Network Editorial',
       '2026-11-01 14:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'hvac'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'ac-not-cooling-troubleshooting-guide';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'ac-not-cooling-troubleshooting-guide' AND t.slug = 'hvac';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'ac-not-cooling-troubleshooting-guide' AND t.slug = 'air-conditioning';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'ac-not-cooling-troubleshooting-guide' AND t.slug = 'diagnostics';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'ac-not-cooling-troubleshooting-guide' AND t.slug = 'maintenance';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'ac-not-cooling-troubleshooting-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners whose air conditioner runs but does not cool the house, looking for checks to try before booking a technician.' FROM blog_posts b WHERE b.slug = 'ac-not-cooling-troubleshooting-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '980 words' FROM blog_posts b WHERE b.slug = 'ac-not-cooling-troubleshooting-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See HVAC service options' FROM blog_posts b WHERE b.slug = 'ac-not-cooling-troubleshooting-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/furnace-maintenance-checklist
/blog/when-should-you-hire-a-licensed-electrician
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'ac-not-cooling-troubleshooting-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a wall air conditioning unit with a sun chip, a gauge chip and a check chip on a cream background.' FROM blog_posts b WHERE b.slug = 'ac-not-cooling-troubleshooting-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 10. A Yearly Furnace Maintenance Checklist
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'furnace-maintenance-checklist', 'A Yearly Furnace Maintenance Checklist', c.id, 'published',
       'Most winter heating failures are predictable: a filter nobody changed, a flame sensor nobody cleaned, a vent nobody inspected. This checklist covers what to do monthly, yearly and never.', '<p>A furnace is a simple machine with a few parts that matter: a filter, a blower, a burner or element, a flame sensor and a heat exchanger. Almost every winter breakdown traces back to one of them being neglected rather than to a manufacturing fault.</p>
<p>The checklist below separates what you can do yourself, what an annual service should cover, and the handful of symptoms that mean shut it down and call someone today.</p>
<h2>Monthly: the five-minute routine</h2>
<ol><li>Change or clean the filter. This is the highest-value task on the list and the most skipped.</li><li>Check that return and supply vents are open and unobstructed.</li><li>Look at the condensate line on a high-efficiency unit and make sure it is draining.</li><li>Clear the area around the furnace — paint cans, boxes and anything flammable should not live there.</li><li>Listen at startup: a boom, a rattle or a whistle is worth noting before it becomes a no-heat call.</li></ol>
<h2>Before the heating season starts</h2>
<p>Book the annual service in early fall, before the first cold snap fills every technician''s calendar. Test the heat on a mild day so a failure surfaces while the house is still comfortable and a repair can be scheduled normally.</p>
<p>Replace the batteries in carbon monoxide and smoke alarms, and confirm there is an alarm on every level of the home and outside sleeping areas.</p>
<blockquote><p>If you smell gas, do not test anything. Leave the building, do not switch lights or appliances on or off, and call the gas emergency line from outside.</p></blockquote>
<h2>What a proper annual service includes</h2>
<figure class="article-table"><table><thead><tr><th>Check</th><th>Why it matters</th></tr></thead><tbody><tr><td>Combustion analysis</td><td>Confirms the burner is burning cleanly and not producing excess CO</td></tr><tr><td>Heat exchanger inspection</td><td>A cracked exchanger can leak combustion gases into the supply air</td></tr><tr><td>Flame sensor and igniter cleaning</td><td>The most common cause of intermittent no-heat</td></tr><tr><td>Blower motor inspection and lubrication</td><td>Worn bearings draw more current and eventually seize</td></tr><tr><td>Vent and flue inspection</td><td>Blocked or back-sloped vents are a carbon monoxide risk</td></tr><tr><td>Gas pressure and manifold check</td><td>Out-of-spec pressure soots the exchanger and wastes fuel</td></tr><tr><td>Thermostat calibration and safeties test</td><td>Confirms limit switches and rollout sensors still trip</td></tr></tbody></table></figure>
<h2>The filters that are not filters</h2>
<p>A one-inch fibreglass filter protects the blower; it does not clean the air in any meaningful way. If someone in the house has allergies and you are buying high-MERV filters, check the pressure drop — a filter that is too restrictive starves the system of airflow and can ice the coil in summer or overheat the exchanger in winter.</p>
<p>Ultraviolet lights, electronic air cleaners and media cabinets all add maintenance of their own. Whatever you install, put the cleaning interval on the calendar the day it goes in.</p>
<h2>Noises and smells worth taking seriously</h2>
<ul><li>A deep boom at ignition — delayed ignition, which can crack the exchanger over time.</li><li>A metallic scrape or squeal — blower bearing or a loose panel.</li><li>A smell of burning dust at the first start of the season is normal for an hour; a persistent burnt or acrid smell is not.</li><li>Soot around the burner compartment — a combustion problem, not a cleaning problem.</li><li>Headaches, nausea or a stuffy feeling that improves when you leave the house — treat as a possible CO issue and ventilate immediately.</li></ul>
<h2>Repair or replace: the furnace version</h2>
<p>Furnaces commonly last 15–20 years. The decision points are similar to any appliance: a heat exchanger failure on an older unit is usually a replacement, because the part cost plus labour approaches half of a new installation. A blower motor or igniter on a ten-year-old unit is a straightforward repair.</p>
<p>Efficiency also matters at replacement time. An older 80% furnace vented into a chimney may need a different venting strategy to move to a 90%+ condensing unit, and that changes the installed price far more than the equipment price does.</p>
<h2>Frequently asked questions</h2>
<h3>How often should a furnace be serviced?</h3><p>Once a year, ideally in early fall. Manufacturers usually require documented annual service to keep the warranty valid, so keep the invoice.</p>
<h3>Can I skip the annual service if the furnace is working fine?</h3><p>The service is less about fixing and more about safety and efficiency: combustion, the heat exchanger and venting are not things a homeowner can inspect. It is also the cheapest way to catch a failing igniter before a cold night.</p>
<h3>What MERV rating should my furnace filter be?</h3><p>MERV 8 is a sensible default for most residential systems. Higher ratings capture more particles but restrict airflow, so confirm the system can handle the pressure drop before going above MERV 11.</p>
<h3>Why does my furnace smell when it first comes on in fall?</h3><p>Dust burning off the heat exchanger after months idle. It should fade within an hour. A persistent smell, a smell of gas, or soot around the unit means switch it off and call a technician.</p>
<h2>Where to go next</h2><ul><li><a href="/services/hvac">See HVAC service options</a></li><li><a href="/blog/ac-not-cooling-troubleshooting-guide">Air conditioner not cooling? A troubleshooting guide</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/furnace-maintenance-checklist.svg', 'Illustration of a home furnace with a calendar and a safety shield',
       'Furnace Maintenance Checklist for Homeowners', 'A month-by-month furnace routine: filter changes, the annual service, what a technician checks, and the carbon monoxide symptoms that mean turn it off now.', 'Annual furnace maintenance schedule split into monthly homeowner tasks and the professional service visit.',
       'furnace maintenance checklist', 'annual furnace service, furnace tune up, furnace not heating, furnace filter change, carbon monoxide furnace, heating maintenance cost',
       NULL, 0, '/images/blog/furnace-maintenance-checklist.svg', 'Safe Home Network Editorial',
       '2026-11-02 14:00:00', NULL
  FROM blog_categories c WHERE c.slug = 'hvac'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'furnace-maintenance-checklist';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'furnace-maintenance-checklist' AND t.slug = 'hvac';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'furnace-maintenance-checklist' AND t.slug = 'heating';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'furnace-maintenance-checklist' AND t.slug = 'maintenance';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'furnace-maintenance-checklist' AND t.slug = 'safety';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'furnace-maintenance-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with a gas or electric furnace who want a maintenance routine that keeps heating reliable and safe through winter.' FROM blog_posts b WHERE b.slug = 'furnace-maintenance-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '885 words' FROM blog_posts b WHERE b.slug = 'furnace-maintenance-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See HVAC service options' FROM blog_posts b WHERE b.slug = 'furnace-maintenance-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/ac-not-cooling-troubleshooting-guide
/blog/questions-to-ask-before-hiring-a-home-service-professional' FROM blog_posts b WHERE b.slug = 'furnace-maintenance-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a furnace cabinet with a flue, a calendar chip and a shield chip on a warm sand background.' FROM blog_posts b WHERE b.slug = 'furnace-maintenance-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 11. Roof Leak Warning Signs Every Homeowner Should Know
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'roof-leak-warning-signs', 'Roof Leak Warning Signs Every Homeowner Should Know', c.id, 'scheduled',
       'A roof leak rarely announces itself as water on the floor. It shows up first as a stain, a smell, a granule in the gutter or a shingle in the garden — and each of those tells you something different about urgency.', '<p>Water is patient. A roof can leak for months through a nail pop or a failed boot around a vent pipe before enough water collects to reach a ceiling — and by then the wet path is long, the insulation is saturated and the source is nowhere near the stain.</p>
<p>That is why the useful signs are not the dramatic ones. They are the small, early, specific ones listed below, each of which points to a different part of the roof and a different urgency.</p>
<h2>Inside the house</h2>
<ul><li>Brown or copper rings on a ceiling or wall — the classic sign. The centre of the ring is usually the lowest point of the leak, not the entry point.</li><li>Paint that blisters or bubbles near a ceiling line, which means moisture is trapped behind it.</li><li>A musty smell in an upstairs room or closet that does not go away when you ventilate.</li><li>Damp patches on a chimney breast, which usually mean failed flashing rather than failed shingles.</li><li>Sagging ceiling plaster — stop using the room below and get it inspected.</li></ul>
<h2>In the attic</h2>
<p>Take a flashlight up on a dry day. Look for dark stains or water tracks on the underside of the roof deck, rust on nail tips, and daylight showing through the boards. Insulation that looks compressed, clumped or darker in one area has probably been wet.</p>
<p>Check around penetrations: vent pipes, the chimney, skylights and any satellite mount. Those are the places roofs leak first, because they rely on sealant and flashing rather than on the shingle field itself.</p>
<h2>Outside, from the ground</h2>
<figure class="article-table"><table><thead><tr><th>What you see</th><th>What it usually means</th><th>Urgency</th></tr></thead><tbody><tr><td>Granules collecting in gutters or at downspouts</td><td>Normal ageing, or hail damage if sudden</td><td>Monitor; inspect after a storm</td></tr><tr><td>Curling, clawing or missing shingles</td><td>End of service life on that slope</td><td>Repair within weeks</td></tr><tr><td>Rusted or lifted flashing</td><td>Sealant has failed at a penetration</td><td>Repair within weeks</td></tr><tr><td>Sagging ridge line</td><td>Structural or decking problem</td><td>Inspect immediately</td></tr><tr><td>Dark streaks on the roof face</td><td>Algae, usually cosmetic</td><td>Low — clean if it bothers you</td></tr><tr><td>Moss or lichen in patches</td><td>Retained moisture and debris</td><td>Clean and inspect the deck</td></tr></tbody></table></figure>
<h2>The one that catches everyone: ice dams</h2>
<p>In cold climates, water backing up behind an ice dam at the eaves does more interior damage than any single missing shingle. The cause is warm air escaping into the attic, melting snow that refreezes at the cold edge. Fixing the roof without fixing the air sealing and insulation just moves the problem to next winter.</p>
<h2>What to do while you wait for the inspection</h2>
<ol><li>Put a bucket under the drip and move anything valuable out of the way.</li><li>Photograph everything — stains, shingles, granules, attic evidence — before anyone repairs anything.</li><li>Do not climb onto the roof. Wet shingles are treacherous and a fall is a far worse outcome than a stain.</li><li>If water is running near electrical fittings, switch off that circuit.</li><li>Avoid sealing over the leak from inside; trapping moisture in the assembly makes the damage worse.</li></ol>
<h2>How long you actually have</h2>
<p>An active drip into a living space is a days-not-weeks problem. A stain with no active drip is usually weeks. A missing shingle on a slope with intact underlayment can often wait for scheduled work — but not through a storm season.</p>
<p>The exception is anything structural: a sagging deck, a ceiling that has begun to bow, or water pooling in the attic. Those need an inspection now, because the cost curve is not linear once framing is involved.</p>
<blockquote><p>Ask any inspector for photographs of what they found and a written scope of the repair. A verbal report of ''you need a new roof'' is not a diagnosis, and it is not something you can compare against a second opinion.</p></blockquote>
<h2>Frequently asked questions</h2>
<h3>How do I find where a ceiling stain is coming from?</h3><p>Work uphill and up-slope from the stain: check the attic deck above it, then look outside at the nearest penetration — vent, chimney, skylight or valley. Water follows framing, so the entry point is often several feet away.</p>
<h3>Is a small ceiling stain always a roof leak?</h3><p>No. Condensation from a bathroom fan venting into the attic, a plumbing leak or an ice dam can all produce identical stains. The attic inspection distinguishes them, which is why it is the first step.</p>
<h3>Can I repair a roof leak myself?</h3><p>Clearing debris and replacing a slipped shingle at ground-accessible eaves is reasonable for a confident DIYer. Anything above a single story, anything around a chimney or valley, and any work on a wet roof belongs with a professional.</p>
<h3>Will my insurance cover a roof leak?</h3><p>Policies typically cover sudden damage from a storm or a fallen branch, and typically exclude wear, age and lack of maintenance. Document the cause carefully: ''the shingles were worn'' and ''hail damaged the shingles'' produce very different answers.</p>
<h2>Where to go next</h2><ul><li><a href="/services/roofing">See roofing service options</a></li><li><a href="/blog/roof-repair-vs-replacement">Roof repair or full replacement: how to decide</a></li><li><a href="/blog/storm-damage-roof-repair-and-insurance">Storm damage roof repair and insurance claims</a></li><li><a href="/blog/first-24-hours-after-water-damage">The first 24 hours after water damage</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/roof-leak-warning-signs.svg', 'Illustration of a pitched roof with rain drops and a safety shield',
       '9 Roof Leak Warning Signs to Check This Weekend', 'Brown ceiling rings, granules in the gutter, daylight in the attic: the nine signs a roof is leaking, what each one points to, and how long you have to act.', 'Diagnostic guide to the nine earliest signals of roof failure, from interior stains to attic evidence.',
       'roof leak signs', 'signs of a leaking roof, roof leak from attic, water stain ceiling, roof inspection, roof repair near me, roof leak cost',
       NULL, 0, '/images/blog/roof-leak-warning-signs.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-08 14:00:00'
  FROM blog_categories c WHERE c.slug = 'roofing'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'roof-leak-warning-signs';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-leak-warning-signs' AND t.slug = 'roofing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-leak-warning-signs' AND t.slug = 'leaks';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-leak-warning-signs' AND t.slug = 'inspection';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-leak-warning-signs' AND t.slug = 'prevention';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'roof-leak-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners who have spotted a stain, a missing shingle or a damp attic and want to know how urgent it is.' FROM blog_posts b WHERE b.slug = 'roof-leak-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '898 words' FROM blog_posts b WHERE b.slug = 'roof-leak-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See roofing service options' FROM blog_posts b WHERE b.slug = 'roof-leak-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/roof-repair-vs-replacement
/blog/storm-damage-roof-repair-and-insurance
/blog/first-24-hours-after-water-damage' FROM blog_posts b WHERE b.slug = 'roof-leak-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a pitched roof with shingle lines and a chimney, with droplet and shield chips on a cream background.' FROM blog_posts b WHERE b.slug = 'roof-leak-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 12. How to Choose a Roofing Contractor
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'how-to-choose-a-roofing-contractor', 'How to Choose a Roofing Contractor', c.id, 'scheduled',
       'Roofing is the one home project where the cheapest quote is most often the most expensive outcome. Here is what to verify before you sign, and what a proper written scope contains.', '<p>A roof replacement is one of the largest single purchases a homeowner makes, and it is bought on trust: you cannot see the work once it is complete, and most of the failures show up after the contractor has moved on to the next job.</p>
<p>The vetting below is not about finding the cheapest roofer. It is about finding one whose paperwork, scope and payment terms will still make sense if something goes wrong in eighteen months.</p>
<h2>1. Verify the licence and the insurance yourself</h2>
<p>Ask for the licence number and check it against your state or local licensing database — do not accept a scanned card as proof. Ask for a certificate of general liability insurance and a workers'' compensation certificate, and call the insurer to confirm the policy is current.</p>
<p>This matters more for roofing than for almost any other trade. If an uninsured crew member falls off your roof, the claim can land on your homeowner policy.</p>
<h2>2. Insist on a written, itemised scope</h2>
<p>A one-line quote saying ''remove and replace roof'' is not a scope. A proper proposal states the square footage, whether the existing layers are removed or recovered, the underlayment and ice-and-water membrane, the flashing details, the ridge and edge treatment, ventilation changes, and what happens to the gutters and skylights.</p>
<figure class="article-table"><table><thead><tr><th>Line item</th><th>Why it belongs in the quote</th></tr></thead><tbody><tr><td>Tear-off vs overlay</td><td>Overlays shorten the life of the new roof and may not be permitted</td></tr><tr><td>Decking replacement allowance</td><td>Priced per sheet, so soft spots do not become a surprise invoice</td></tr><tr><td>Underlayment and membrane</td><td>The layer that actually stops water at valleys and eaves</td></tr><tr><td>Flashing at chimney and walls</td><td>The most common leak point on any roof</td></tr><tr><td>Ventilation</td><td>Determines whether the manufacturer warranty stays valid</td></tr><tr><td>Dumpster, permits and cleanup</td><td>Common hidden extras, and magnet sweeping for nails</td></tr><tr><td>Warranty terms</td><td>Workmanship years and whether it is transferable</td></tr></tbody></table></figure>
<h2>3. Check that the warranty is two warranties</h2>
<p>Materials carry a manufacturer warranty; installation carries a workmanship warranty. A 30-year shingle installed badly will fail in five, and the manufacturer will decline the claim because the fault is workmanship.</p>
<p>Ask for the workmanship period in writing, whether it transfers to a buyer if you sell, and whether the contractor requires you to register the product warranty.</p>
<h2>4. Ask how the crew is employed</h2>
<p>Some companies use their own crews; others subcontract. Subcontracting is not automatically bad, but the contract should say who is responsible for supervision, insurance and warranty service. If the answer is vague, the warranty will be too.</p>
<h2>5. Payment schedule and deposits</h2>
<p>A sensible schedule is a modest deposit for materials, a progress payment once the roof is dry and inspection-ready, and the balance after the final walkthrough and cleanup. Large cash deposits, full payment upfront, or pressure to sign the same day are all reasons to walk away.</p>
<p>Never pay in cash without a receipt, and never let the final payment happen before you have walked the property and checked for nails, damaged landscaping and debris in gutters.</p>
<h2>6. Local references you can actually call</h2>
<p>Online reviews are a starting point, not evidence. Ask for three recent addresses in your area and, ideally, one roof that is at least five years old. A contractor whose five-year-old work still looks clean is telling you something reviews cannot.</p>
<h2>7. Red flags worth ending the conversation over</h2>
<ul><li>Door-to-door sales immediately after a storm, with an offer that expires today.</li><li>No physical business address, or an address that is a mailbox store.</li><li>A request to sign a document that assigns your insurance claim to them.</li><li>Refusal to put the scope, warranty or payment schedule in writing.</li><li>A quote dramatically below every other quote with no explanation of what is missing.</li></ul>
<blockquote><p>In most US states you have a short right-to-cancel window on contracts signed at your home. Read the notice on the back of any contract before you sign it, and keep a copy of everything.</p></blockquote>
<h2>Frequently asked questions</h2>
<h3>How many roofing quotes should I get?</h3><p>Three is the practical number: enough to see the range, few enough to compare properly. Make sure all three are quoting the same scope, otherwise you are comparing prices, not proposals.</p>
<h3>What is a normal deposit for a roof replacement?</h3><p>Often around 10–30% to cover materials, with the balance on completion. Anything approaching full payment before work starts should be refused.</p>
<h3>Do I need a permit for a roof replacement?</h3><p>In most jurisdictions, yes — and the permit usually triggers an inspection. Ask who pulls it; a contractor who suggests skipping it is also skipping the inspection that protects you.</p>
<h3>How long does a roof replacement take?</h3><p>Most single-family roofs take one to three days on site, weather permitting. Steeper pitches, multiple layers to strip and complex detailing can extend that.</p>
<h2>Where to go next</h2><ul><li><a href="/services/roofing">See roofing service options</a></li><li><a href="/blog/roof-repair-vs-replacement">Roof repair or full replacement: how to decide</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/how-to-choose-a-roofing-contractor.svg', 'Illustration of a house with a written quote and a review star',
       'How to Choose a Roofing Contractor: 7 Checks', 'Licence, insurance, written scope, warranty and payment schedule: the seven checks that separate a professional roofer from an expensive experiment.', 'Contractor vetting checklist for roofing projects, from licence verification to payment milestones.',
       'how to choose a roofing contractor', 'roofing contractor near me, roofing quote, licensed roofer, roofing warranty, roof replacement estimate, roofing red flags',
       NULL, 0, '/images/blog/how-to-choose-a-roofing-contractor.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-09 14:00:00'
  FROM blog_categories c WHERE c.slug = 'roofing'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'how-to-choose-a-roofing-contractor';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-roofing-contractor' AND t.slug = 'roofing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-roofing-contractor' AND t.slug = 'hiring';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-roofing-contractor' AND t.slug = 'contractors';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-choose-a-roofing-contractor' AND t.slug = 'consumer-protection';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-roofing-contractor'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners about to request roofing quotes and unsure what a credible proposal looks like.' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-roofing-contractor'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '879 words' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-roofing-contractor'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See roofing service options' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-roofing-contractor'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/roof-repair-vs-replacement
/blog/how-to-compare-home-service-estimates
/blog/questions-to-ask-before-hiring-a-home-service-professional' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-roofing-contractor'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a house with a written proposal and a review star, on a warm sand background.' FROM blog_posts b WHERE b.slug = 'how-to-choose-a-roofing-contractor'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 13. Roof Repair or Full Replacement: How to Decide
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'roof-repair-vs-replacement', 'Roof Repair or Full Replacement: How to Decide', c.id, 'scheduled',
       'The decision is rarely about one leak. It is about the age of the roof, how much of it is failing, and whether you are paying for the same repair twice.', '<p>Every roofing conversation eventually reaches the same fork: patch it, or replace it. The answer is usually clear once you know three facts — the age of the roof, the extent of the damage, and how many repairs it has already had.</p>
<p>What follows is the framework a good inspector uses, so you can follow the reasoning rather than take a verdict on faith.</p>
<h2>Start with age and expected life</h2>
<p>A roof in the first half of its life with one isolated failure is a repair. A roof in its last quarter with three failures in two years is a replacement wearing a repair''s clothes.</p>
<figure class="article-table"><table><thead><tr><th>Material</th><th>Typical service life</th><th>Repair-friendly?</th></tr></thead><tbody><tr><td>3-tab asphalt shingle</td><td>15–20 years</td><td>Yes, in the first half of life</td></tr><tr><td>Architectural asphalt shingle</td><td>20–30 years</td><td>Yes, for isolated damage</td></tr><tr><td>Metal standing seam</td><td>40–70 years</td><td>Yes, but specialists only</td></tr><tr><td>Clay or concrete tile</td><td>40–50+ years</td><td>Yes — the tile outlives the underlayment</td></tr><tr><td>Wood shake</td><td>25–30 years</td><td>Condition-dependent; often replaced</td></tr><tr><td>Flat membrane (EPDM/TPO)</td><td>20–25 years</td><td>Yes, patch and seam repairs are routine</td></tr></tbody></table></figure>
<h2>Then judge the extent, not the count</h2>
<p>One leak near a vent boot is a repair. Ten failed shingles spread across three slopes is a replacement, even though the individual repairs are small. Ask the inspector to show you photographs and mark the affected areas on a simple roof diagram.</p>
<p>Look at how the failure happened. Impact damage from a branch or hail is localised and repairable. General granule loss, curling and brittleness across the whole field is age, and age is not repairable.</p>
<h2>The repeat-repair rule</h2>
<p>If you have spent more than about a third of the replacement cost on repairs over the past few years, stop repairing. The next leak is already queued up, and each repair is money that does not carry forward into a new roof.</p>
<p>The corollary matters too: a repair is worth doing when it buys you real time — five years or more — or when it is genuinely localised on a young roof.</p>
<blockquote><p>Never let a contractor talk you into a repair on a roof that is already at end of life simply to avoid a bigger conversation. Ask directly: ''If this were your house, what would you do, and why?''</p></blockquote>
<h2>What a proper repair actually includes</h2>
<ol><li>Diagnosis of the source, not just the stain.</li><li>Removal of the damaged shingles or membrane in a neat rectangle.</li><li>Inspection of the deck beneath — soft spots get replaced, not covered.</li><li>New underlayment and correct flashing at any penetration.</li><li>Color-matched shingles and proper sealing of the tabs.</li><li>A written note of what was done, with photographs.</li></ol>
<h2>The hidden costs of delaying replacement</h2>
<p>A repair is only cheaper if the roof underneath is sound. Once water reaches decking, insulation or framing, the repair cost stops being a roofing number. Rot in a fascia or a ceiling joist is carpentry; wet insulation is removal and replacement; mold is remediation.</p>
<p>There is also an insurance angle: a claim for interior damage caused by a roof you knew was failing is the kind of claim that gets scrutinised and often declined.</p>
<h2>How to compare the two quotes fairly</h2>
<ul><li>Compare cost per square, and confirm both quotes include tear-off, underlayment and flashing.</li><li>Ask what the repair buys in years, in the contractor''s own estimate.</li><li>For replacement, ask for the workmanship warranty in writing, separate from the material warranty.</li><li>Check whether the repair scope includes making good inside the house or only the roof.</li><li>Ask whether a repair now would void any existing manufacturer warranty — sometimes it does.</li></ul>
<h2>Frequently asked questions</h2>
<h3>How long can I wait before replacing a leaking roof?</h3><p>An active leak into living space is urgent. A single isolated leak on a young roof can be repaired and monitored for years. A roof past its expected life with repeated leaks should be replaced before the next storm season, not after.</p>
<h3>Can you replace only part of a roof?</h3><p>Yes — a single slope or a section around an addition is sometimes viable, especially if the failure is localised. Blending new and old shingles on a visible elevation is the usual trade-off.</p>
<h3>Does a new roof add value to a house?</h3><p>It removes a common objection and makes the house insurable, which matters at sale. The return varies by market, but a documented, warrantied roof is one of the more reliable upgrades.</p>
<h3>Will my insurer pay for a repair or a replacement?</h3><p>Insurers pay for sudden, accidental damage such as a storm event, usually on a repair basis first. Wear and age are excluded, and a replacement is often only covered where repair cannot restore the roof to its pre-loss condition.</p>
<h2>Where to go next</h2><ul><li><a href="/services/roof-repair">See roof repair options</a></li><li><a href="/blog/roof-leak-warning-signs">Roof leak warning signs every homeowner should know</a></li><li><a href="/blog/storm-damage-roof-repair-and-insurance">Storm damage roof repair and insurance claims</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/roof-repair-vs-replacement.svg', 'Illustration of a stepladder with a coin and a house icon',
       'Roof Repair or Replacement? How to Decide', 'Age, extent and repeat repairs decide most roof questions. A practical framework for choosing between a targeted repair and a full replacement.', 'Decision matrix comparing repair and replacement by roof age, damage extent and cost per square.',
       'roof repair or replace', 'roof repair cost, roof replacement cost, how long does a roof last, patch a roof leak, roof repair near me, asphalt shingle lifespan',
       NULL, 0, '/images/blog/roof-repair-vs-replacement.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-10 14:00:00'
  FROM blog_categories c WHERE c.slug = 'roof-repair'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'roof-repair-vs-replacement';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-repair-vs-replacement' AND t.slug = 'roofing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-repair-vs-replacement' AND t.slug = 'roof-repair';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-repair-vs-replacement' AND t.slug = 'repair-or-replace';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'roof-repair-vs-replacement' AND t.slug = 'budgeting';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'roof-repair-vs-replacement'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners quoted for a repair who suspect they are being pushed toward a full replacement, or the reverse.' FROM blog_posts b WHERE b.slug = 'roof-repair-vs-replacement'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '855 words' FROM blog_posts b WHERE b.slug = 'roof-repair-vs-replacement'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See roof repair options' FROM blog_posts b WHERE b.slug = 'roof-repair-vs-replacement'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/roof-leak-warning-signs
/blog/storm-damage-roof-repair-and-insurance
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'roof-repair-vs-replacement'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a stepladder with a coin chip, a wrench chip and a small house chip on a cream background.' FROM blog_posts b WHERE b.slug = 'roof-repair-vs-replacement'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 14. Storm Damage Roof Repair and Insurance Claims
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'storm-damage-roof-repair-and-insurance', 'Storm Damage Roof Repair and Insurance Claims', c.id, 'scheduled',
       'The claim is usually decided in the first two days, long before an adjuster arrives. Document the damage, mitigate further loss, and be careful who you let on the roof.', '<p>After a major storm, three groups of people arrive within days: neighbors checking on each other, contractors looking for work, and adjusters working through a queue. The homeowner who has documented the damage before any of them arrives is the one who gets a clean claim.</p>
<p>This guide covers the first 48 hours, what evidence actually supports a claim, and how to tell a legitimate storm contractor from someone following the weather.</p>
<h2>The first 48 hours</h2>
<ol><li>Make the home safe: check for water near electrical fittings, and keep people away from sagging ceilings.</li><li>Photograph and video everything before anyone touches it — wide shots of each elevation, close-ups of damage, and anything that hit the roof.</li><li>Stop further damage. A tarp over a missing section is mitigation, and insurers expect it; keep the receipt.</li><li>Call your insurer and open the claim. Ask what your deductible is and whether emergency mitigation is reimbursed.</li><li>Do not sign anything from a contractor who knocks on your door before you have spoken to your insurer.</li></ol>
<h2>What storm damage actually looks like</h2>
<p>Hail bruises are easiest to see when the shingle is warm and slightly soft. An inspector will often mark suspect areas with chalk and photograph them; a good one will show you the marks rather than describe them.</p>
<figure class="article-table"><table><thead><tr><th>Cause</th><th>Evidence on the roof</th><th>Often missed</th></tr></thead><tbody><tr><td>Hail</td><td>Soft spots, bruised shingle mat, dented vents and gutters</td><td>Granule loss that looks like normal ageing</td></tr><tr><td>High wind</td><td>Lifted or missing tabs, broken seals, creased shingles</td><td>Damage on one elevation only</td></tr><tr><td>Fallen debris</td><td>Punctures, cracked tiles, crushed ridge caps</td><td>Damage to flashing beneath the impact</td></tr><tr><td>Ice and snow load</td><td>Sagging deck, popped nails, ice dam staining</td><td>Interior water tracks far from the roof</td></tr></tbody></table></figure>
<h2>Working with the adjuster</h2>
<p>You are entitled to be present at the inspection, and you should be. Bring your photographs, your notes on the storm date, and any invoices for emergency work. Ask the adjuster to explain anything they exclude.</p>
<p>If the offer seems low, you can request a re-inspection, get an independent contractor''s written scope and submit it, or in many states use the appraisal process in your policy. Read the policy''s loss settlement section before arguing about the number.</p>
<blockquote><p>Never sign a document that assigns your claim proceeds to a contractor — sometimes called a direction to pay or an assignment of benefits. It transfers control of your claim, and it is restricted in several states for good reason.</p></blockquote>
<h2>Storm chasers: how to spot them</h2>
<ul><li>They arrive days after the storm with out-of-state plates and no local address.</li><li>They offer to waive your deductible, which is insurance fraud in most states.</li><li>They want a large cash deposit before any materials arrive.</li><li>They cannot produce a licence, insurance certificate or a local reference.</li><li>They ask you to sign a contract before you have even seen a written scope.</li></ul>
<h2>Do you have to claim at all?</h2>
<p>Not every storm justifies a claim. If the repair is close to your deductible, paying directly avoids a claim on your history that can affect future premiums. But if there is any chance of hidden damage — a bruised mat that will fail in two winters — get the inspection first and decide with the facts.</p>
<p>One practical rule: a claim for a few hundred dollars over the deductible is rarely worth it. A claim for a full slope or a replacement is.</p>
<h2>Frequently asked questions</h2>
<h3>How long do I have to file a storm damage claim?</h3><p>It varies by state and policy, commonly from one to two years from the date of loss, with a shorter window to notify the insurer promptly. Report the damage as soon as you are safely able to.</p>
<h3>Will filing a claim raise my premium?</h3><p>It can. Weather claims are treated differently from at-fault claims in many states, but repeated claims still affect your history. Ask your insurer directly before filing, and weigh the claim against your deductible.</p>
<h3>Can I choose my own contractor for insurance work?</h3><p>Yes in nearly all cases. The insurer pays for the loss; you choose who does the work. Be wary of any arrangement that requires you to use a preferred vendor.</p>
<h3>What if the adjuster''s estimate is lower than my contractor''s?</h3><p>Send the contractor''s itemised scope to the adjuster and ask for a re-inspection. Differences are often about code upgrades, matching materials or items the adjuster could not see from the ground.</p>
<h2>Where to go next</h2><ul><li><a href="/services/roof-repair">See roof repair options</a></li><li><a href="/blog/roof-leak-warning-signs">Roof leak warning signs every homeowner should know</a></li><li><a href="/blog/roof-repair-vs-replacement">Roof repair or full replacement: how to decide</a></li><li><a href="/blog/how-to-choose-a-roofing-contractor">How to choose a roofing contractor</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/storm-damage-roof-repair-and-insurance.svg', 'Illustration of a storm cloud with rain, a claim document and a house icon',
       'Storm Damage Roof Repair and Insurance Claims', 'What to do in the first 48 hours after a storm, how to document hail and wind damage for a claim, and how to avoid the contractors who follow the weather.', 'Storm response playbook: emergency mitigation, evidence gathering, claim process and contractor vetting.',
       'storm damage roof repair', 'hail damage roof, roof insurance claim, wind damage shingles, storm chaser contractors, roof inspection after storm, emergency roof tarp',
       NULL, 0, '/images/blog/storm-damage-roof-repair-and-insurance.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-11 14:00:00'
  FROM blog_categories c WHERE c.slug = 'roof-repair'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'storm-damage-roof-repair-and-insurance';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'storm-damage-roof-repair-and-insurance' AND t.slug = 'roofing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'storm-damage-roof-repair-and-insurance' AND t.slug = 'storm-damage';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'storm-damage-roof-repair-and-insurance' AND t.slug = 'insurance';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'storm-damage-roof-repair-and-insurance' AND t.slug = 'hiring';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'storm-damage-roof-repair-and-insurance'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners dealing with a roof after a hailstorm or high wind, and deciding whether to claim on insurance.' FROM blog_posts b WHERE b.slug = 'storm-damage-roof-repair-and-insurance'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '817 words' FROM blog_posts b WHERE b.slug = 'storm-damage-roof-repair-and-insurance'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See roof repair options' FROM blog_posts b WHERE b.slug = 'storm-damage-roof-repair-and-insurance'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/roof-leak-warning-signs
/blog/roof-repair-vs-replacement
/blog/how-to-choose-a-roofing-contractor' FROM blog_posts b WHERE b.slug = 'storm-damage-roof-repair-and-insurance'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a rain cloud with a claim document chip, a house chip and a shield chip on a sand background.' FROM blog_posts b WHERE b.slug = 'storm-damage-roof-repair-and-insurance'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 15. The First 24 Hours After Water Damage
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'first-24-hours-after-water-damage', 'The First 24 Hours After Water Damage', c.id, 'scheduled',
       'Water damage is a race against absorption. The actions in the first hour decide whether you are drying a floor or replacing one — and whether mold becomes part of the story.', '<p>Clean water from a burst supply line and dirty water from a backed-up drain are different emergencies, but they share a clock: materials absorb water in minutes, swell in hours and grow mold in days.</p>
<p>What you do in the first day determines how much of the house you keep. It also determines how easy the insurance conversation is, because documentation made while the water is still visible is worth far more than a description a week later.</p>
<h2>Hour 0–1: stop the source and make it safe</h2>
<ol><li>Shut off the water at the fixture valve or the main. For a roof leak, you cannot stop the source — contain it instead.</li><li>Switch off power to any circuit that serves a wet area, at the breaker, without walking through standing water to reach the panel.</li><li>If the water is near outlets, appliances or the panel, leave the room and call for help.</li><li>Photograph the scene before you move anything, including the water line on walls and furniture legs.</li><li>Call your insurer to open a claim, and ask whether they will dispatch a restoration firm.</li></ol>
<h2>Hour 1–4: extract, lift, ventilate</h2>
<p>Standing water should be extracted, not mopped — a wet/dry vacuum or a rented extractor removes far more water per hour than towels. Once the bulk is gone, the goal is airflow and dehumidification, because evaporation is what actually dries a structure.</p>
<p>Lift furniture legs onto foil or blocks, pull rugs out to dry flat, and open interior doors so air can move. If the outdoor humidity is lower than indoors, open windows; if it is a humid summer day, close up and rely on dehumidifiers instead.</p>
<blockquote><p>Never use a household fan to dry a space that has been flooded with category 3 water — sewage or outdoor floodwater. It aerosolises contaminants. Those jobs belong with a restoration professional in PPE.</p></blockquote>
<h2>What can be saved and what cannot</h2>
<figure class="article-table"><table><thead><tr><th>Material</th><th>Outlook after clean water</th><th>Outlook after contaminated water</th></tr></thead><tbody><tr><td>Hardwood flooring</td><td>Sometimes salvageable if dried fast with mat drying</td><td>Usually removed</td></tr><tr><td>Laminate flooring</td><td>Almost always replaced — the core swells</td><td>Replaced</td></tr><tr><td>Drywall (less than 24h, clean water)</td><td>Can be dried in place with air movers</td><td>Cut out to the flood line</td></tr><tr><td>Carpet and underlay</td><td>Often salvageable if extracted same day</td><td>Discard</td></tr><tr><td>Solid wood furniture</td><td>Dry slowly, away from direct heat</td><td>Assess case by case</td></tr><tr><td>Insulation (batts)</td><td>Usually replaced once wet</td><td>Replaced</td></tr><tr><td>Cabinets (particleboard)</td><td>Swollen and non-structural — replace</td><td>Replace</td></tr></tbody></table></figure>
<h2>The 24–48 hour window</h2>
<p>Mold can begin colonising wet porous materials within 24–48 hours in warm conditions. That is not a reason to panic, but it is a reason to have drying equipment running by the end of the first day rather than the third.</p>
<p>A professional assessment typically includes moisture meters and thermal imaging to find water that has travelled behind baseboards, under tile or into a ceiling cavity. Visible water is rarely the whole story.</p>
<h2>Documentation that makes a claim easier</h2>
<ul><li>Date-stamped photos and video of every affected room before cleanup.</li><li>A written list of damaged items with age and approximate replacement value.</li><li>Receipts for any rental equipment, dehumidifiers or emergency purchases.</li><li>The plumber''s or restoration firm''s written report naming the cause.</li><li>A moisture reading log if a contractor is involved — before and after values.</li></ul>
<h2>When to call a professional immediately</h2>
<p>Call the same day for: contaminated water, more than a few square meters of wet flooring, water in a ceiling or wall cavity, any wet area near electrical services, or a home that will be unoccupied in the following days.</p>
<p>For a small clean-water spill caught within an hour, a homeowner with a wet/dry vac and a dehumidifier can often handle it. The dividing line is whether the water has gone where you cannot see or reach.</p>
<h2>Frequently asked questions</h2>
<h3>How long does it take to dry a house after water damage?</h3><p>With professional equipment, most clean-water losses dry in three to five days. Materials like hardwood or dense plaster can take longer, and readings — not the calendar — decide when drying is finished.</p>
<h3>Does homeowner insurance cover water damage?</h3><p>Sudden and accidental discharge, such as a burst pipe or a failed appliance hose, is usually covered. Gradual leaks, poor maintenance and flood from outside the home are typically excluded or need separate flood cover.</p>
<h3>Can I stay in the house during drying?</h3><p>Often yes for a small clean-water loss in one room, though the noise and humidity are unpleasant. If the water was contaminated, or if mold is already present, stay elsewhere until the space is cleared.</p>
<h3>Should I cut out wet drywall myself?</h3><p>Only if it is clean water, the damage is obvious and you are comfortable doing it. Restoration firms cut to a measured line and document it for the claim; a homeowner cut that is too shallow often leaves wet material behind.</p>
<h2>Where to go next</h2><ul><li><a href="/services/water-damage">See water damage service options</a></li><li><a href="/blog/hidden-mold-after-a-leak">Hidden mold after a leak: what to look for</a></li><li><a href="/blog/warning-signs-you-need-a-plumber">Warning signs you need a plumber</a></li><li><a href="/blog/roof-leak-warning-signs">Roof leak warning signs every homeowner should know</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/first-24-hours-after-water-damage.svg', 'Illustration of a large water droplet with a clock and an emergency phone icon',
       'First 24 Hours After Water Damage: What to Do', 'Stop the water, protect what can be saved, start drying and document everything. A hour-by-hour plan for the first day of a water emergency.', 'Hour-by-hour emergency water response plan with salvage and documentation guidance.',
       'water damage restoration', 'first 24 hours water damage, water extraction, wet drywall, water damage cost, emergency water damage, dehumidifier drying',
       NULL, 0, '/images/blog/first-24-hours-after-water-damage.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-12 14:00:00'
  FROM blog_categories c WHERE c.slug = 'water-damage'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'first-24-hours-after-water-damage';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'first-24-hours-after-water-damage' AND t.slug = 'water-damage';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'first-24-hours-after-water-damage' AND t.slug = 'emergency';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'first-24-hours-after-water-damage' AND t.slug = 'restoration';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'first-24-hours-after-water-damage' AND t.slug = 'insurance';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'first-24-hours-after-water-damage'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners facing an active leak or flood who need to act immediately and want to know what is salvageable.' FROM blog_posts b WHERE b.slug = 'first-24-hours-after-water-damage'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '889 words' FROM blog_posts b WHERE b.slug = 'first-24-hours-after-water-damage'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See water damage service options' FROM blog_posts b WHERE b.slug = 'first-24-hours-after-water-damage'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/hidden-mold-after-a-leak
/blog/warning-signs-you-need-a-plumber
/blog/roof-leak-warning-signs' FROM blog_posts b WHERE b.slug = 'first-24-hours-after-water-damage'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a large blue droplet with a clock chip, a shield chip and an emergency call chip on a cream background.' FROM blog_posts b WHERE b.slug = 'first-24-hours-after-water-damage'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 16. Hidden Mold After a Leak: What to Look For
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'hidden-mold-after-a-leak', 'Hidden Mold After a Leak: What to Look For', c.id, 'scheduled',
       'Mold does not need a visible leak — it needs moisture and 48 hours. The clues are usually smell, texture and a building that never quite dries.', '<p>Mold is a symptom, not a cause. It appears wherever moisture has persisted long enough for spores to colonise a porous surface — usually 24 to 48 hours of damp in warm conditions. Finding the mold without finding the moisture only guarantees it comes back.</p>
<p>The reason it hides is structural: the wettest part of a wall is rarely the part you can see. Water wicks along studs, sits on the bottom plate and soaks into the back of the drywall, where the paper facing is an ideal food source.</p>
<h2>The five clues that are easy to miss</h2>
<ul><li>A musty smell that is strongest in one room, one cupboard or one corner.</li><li>Paint or wallpaper that peels, blisters or lifts in a vertical strip.</li><li>Skirting boards or door frames that feel soft, or that have gone darker than the rest.</li><li>Allergy-like symptoms that improve when you leave the house and return when you come back.</li><li>A cold spot on a wall in winter — often a sign of missing insulation and condensation.</li></ul>
<h2>Where to look first</h2>
<figure class="article-table"><table><thead><tr><th>Location</th><th>Why it is a common hiding place</th></tr></thead><tbody><tr><td>Behind a washing machine or dishwasher</td><td>Supply and drain leaks that stay small for years</td></tr><tr><td>Under a bathroom vanity</td><td>A trap or supply line weeping into the cabinet base</td></tr><tr><td>Behind kitchen base units</td><td>Slow leaks run along the toe kick and stay invisible</td></tr><tr><td>Attic decking and rafters</td><td>Roof leaks and condensation from bath fans</td></tr><tr><td>Around window frames</td><td>Failed seals and condensation on cold glass</td></tr><tr><td>Basement rim joists</td><td>The coldest spot in the house and the first to condense</td></tr><tr><td>Inside a wall below a bathroom</td><td>Water travels down before it shows on a ceiling</td></tr></tbody></table></figure>
<h2>Condensation versus a leak</h2>
<p>Not all mold is caused by a leak. A bathroom fan that vents into the attic, a dryer ducted into a crawlspace, an unsealed rim joist in a humid climate or simply a poorly ventilated room can produce enough condensation to grow mold without a single failed pipe.</p>
<p>The distinction changes the fix. A leak is a repair; condensation is ventilation, insulation and air sealing. Homes with recurrent mold in the same spot almost always have the second problem.</p>
<blockquote><p>Small patches on a hard surface — a windowsill, a tile grout line, a painted frame — can be cleaned with detergent and water while wearing gloves, then dried thoroughly. Porous materials such as drywall, carpet and insulation with visible mold should be removed rather than cleaned.</p></blockquote>
<h2>Is testing worth paying for?</h2>
<p>In most cases, no. If you can see or smell mold, you already know it is there. Air sampling is occasionally useful to confirm a hidden problem before opening a wall, or to document a remediation for a landlord or an insurer, but it rarely changes the practical next step: find and fix the moisture, then remove the affected material.</p>
<p>Be cautious with anyone who arrives with a test kit and a remediation quote in the same visit. The diagnosis should be separable from the sale.</p>
<h2>What remediation actually involves</h2>
<ol><li>Identify and repair the moisture source first — remediation without this is decoration.</li><li>Contain the work area with plastic sheeting and negative air pressure if the area is larger than about a square meter.</li><li>Remove porous materials that show mold; bag and dispose of them.</li><li>Clean structural surfaces, then dry the cavity completely and verify with moisture readings.</li><li>Replace removed materials and confirm the area stays dry through a full weather cycle.</li></ol>
<h2>The health question, honestly</h2>
<p>Mold is a common trigger for allergic symptoms and asthma, and the evidence for that is solid. Claims about specific ''toxic black mold'' causing unrelated illnesses are much less settled. The sensible position is that visible mold in a home should be removed and the moisture fixed, without either panicking or dismissing it.</p>
<p>Anyone with asthma, a compromised immune system or young children in the home should treat an active mold problem as a reason to move quickly rather than monitor.</p>
<h2>Frequently asked questions</h2>
<h3>How quickly does mold grow after a leak?</h3><p>Spores can germinate within 24–48 hours on wet porous material in warm conditions. Visible growth typically appears within a week, sooner in humid climates.</p>
<h3>Can I just paint over mold?</h3><p>No. Paint seals the surface but the mold continues underneath and the moisture remains. Mold-resistant paint is useful after remediation, not instead of it.</p>
<h3>Does bleach kill mold?</h3><p>Bleach kills surface mold on non-porous materials but does not penetrate porous ones, and it is not recommended on wood or drywall because it leaves moisture behind. Detergent and thorough drying are more effective.</p>
<h3>Will insurance cover mold remediation?</h3><p>Usually only when it results directly from a covered sudden event, and often with a sub-limit. Long-term seepage and neglect are typically excluded, which is another reason to document the original leak carefully.</p>
<h2>Where to go next</h2><ul><li><a href="/services/water-damage">See water damage service options</a></li><li><a href="/blog/first-24-hours-after-water-damage">The first 24 hours after water damage</a></li><li><a href="/blog/roof-leak-warning-signs">Roof leak warning signs every homeowner should know</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/hidden-mold-after-a-leak.svg', 'Illustration of mold spore clusters with a shield and a water droplet',
       'Hidden Mold After a Leak: Signs and Next Steps', 'Musty smells, peeling paint and dark speckles are the visible clues. How hidden mold is found, what remediation involves, and when testing is worth paying for.', 'Detection and remediation guide for hidden mold after water intrusion.',
       'hidden mold after a leak', 'mold symptoms in house, black mold, mold in walls, mold remediation cost, musty smell, mold testing',
       NULL, 0, '/images/blog/hidden-mold-after-a-leak.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-13 14:00:00'
  FROM blog_categories c WHERE c.slug = 'water-damage'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'hidden-mold-after-a-leak';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'hidden-mold-after-a-leak' AND t.slug = 'water-damage';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'hidden-mold-after-a-leak' AND t.slug = 'mold';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'hidden-mold-after-a-leak' AND t.slug = 'health';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'hidden-mold-after-a-leak' AND t.slug = 'restoration';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'hidden-mold-after-a-leak'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners who had a leak or a damp area and are worried about mold they cannot see.' FROM blog_posts b WHERE b.slug = 'hidden-mold-after-a-leak'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '875 words' FROM blog_posts b WHERE b.slug = 'hidden-mold-after-a-leak'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See water damage service options' FROM blog_posts b WHERE b.slug = 'hidden-mold-after-a-leak'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/first-24-hours-after-water-damage
/blog/roof-leak-warning-signs' FROM blog_posts b WHERE b.slug = 'hidden-mold-after-a-leak'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a cluster of mold spores with a droplet chip, a shield chip and a leaf chip on a sand background.' FROM blog_posts b WHERE b.slug = 'hidden-mold-after-a-leak'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 17. Termite Warning Signs Around Your Home
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'termite-warning-signs', 'Termite Warning Signs Around Your Home', c.id, 'scheduled',
       'Termites are rarely seen. They leave evidence instead — tunnels, wings, sagging trim and paint that bubbles for no reason. Here is where to look and when to call.', '<p>Termites cause more structural damage in the United States each year than fires and storms combined, and almost all of it happens quietly. They eat from the inside out, so the surface of a timber can look intact while the core is hollow.</p>
<p>That is why the signs matter more than the insects. You will almost never see a colony; you will see what it leaves behind, usually within a few feet of the ground.</p>
<h2>The signs, in order of how often they are real</h2>
<ul><li>Mud tubes on foundation walls, piers or crawlspace supports — pencil-width tunnels of soil and saliva running upward.</li><li>Wood that sounds hollow when tapped, or that gives slightly under a screwdriver.</li><li>Bubbling or blistered paint on timber, which looks like water damage but is often termites pushing against the surface.</li><li>Discarded wings near windowsills and doors after a swarm, usually in spring.</li><li>Frass — small, uniform, sawdust-like pellets — beneath furniture or in a crawlspace.</li><li>Sagging door frames or floors that have become springy near a bathroom or exterior wall.</li><li>Tight-fitting doors and windows that were fine last year: the frame has absorbed moisture and termite activity.</li></ul>
<h2>Where to look, and when</h2>
<p>Spring, after the first warm rain, is when swarmers appear and when evidence is easiest to spot. Walk the exterior once a season: check the foundation line for tubes, look at the base of any wood in contact with soil, and inspect the crawlspace with a flashlight.</p>
<p>Pay attention to the damp places. Termites need moisture, so leaking gutters, downspouts discharging against the foundation and sprinklers hitting the siding are all invitations.</p>
<figure class="article-table"><table><thead><tr><th>Area</th><th>What you are looking for</th></tr></thead><tbody><tr><td>Foundation wall</td><td>Mud tubes, especially in corners and behind planting</td></tr><tr><td>Crawlspace</td><td>Tubes on piers, frass, damp wood, standing water</td></tr><tr><td>Sill plate and rim joist</td><td>Hollow sound, soft timber, tubes entering the framing</td></tr><tr><td>Deck and porch posts</td><td>Wood-to-soil contact without a barrier</td></tr><tr><td>Bathroom and laundry walls</td><td>Soft baseboards, loose tiles, persistent damp</td></tr><tr><td>Attic (drywood termites)</td><td>Frass piles, galleries in rafters, discarded wings</td></tr></tbody></table></figure>
<h2>Termites or something else?</h2>
<p>Carpenter ants also hollow timber, but they leave clean galleries and push out sawdust that looks like coarse shavings. Termite frass is fine and uniform. Carpenter bees leave perfectly round holes; wood-boring beetles leave powdery dust and small exit holes.</p>
<p>If you are unsure, do not treat. A misdiagnosis wastes money and can hide a termite problem for another season.</p>
<h2>What an inspection should include</h2>
<ol><li>Exterior walk of the foundation, siding, deck and any wood-to-soil contact.</li><li>Crawlspace or basement inspection with moisture readings.</li><li>Interior check of accessible walls, especially bathrooms, kitchens and utility areas.</li><li>Probe of suspect timber where it is safe to do so.</li><li>A written report with photographs, findings and a treatment recommendation.</li><li>A clear statement of what was not accessible — behind finished walls, under tile, inside cabinets.</li></ol>
<blockquote><p>Most termite warranties require an annual inspection to stay valid. Put the date in a calendar; a lapsed warranty is the most common reason a claim is declined.</p></blockquote>
<h2>Treatment, briefly</h2>
<p>Subterranean termites are usually treated with a liquid soil barrier around the foundation, bait stations, or both. Drywood termites in a contained area may be treated locally or with whole-structure fumigation. Each has a different cost, disruption level and warranty.</p>
<p>Ask for the product name, the active ingredient, the application rate, the re-treatment terms and whether the warranty covers damage or only re-treatment. ''Warranty'' can mean very different things.</p>
<h2>Prevention that actually helps</h2>
<ul><li>Keep soil at least six inches below any siding or wood sill.</li><li>Fix gutter leaks and extend downspouts well away from the foundation.</li><li>Remove woodpiles, formwork and stumps from against the house.</li><li>Correct crawlspace moisture with a vapor barrier and ventilation.</li><li>Use pressure-treated timber anywhere wood meets soil.</li><li>Keep mulch thin against the foundation — thick beds hold moisture.</li></ul>
<h2>Frequently asked questions</h2>
<h3>How do I know if I have termites or ants?</h3><p>Termites have a thick waist, straight antennae and wings of equal length. Ants have a pinched waist, elbowed antennae and unequal wings. Termite frass is fine and uniform; ant debris looks like coarse sawdust.</p>
<h3>How often should a home be inspected for termites?</h3><p>Annually in termite-prone regions, and after any major water event. In high-pressure areas some warranties require inspection every six months.</p>
<h3>Does homeowner insurance cover termite damage?</h3><p>Almost never. Termite damage is treated as a maintenance issue, not a sudden event. That is why prevention and an active warranty matter.</p>
<h3>Can I treat termites myself?</h3><p>Retail sprays do not reach a colony and often make diagnosis harder. Soil treatments and fumigation are licensed work; a DIY attempt usually costs more in the long run.</p>
<h2>Where to go next</h2><ul><li><a href="/services/pest-control">See pest control options</a></li><li><a href="/blog/rodent-proofing-your-home">Rodent proofing: keeping mice out of your home</a></li><li><a href="/blog/first-24-hours-after-water-damage">The first 24 hours after water damage</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/termite-warning-signs.svg', 'Illustration of a termite with a house and a clipboard inspection report',
       'Termite Warning Signs Every Homeowner Should Know', 'Mud tubes, hollow-sounding wood, discarded wings and bubbling paint: the seven termite signs to check, where to look, and what an inspection should cover.', 'Field guide to subterranean and drywood termite evidence with an inspection checklist.',
       'termite warning signs', 'signs of termites, termite damage, subterranean termites, termite inspection, termite treatment cost, mud tubes',
       NULL, 0, '/images/blog/termite-warning-signs.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-14 14:00:00'
  FROM blog_categories c WHERE c.slug = 'pest-control'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'termite-warning-signs';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'termite-warning-signs' AND t.slug = 'pest-control';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'termite-warning-signs' AND t.slug = 'termites';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'termite-warning-signs' AND t.slug = 'inspection';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'termite-warning-signs' AND t.slug = 'prevention';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'termite-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners in termite-prone regions who want to check their property before damage becomes structural.' FROM blog_posts b WHERE b.slug = 'termite-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '846 words' FROM blog_posts b WHERE b.slug = 'termite-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See pest control options' FROM blog_posts b WHERE b.slug = 'termite-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/rodent-proofing-your-home
/blog/first-24-hours-after-water-damage' FROM blog_posts b WHERE b.slug = 'termite-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a termite with a house chip and an inspection document chip on a cream background.' FROM blog_posts b WHERE b.slug = 'termite-warning-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 18. Rodent Proofing: Keeping Mice and Rats Out of Your Home
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'rodent-proofing-your-home', 'Rodent Proofing: Keeping Mice and Rats Out of Your Home', c.id, 'scheduled',
       'Trapping a mouse solves this mouse. Sealing the gap solves the next five. Here are the entry points that actually matter and the materials that last more than one season.', '<p>A mouse can pass through a gap about the width of a pencil; a rat needs only the width of a thumb. That single fact explains why most rodent work fails: people trap what is inside and never close what let it in.</p>
<p>Exclusion — sealing the structure — is the only permanent fix. Trapping and baiting are how you clear the current population so that exclusion has something to protect.</p>
<h2>How to tell mice from rats</h2>
<p>The difference matters for treatment. Rats are neophobic: they avoid new objects for days, so traps and stations need to sit unset for a while before they work.</p>
<figure class="article-table"><table><thead><tr><th>Evidence</th><th>Mice</th><th>Rats</th></tr></thead><tbody><tr><td>Droppings</td><td>3–6 mm, pointed ends</td><td>12–18 mm, blunt ends</td></tr><tr><td>Noises</td><td>Light scratching and scurrying</td><td>Heavy thumping, gnawing in walls</td></tr><tr><td>Grease marks</td><td>Rare</td><td>Dark smears along walls and pipes</td></tr><tr><td>Nests</td><td>Shredded paper in drawers and cupboards</td><td>Larger nests in voids and under decks</td></tr><tr><td>Behaviour</td><td>Curious, ranges close to cover</td><td>Wary of new objects — needs pre-baiting</td></tr></tbody></table></figure>
<h2>How to inspect your home</h2>
<ol><li>Walk the exterior at dusk with a flashlight and look for gaps at ground level and above.</li><li>Check the roof line and eaves — mice climb brick and enter at the top as readily as the bottom.</li><li>Inspect where utilities enter: gas, water, electric, air conditioning lines, cable and dryer vents.</li><li>Look at garage doors, especially the bottom seal and the corners.</li><li>Inside, check the attic and crawlspace for runs, nests and droppings.</li></ol>
<h2>The entry points that matter most</h2>
<ul><li>The gap under an exterior door, including the garage door bottom seal.</li><li>Utility penetrations through siding and foundation walls.</li><li>Dryer vents and any flexible duct with a damaged flap.</li><li>Roof-to-wall junctions, soffits and gable vents without mesh.</li><li>Weep holes and foundation vents without hardware cloth.</li><li>Gaps around plumbing under sinks where pipes pass through cabinets.</li><li>Chimney flashing gaps and the space around a flue.</li></ul>
<h2>Seal with the right material</h2>
<p>Mice gnaw through foam, plastic and even soft mortar. Use steel wool or copper mesh packed into the gap, then seal over it with an exterior-grade sealant or cement. For larger openings, use hardware cloth at 6 mm or smaller mesh, or sheet metal.</p>
<p>Check the seal after the first hard freeze. Rodents move indoors with the cold, and a gap that was ''probably fine'' in October is a highway in December.</p>
<blockquote><p>Never seal a gap you have not confirmed is empty. Sealing an active run traps rodents inside, and the smell is a problem you will not forget.</p></blockquote>
<h2>Clearing what is already inside</h2>
<ol><li>Set traps along walls and in corners — rodents travel with one side against a surface.</li><li>Use snap traps or enclosed traps rather than glue boards, which are indiscriminate and inhumane.</li><li>Check traps daily; a dead rodent left for days attracts insects.</li><li>Wear gloves and a mask when cleaning droppings, and disinfect the area — hantavirus is a real risk in some regions.</li><li>Keep baits away from pets and children, and prefer professional placement for outdoor stations.</li></ol>
<h2>The prevention habits that keep them out</h2>
<p>Rodents need food, water and shelter. Store dry goods in metal or thick plastic containers, take bins out at night, fix dripping outdoor taps and keep pet food indoors. Clear ivy and shrubs back from the walls, and keep firewood off the ground and away from the house.</p>
<p>A clean, sealed, dry house with no accessible food is a house rodents leave alone — not because they cannot get in, but because there is nothing worth staying for.</p>
<h2>Frequently asked questions</h2>
<h3>How small a gap can a mouse get through?</h3><p>About 6 mm — roughly the width of a pencil. Rats need around 20 mm. Assume any gap you can see from outside is usable.</p>
<h3>Do ultrasonic repellents work?</h3><p>Evidence is weak. Rodents habituate quickly and the devices do not stop entry. Sealing gaps and removing food sources are far more reliable.</p>
<h3>Is it safe to clean mouse droppings myself?</h3><p>For a small amount, yes, with gloves, a mask and disinfectant, and by dampening the area first so dust does not become airborne. For heavy infestations in a crawlspace or attic, use a professional.</p>
<h3>How long does professional rodent control take?</h3><p>An exclusion visit is usually a single day, with a follow-up check in two to four weeks. Ongoing monitoring is often monthly in high-pressure areas.</p>
<h2>Where to go next</h2><ul><li><a href="/services/pest-control">See pest control options</a></li><li><a href="/blog/termite-warning-signs">Termite warning signs around your home</a></li><li><a href="/blog/furnace-maintenance-checklist">A yearly furnace maintenance checklist</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/rodent-proofing-your-home.svg', 'Illustration of a mouse beside a shield and a house icon',
       'Rodent Proofing: How to Keep Mice Out for Good', 'Mice fit through a gap the width of a pencil. Where to seal, what to seal it with, and why trapping without exclusion means the problem returns in weeks.', 'Exclusion-first rodent control guide with a gap-by-gap sealing checklist.',
       'how to keep mice out of house', 'rodent proofing, signs of mice, rat entry points, mouse droppings, rodent exclusion, pest control cost',
       NULL, 0, '/images/blog/rodent-proofing-your-home.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-15 14:00:00'
  FROM blog_categories c WHERE c.slug = 'pest-control'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'rodent-proofing-your-home';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rodent-proofing-your-home' AND t.slug = 'pest-control';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rodent-proofing-your-home' AND t.slug = 'rodents';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rodent-proofing-your-home' AND t.slug = 'prevention';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rodent-proofing-your-home' AND t.slug = 'sealing';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'rodent-proofing-your-home'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners hearing noises in walls or finding droppings, who want to stop the next rodent rather than just remove this one.' FROM blog_posts b WHERE b.slug = 'rodent-proofing-your-home'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '790 words' FROM blog_posts b WHERE b.slug = 'rodent-proofing-your-home'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See pest control options' FROM blog_posts b WHERE b.slug = 'rodent-proofing-your-home'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/termite-warning-signs
/blog/furnace-maintenance-checklist' FROM blog_posts b WHERE b.slug = 'rodent-proofing-your-home'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a gray mouse with a shield chip, a check chip and a house chip on a sand background.' FROM blog_posts b WHERE b.slug = 'rodent-proofing-your-home'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 19. Kitchen Remodel Costs: A Line-by-Line Breakdown
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'kitchen-remodel-cost-breakdown', 'Kitchen Remodel Costs: A Line-by-Line Breakdown', c.id, 'scheduled',
       'Kitchen budgets rarely fail because of the cabinets. They fail because of what is behind the wall, what was not in the plan, and a contingency that was never set aside.', '<p>A kitchen remodel has an unusual cost profile: the visible parts — cabinets, counters, appliances — are the parts everyone budgets for, while the expensive surprises are invisible — wiring, plumbing, water damage, a floor that was never level.</p>
<p>The breakdown below is the shape of a typical mid-range project. Use it to sanity-check quotes, not to price a specific job, because regional labour rates vary by more than any material in the list.</p>
<h2>The percentage model</h2>
<figure class="article-table"><table><thead><tr><th>Category</th><th>Share of budget</th><th>What it covers</th></tr></thead><tbody><tr><td>Cabinets and hardware</td><td>25–35%</td><td>Boxes, doors, drawer fronts, pulls, soft-close</td></tr><tr><td>Labor and installation</td><td>20–30%</td><td>Demolition, carpentry, plumbing, electrical, tile</td></tr><tr><td>Countertops</td><td>10–15%</td><td>Fabrication, templating, sink and cooktop cut-outs</td></tr><tr><td>Appliances</td><td>10–20%</td><td>Range, fridge, dishwasher, hood, microwave</td></tr><tr><td>Flooring</td><td>5–10%</td><td>Removal, subfloor prep, material, trim</td></tr><tr><td>Backsplash and tile</td><td>4–8%</td><td>Tile, adhesive, grout, waterproofing</td></tr><tr><td>Lighting and electrical</td><td>4–8%</td><td>Recessed lights, under-cabinet, outlets, circuits</td></tr><tr><td>Plumbing</td><td>3–6%</td><td>Sink, faucet, disposal, relocating supply or drain</td></tr><tr><td>Paint, trim and finishing</td><td>3–5%</td><td>Walls, ceiling, door casings, touch-up</td></tr><tr><td>Contingency</td><td>10–20%</td><td>The line item that saves the project</td></tr></tbody></table></figure>
<h2>The four decisions that move the number most</h2>
<p>Moving the sink, moving the range, changing the footprint and changing the layout are the four most expensive decisions in any kitchen, because they trigger plumbing, gas, electrical and sometimes structural work. A ''cosmetic'' remodel keeps services where they are; a ''reconfiguration'' is a different budget entirely.</p>
<p>Cabinet choice is the next biggest lever. Refacing or painting existing boxes typically costs a fraction of new cabinets and delivers most of the visual change. Full custom cabinetry can double the cabinet line of a stock or semi-custom kitchen.</p>
<h2>Behind the wall: the surprises</h2>
<ul><li>Knob-and-tube or aluminum wiring that must be brought up to code when the wall is open.</li><li>A drain that runs through the middle of a cabinet you wanted to remove.</li><li>Water damage around the sink or dishwasher that has rotted the subfloor.</li><li>No proper venting for the range hood, requiring a new roof or wall penetration.</li><li>Asbestos-containing floor tile or mastic in older homes, which requires licensed abatement.</li><li>An undersized electrical panel that cannot carry new appliance circuits.</li></ul>
<blockquote><p>Open a wall before you sign a fixed-price contract if the house is older than about 40 years. A half-day of exploratory work can prevent a five-figure change order.</p></blockquote>
<h2>What a contingency is really for</h2>
<p>Ten percent is the minimum for a cosmetic kitchen; twenty percent is realistic for anything involving a wall, a service relocation or a house older than 1960. The contingency is not padding — it is the mechanism that lets you make a decision on day nine instead of stopping work for two weeks while you find more money.</p>
<p>If the contingency is unused at the end, it becomes the budget for the thing you actually wanted: better lighting, a pantry, or the patio door.</p>
<h2>Where the money is worth spending</h2>
<ol><li>Drawers over doors in base cabinets — daily usability beats any finish.</li><li>Task lighting under the upper cabinets and at the sink.</li><li>A quiet, correctly sized range hood ducted outside.</li><li>A single sink with a good faucet over a divided sink with a cheap one.</li><li>Durable flooring that tolerates water and dropped pans.</li><li>Soft-close hinges and full-extension drawer slides — cheap, transformative.</li></ol>
<h2>Resale: what actually returns</h2>
<p>Kitchen remodels consistently rank among the higher-return interior projects, but rarely at 100%. A minor kitchen remodel — refaced cabinets, new counters, updated appliances — typically returns more per dollar than a high-end gut renovation, because the expensive end of the market is a smaller pool of buyers.</p>
<p>The practical rule: spend where a buyer will look first (counters, cabinets, lighting) and avoid personal statement pieces that narrow the audience.</p>
<h2>Frequently asked questions</h2>
<h3>How much does a kitchen remodel cost?</h3><p>It ranges enormously by region and scope. The useful approach is to price the four big lines — cabinets, labour, counters, appliances — then add contingency. Any quote significantly below the others usually has a line missing.</p>
<h3>Is it cheaper to reface cabinets than replace them?</h3><p>Usually substantially cheaper, provided the boxes are square and the layout works. Refacing plus new counters and lighting can deliver most of the visual impact for a fraction of a full replacement.</p>
<h3>How much should a kitchen remodel contingency be?</h3><p>At least 10% for cosmetic work, 15–20% when walls are being opened or services moved, and more for older homes with unknown wiring or plumbing.</p>
<h3>Do I need permits for a kitchen remodel?</h3><p>Almost always for electrical, plumbing, gas or structural changes, and often for a full gut. Permits trigger inspections that protect you at resale — ask the contractor who pulls them.</p>
<h2>Where to go next</h2><ul><li><a href="/services/kitchen-remodeling">See kitchen remodeling options</a></li><li><a href="/blog/kitchen-remodel-timeline">How long does a kitchen remodel take?</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/kitchen-remodel-cost-breakdown.svg', 'Illustration of a kitchen counter with cabinets, a coin and a measuring ruler',
       'Kitchen Remodel Cost Breakdown: Where the Money Goes', 'Cabinets, counters, labor, appliances and contingency: a realistic percentage breakdown of a kitchen remodel budget and the decisions that swing it most.', 'Percentage-based kitchen remodel budget model with cost drivers and a contingency guide.',
       'kitchen remodel cost', 'kitchen renovation budget, how much does a kitchen remodel cost, kitchen cabinet cost, kitchen remodel ROI, mid-range kitchen remodel, kitchen labor cost',
       NULL, 0, '/images/blog/kitchen-remodel-cost-breakdown.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-16 14:00:00'
  FROM blog_categories c WHERE c.slug = 'kitchen-remodeling'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'kitchen-remodel-cost-breakdown';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-cost-breakdown' AND t.slug = 'kitchen-remodeling';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-cost-breakdown' AND t.slug = 'budget';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-cost-breakdown' AND t.slug = 'planning';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-cost-breakdown' AND t.slug = 'contractors';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-cost-breakdown'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners planning a kitchen project who need a realistic budget before requesting quotes.' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-cost-breakdown'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '849 words' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-cost-breakdown'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See kitchen remodeling options' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-cost-breakdown'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/kitchen-remodel-timeline
/blog/how-to-compare-home-service-estimates
/blog/questions-to-ask-before-hiring-a-home-service-professional' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-cost-breakdown'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a kitchen counter with base cabinets, a coin chip and a ruler chip on a sand background.' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-cost-breakdown'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 20. How Long Does a Kitchen Remodel Take?
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'kitchen-remodel-timeline', 'How Long Does a Kitchen Remodel Take?', c.id, 'scheduled',
       'The construction is usually the shortest part. Design, ordering and inspection hold the schedule — and cabinet lead time is the single biggest variable in the whole project.', '<p>Ask how long a kitchen takes and most people answer with the construction phase: four to eight weeks. The honest answer is that the project starts when you choose a layout, and the calendar is dominated by ordering, permits and inspections rather than by sawdust.</p>
<p>Here is what a realistic schedule looks like, and where the delays usually come from.</p>
<h2>Phase 1: design and decisions (2–6 weeks)</h2>
<p>This is where the project is actually won or lost. Layout, appliance models and cabinet specifications all have to be fixed before anything can be ordered, and every change after that point ripples through the schedule.</p>
<p>Use this phase to make the boring decisions too: outlet positions, lighting circuits, where the bin goes, whether the microwave is built in. Undecided details become delays later.</p>
<h2>Phase 2: permits and ordering (2–8 weeks, often in parallel)</h2>
<figure class="article-table"><table><thead><tr><th>Item</th><th>Typical lead time</th><th>Notes</th></tr></thead><tbody><tr><td>Building permit</td><td>1–3 weeks</td><td>Varies widely by jurisdiction</td></tr><tr><td>Semi-custom cabinets</td><td>4–8 weeks</td><td>The usual critical path</td></tr><tr><td>Custom cabinets</td><td>8–14 weeks</td><td>Order before demolition, not after</td></tr><tr><td>Countertop fabrication</td><td>1–3 weeks after templating</td><td>Templated only after cabinets are set</td></tr><tr><td>Appliances</td><td>1–12 weeks</td><td>Check stock as well as lead time</td></tr><tr><td>Tile and flooring</td><td>3 days–3 weeks</td><td>Order 10–15% overage and keep spares</td></tr></tbody></table></figure>
<blockquote><p>Never order cabinets based on a delivery date you have not seen in writing. A single delayed cabinet run can hold the entire project for a month, and nothing else can proceed without it.</p></blockquote>
<h2>Phase 3: demolition and rough-in (1–2 weeks)</h2>
<p>Demolition is fast; what follows is not. Rough-in — plumbing, electrical, gas and HVAC — happens after the walls are open and before any board goes back, and it is when hidden problems surface: a corroded drain, knob-and-tube wiring, or a joist exactly where a recessed light needs to go.</p>
<p>Inspections typically happen at rough-in and again at final. Build them into the schedule rather than treating them as a formality; a failed inspection can add days waiting for a reinspection slot.</p>
<h2>Phase 4: drywall, flooring, cabinets (2–3 weeks)</h2>
<ol><li>Insulation, drywall, taping and sanding — allow time for dust to settle and for paint.</li><li>Flooring in most sequences, with protection boards over it.</li><li>Cabinet installation and levelling: everything downstream depends on this being right.</li><li>Template for countertops — nothing moves until the template is taken.</li><li>Countertop fabrication and install, usually 1–3 weeks after templating.</li></ol>
<h2>Phase 5: finishing and punch list (1–2 weeks)</h2>
<p>Tile, plumbing trim, appliance connection, lighting, paint touch-ups, backsplash grouting. This phase always feels slower than it should because it is a sequence of small trades waiting on each other.</p>
<p>Hold back a final payment until the punch list is complete, and walk the room with the contractor using a written list rather than memory.</p>
<h2>Where the schedule actually slips</h2>
<ul><li>A late change to cabinet layout after order — often the single most expensive delay.</li><li>Backordered appliances discovered at installation rather than at ordering.</li><li>Countertop templating before cabinets are final, producing a misfit and a remake.</li><li>Hidden damage behind a wall that needs a change order and a decision.</li><li>Inspection scheduling, especially in busy jurisdictions or at holiday periods.</li><li>Homeowner decisions deferred to the day the trade needs them.</li></ul>
<h2>Living through it</h2>
<p>Set up a temporary kitchen before demolition: microwave, kettle, a small fridge, and a washing-up station in a bathroom or laundry. Move the essentials out of the work zone and seal the doorway with plastic and tape to keep dust out of the rest of the house.</p>
<p>Plan for the middle two weeks to be the hardest. If the household can be away for part of it, the project is easier on everyone and often finishes faster.</p>
<h2>Frequently asked questions</h2>
<h3>Can a kitchen be remodeled in two weeks?</h3><p>Only a cosmetic refresh with no layout change, no new cabinets and no permit work. Anything involving cabinets, counters or services takes longer because of fabrication and inspection.</p>
<h3>What is the longest lead time in a kitchen remodel?</h3><p>Cabinets, usually. Custom cabinetry can take 8–14 weeks, which is why the order should be placed before demolition begins.</p>
<h3>Do I need to move out during a kitchen remodel?</h3><p>Most families stay, using a temporary kitchen elsewhere in the house. Moving out shortens the practical timeline and reduces stress, but it is not usually necessary.</p>
<h3>How long does countertop installation take?</h3><p>Fabrication is typically 1–3 weeks after templating, and installation itself is a single day for most kitchens.</p>
<h2>Where to go next</h2><ul><li><a href="/services/kitchen-remodeling">See kitchen remodeling options</a></li><li><a href="/blog/kitchen-remodel-cost-breakdown">Kitchen remodel costs: a line-by-line breakdown</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/kitchen-remodel-timeline.svg', 'Illustration of a calendar with a clock and a wrench',
       'How Long Does a Kitchen Remodel Take? A Real Timeline', 'A week-by-week kitchen remodel schedule: design, permits, demolition, rough-in, cabinets, counters and punch list, plus the delays that are predictable.', 'Phase-by-phase kitchen remodel schedule with typical durations and critical-path risks.',
       'how long does a kitchen remodel take', 'kitchen remodel timeline, kitchen renovation schedule, cabinet lead time, kitchen remodel delays, living without a kitchen, kitchen remodel phases',
       NULL, 0, '/images/blog/kitchen-remodel-timeline.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-17 14:00:00'
  FROM blog_categories c WHERE c.slug = 'kitchen-remodeling'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'kitchen-remodel-timeline';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-timeline' AND t.slug = 'kitchen-remodeling';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-timeline' AND t.slug = 'planning';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-timeline' AND t.slug = 'project-management';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'kitchen-remodel-timeline' AND t.slug = 'timeline';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-timeline'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners scheduling a kitchen project who need to plan around work, family and a temporary kitchen.' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-timeline'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '805 words' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-timeline'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See kitchen remodeling options' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-timeline'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/kitchen-remodel-cost-breakdown
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-timeline'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a calendar with a clock chip and a wrench chip on a cream background.' FROM blog_posts b WHERE b.slug = 'kitchen-remodel-timeline'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 21. Bathroom Remodel Planning Checklist
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'bathroom-remodel-planning-checklist', 'Bathroom Remodel Planning Checklist', c.id, 'scheduled',
       'Bathrooms go wrong in the order decisions are made. Tile is the last thing to choose and the first thing people pick — then the drain will not fit and the fan cannot vent.', '<p>A bathroom is the smallest room in the house and has the highest concentration of systems: water supply, waste, electricity, ventilation and waterproofing in a space the size of a parking bay. Almost every expensive mistake comes from deciding finishes before deciding how the room works.</p>
<p>Use the sequence below. It is ordered so that each decision constrains the next rather than contradicting it.</p>
<h2>1. Fix the layout before anything else</h2>
<p>Moving a toilet or a shower drain is the most expensive change you can make in a bathroom, because it involves cutting structure and re-sloping waste pipe. Keeping the fixtures where they are frees budget for everything else.</p>
<p>If you do move them, confirm the waste run and the joist direction before demolition. A toilet that needs a 2% fall over a certain distance may not go where the drawing says it will.</p>
<h2>2. Ventilation is not optional</h2>
<p>Every bathroom needs mechanical ventilation — an openable window does not count in most codes. The fan should be sized to the room and ducted to the outside, not into the attic or a wall cavity.</p>
<p>A fan ducted into the attic is one of the most common causes of hidden mold: warm moist air condenses on cold roof decking and the problem is invisible from the bathroom.</p>
<blockquote><p>Choose a fan rated for continuous or intermittent operation with a low sone rating, and put it on a timer or a humidity sensor. A quiet fan runs longer, and running longer is what actually removes moisture.</p></blockquote>
<h2>3. Waterproofing, then tile</h2>
<p>The single most common failure in a tiled shower is not the tile or the grout — it is a missing or discontinuous membrane behind them. Once water is behind the tile, everything in the assembly is wet and the repair is a full rebuild.</p>
<figure class="article-table"><table><thead><tr><th>Area</th><th>What is required</th></tr></thead><tbody><tr><td>Shower walls</td><td>Cement board or backer board plus a bonded waterproof membrane</td></tr><tr><td>Shower floor</td><td>Pre-sloped mortar bed, waterproof membrane, proper drain flange</td></tr><tr><td>Tub surround</td><td>Waterproof backer to at least the showerhead height</td></tr><tr><td>Bathroom floor</td><td>Water-resistant underlayment; waterproofing mandatory in wet rooms</td></tr><tr><td>Behind a freestanding tub</td><td>Sealed, splash-rated wall finish, not standard drywall</td></tr><tr><td>Niches and benches</td><td>Membrane continuity and sealed penetrations</td></tr></tbody></table></figure>
<h2>4. Electrical and lighting</h2>
<ul><li>All bathroom circuits need GFCI protection, and receptacles must be positioned away from water sources.</li><li>Plan layers of light: general, task at the mirror, and a soft light for night use.</li><li>Light at the mirror should come from the sides, not straight above, to avoid shadows.</li><li>If you add a heated floor or a towel rail, its circuit belongs in the plan now, not later.</li><li>Confirm exhaust fan location so it does not fight the supply air.</li></ul>
<h2>5. Storage and the boring details</h2>
<p>Decide where everything lives before you choose vanity size: towels, cleaning products, a step stool, spare toilet rolls. A vanity with drawers usually stores more usefully than one with doors and a shelf.</p>
<p>Consider the door swing. An outswing or a pocket door can free enough space for a larger vanity in a small room, and a shower door that opens outward is safer in an emergency.</p>
<h2>6. Budget lines people forget</h2>
<ol><li>Permit and inspection fees.</li><li>Waterproofing materials — often more than the tile itself.</li><li>Plumbing and electrical rough-in, especially if anything moves.</li><li>Tile overage: order 10–15% extra, plus a few spares for future repairs.</li><li>Disposal of demolition waste.</li><li>A contingency of 10–15% for what is behind the wall.</li><li>The finishing items: mirrors, towel bars, shower screen, seals.</li></ol>
<h2>7. Sequence for the build</h2>
<p>Demolition, then rough-in and inspection, then waterproofing and flood test, then tile, then fixtures, then paint and trim. The flood test — filling the shower pan and leaving it 24 hours — is the step people skip and regret.</p>
<p>Photograph the open walls before they close. Ten years later, when someone needs to know where a supply line runs, those photos are worth more than the drawings.</p>
<h2>Frequently asked questions</h2>
<h3>Do I need a permit for a bathroom remodel?</h3><p>Usually for any plumbing, electrical or structural change, and for a full gut. Cosmetic work such as replacing a vanity, tile or fixtures in the same location often does not require one — confirm with your local building department.</p>
<h3>How long does a bathroom remodel take?</h3><p>A full remodel typically takes three to six weeks on site, with tile and waterproofing driving the schedule. A cosmetic refresh can be done in under a week.</p>
<h3>Can I tile over existing tile?</h3><p>Sometimes, if the substrate is sound and the added height does not break thresholds or fixtures. In a wet area it is usually a false economy, because you cannot inspect or waterproof the layer underneath.</p>
<h3>How much ventilation does a bathroom need?</h3><p>A fan sized to the room''s volume, ducted outside, running long enough to clear the moisture — typically 20 minutes after a shower. Humidity-sensing or timer fans handle that automatically.</p>
<h2>Where to go next</h2><ul><li><a href="/services/bathroom-remodeling">See bathroom remodeling options</a></li><li><a href="/blog/small-bathroom-remodel-that-adds-value">Small bathroom remodels that add value</a></li><li><a href="/blog/hidden-mold-after-a-leak">Hidden mold after a leak: what to look for</a></li><li><a href="/blog/kitchen-remodel-cost-breakdown">Kitchen remodel costs: a line-by-line breakdown</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/bathroom-remodel-planning-checklist.svg', 'Illustration of a shower head with a checklist and a measuring ruler',
       'Bathroom Remodel Planning Checklist (Step by Step)', 'Decide layout, ventilation and waterproofing before you choose tile. A 12-point bathroom remodel checklist that prevents the expensive rework.', '12-step bathroom remodel planning sequence with waterproofing and ventilation requirements.',
       'bathroom remodel checklist', 'bathroom renovation planning, bathroom waterproofing, bathroom ventilation, bathroom remodel cost, small bathroom layout, bathroom permit',
       NULL, 0, '/images/blog/bathroom-remodel-planning-checklist.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-18 14:00:00'
  FROM blog_categories c WHERE c.slug = 'bathroom-remodeling'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'bathroom-remodel-planning-checklist';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'bathroom-remodel-planning-checklist' AND t.slug = 'bathroom-remodeling';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'bathroom-remodel-planning-checklist' AND t.slug = 'planning';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'bathroom-remodel-planning-checklist' AND t.slug = 'waterproofing';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'bathroom-remodel-planning-checklist' AND t.slug = 'ventilation';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'bathroom-remodel-planning-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners planning a bathroom renovation who want a decision order that avoids rework.' FROM blog_posts b WHERE b.slug = 'bathroom-remodel-planning-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '898 words' FROM blog_posts b WHERE b.slug = 'bathroom-remodel-planning-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See bathroom remodeling options' FROM blog_posts b WHERE b.slug = 'bathroom-remodel-planning-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/small-bathroom-remodel-that-adds-value
/blog/hidden-mold-after-a-leak
/blog/kitchen-remodel-cost-breakdown' FROM blog_posts b WHERE b.slug = 'bathroom-remodel-planning-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a shower head with falling water, a checklist chip and a ruler chip on a cream background.' FROM blog_posts b WHERE b.slug = 'bathroom-remodel-planning-checklist'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 22. Small Bathroom Remodels That Add Value
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'small-bathroom-remodel-that-adds-value', 'Small Bathroom Remodels That Add Value', c.id, 'scheduled',
       'In a small bathroom, value comes from usable space and good light, not from expensive tile. These are the moves that change how a compact room feels and what it is worth.', '<p>A small bathroom has less room for error than any other project: every centimeter of wasted depth reads as clutter, and every dark corner makes the room feel smaller than it is. The good news is that the highest-impact changes are also among the cheapest.</p>
<p>Ranked below from least to most disruptive, with an honest note on which ones actually move resale value.</p>
<h2>Start with light, because it is the cheapest change</h2>
<ul><li>Replace a single ceiling fixture with two or three layers: a general light, a mirror light and a soft night light.</li><li>Move the mirror light to the sides of the mirror rather than above it — faces look better and the room feels wider.</li><li>Use a mirror that reaches near the ceiling to add visual height.</li><li>Swap a dated shade or diffuser for a clean, bright one; it changes the whole room for very little.</li><li>Consider a skylight or a solar tube if the ceiling allows it — the single biggest transformation per dollar in a windowless bathroom.</li></ul>
<h2>Then storage, because clutter shrinks a room</h2>
<p>A shallow recessed niche in the shower wall, a medicine cabinet that sits inside the wall rather than on it, and a vanity with drawers instead of a shelf will together add more usable storage than a larger cabinet would.</p>
<p>Look for dead space: the gap above the toilet, the wall beside the vanity, the space between studs. A 100 mm deep recess holds more than it sounds like.</p>
<h2>The layout moves worth paying for</h2>
<figure class="article-table"><table><thead><tr><th>Change</th><th>Impact</th><th>Disruption</th></tr></thead><tbody><tr><td>Glass screen instead of a shower curtain</td><td>High — makes the room read larger</td><td>Low</td></tr><tr><td>Wall-hung vanity</td><td>High — floor visible under it</td><td>Medium (waste relocation)</td></tr><tr><td>Pocket or outswing door</td><td>High in very small rooms</td><td>Medium</td></tr><tr><td>Walk-in shower replacing a tub-shower</td><td>High for daily use, mixed at resale</td><td>High</td></tr><tr><td>Niche in the shower wall</td><td>Medium-high</td><td>Medium</td></tr><tr><td>Frameless mirror to the ceiling</td><td>Medium-high</td><td>Low</td></tr></tbody></table></figure>
<blockquote><p>Keep at least one bathtub in the house if you have children or plan to sell to families. Removing the only tub can narrow the buyer pool more than the nicer shower widens it.</p></blockquote>
<h2>Where to save, where not to</h2>
<p>Save on tile you will not touch — a large-format floor tile in a neutral tone looks expensive and costs less than mosaic. Save on the vanity cabinet if the countertop and faucet are good. Do not save on waterproofing, ventilation or the shower valve: those are the items whose failure means rebuilding the room.</p>
<p>A cheap faucet on a good vanity is a visible compromise; a good faucet on a modest vanity reads as quality. Spend where hands and eyes land.</p>
<h2>What actually returns at resale</h2>
<p>Bathrooms matter to buyers mostly as a hygiene and condition signal: a clean, dry, bright bathroom suggests a well-kept house. A mid-range remodel of a small bathroom usually returns a solid share of its cost; a high-end spa bathroom in a modest house rarely does.</p>
<p>The consistently rewarded items are a working fan, no visible mold or water staining, a modern faucet and shower head, good light and adequate storage. None of those require a gut renovation.</p>
<h2>Frequently asked questions</h2>
<h3>Does a bathroom remodel add value?</h3><p>Yes, particularly when it fixes a functional or condition problem such as poor ventilation, dated fixtures or a failing shower. The return is highest on mid-range updates in keeping with the house.</p>
<h3>Should I remove the bathtub to fit a bigger shower?</h3><p>Only if another bathroom in the house has a tub. Families with young children still value a tub, and removing the only one can limit resale.</p>
<h3>What is the cheapest way to make a small bathroom feel bigger?</h3><p>Lighting and a mirror. Better light from two directions, a larger mirror and a lighter wall color typically cost less than any fixture change and have the largest perceived effect.</p>
<h3>Is a skylight worth it in a windowless bathroom?</h3><p>Often yes — a solar tube costs far less than a skylight and delivers most of the daylight. Both require roof work, so plan them alongside any roofing project.</p>
<h2>Where to go next</h2><ul><li><a href="/services/bathroom-remodeling">See bathroom remodeling options</a></li><li><a href="/blog/bathroom-remodel-planning-checklist">Bathroom remodel planning checklist</a></li><li><a href="/blog/kitchen-remodel-cost-breakdown">Kitchen remodel costs: a line-by-line breakdown</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/small-bathroom-remodel-that-adds-value.svg', 'Illustration of a bathtub with a coin and a measuring ruler',
       'Small Bathroom Remodels That Add Value', 'The upgrades that make a compact bathroom feel bigger and worth more: lighting, storage, a glass screen and the layout moves that cost least.', 'Value-focused small bathroom upgrade list ranked by cost per impact.',
       'small bathroom remodel ideas', 'small bathroom renovation, bathroom remodel value, powder room remodel, space saving bathroom, bathroom remodel ROI, small bathroom layout ideas',
       NULL, 0, '/images/blog/small-bathroom-remodel-that-adds-value.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-19 14:00:00'
  FROM blog_categories c WHERE c.slug = 'bathroom-remodeling'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'small-bathroom-remodel-that-adds-value';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'small-bathroom-remodel-that-adds-value' AND t.slug = 'bathroom-remodeling';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'small-bathroom-remodel-that-adds-value' AND t.slug = 'small-spaces';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'small-bathroom-remodel-that-adds-value' AND t.slug = 'home-value';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'small-bathroom-remodel-that-adds-value' AND t.slug = 'budget';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'small-bathroom-remodel-that-adds-value'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with a compact bathroom or powder room who want the changes that improve daily use and resale without a full gut.' FROM blog_posts b WHERE b.slug = 'small-bathroom-remodel-that-adds-value'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '748 words' FROM blog_posts b WHERE b.slug = 'small-bathroom-remodel-that-adds-value'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See bathroom remodeling options' FROM blog_posts b WHERE b.slug = 'small-bathroom-remodel-that-adds-value'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/bathroom-remodel-planning-checklist
/blog/kitchen-remodel-cost-breakdown' FROM blog_posts b WHERE b.slug = 'small-bathroom-remodel-that-adds-value'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a bathtub with a coin chip, a ruler chip and a star chip on a warm sand background.' FROM blog_posts b WHERE b.slug = 'small-bathroom-remodel-that-adds-value'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 23. Window Replacement: Cost and the Signs It Is Time
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'window-replacement-cost-and-signs', 'Window Replacement: Cost and the Signs It Is Time', c.id, 'scheduled',
       'Most windows are replaced years before they needed to be — and a few are replaced years after they should have been. The difference is knowing which failure you are looking at.', '<p>A window is a hole in an insulated wall, and it is judged on three things: whether it keeps weather out, whether it opens and closes, and whether it looks right. Each of those fails differently, and only some failures justify replacement.</p>
<p>Here is how to tell what is actually wrong, what replacement costs, and why the installer matters more than the window.</p>
<h2>The five real signs of failure</h2>
<ul><li>Seals between the panes have failed: fogging, condensation between the glass, or a milky haze that does not clean off.</li><li>Drafts you can feel at the frame or the meeting rail, not just at the edges of a worn seal.</li><li>Rotten or soft wood in the frame or sill — the window is no longer structurally sound.</li><li>Sashes that will not stay up, will not close flush, or need force to operate.</li><li>Water staining or rot on the interior trim, which usually means the flashing outside has failed.</li></ul>
<h2>What is repairable</h2>
<figure class="article-table"><table><thead><tr><th>Problem</th><th>Repairable?</th><th>Typical fix</th></tr></thead><tbody><tr><td>Failed double-glazing seal</td><td>Sometimes</td><td>Replace the glass unit, keep the frame</td></tr><tr><td>Worn weatherstrip</td><td>Yes</td><td>New gaskets and sweeps</td></tr><tr><td>Stiff or drafty sash</td><td>Yes</td><td>Adjust hinges, replace balances</td></tr><tr><td>Painted-shut window</td><td>Yes</td><td>Release and re-finish</td></tr><tr><td>Soft or rotten frame</td><td>Rarely</td><td>Replacement, because the structure has gone</td></tr><tr><td>Failed flashing at the head</td><td>Yes</td><td>Re-flash and seal — this is a wall job, not a window job</td></tr></tbody></table></figure>
<blockquote><p>A window that fogs between the panes has a failed seal, but the frame may be perfectly sound. Replacing just the glass unit is often a fraction of the cost of a full replacement — ask for that option explicitly.</p></blockquote>
<h2>What drives the price</h2>
<ol><li>Size and number of openings — cost is quoted per window, so the count matters more than any single unit.</li><li>Frame material: vinyl is the cheapest, wood and aluminum-clad are higher, fibreglass sits between.</li><li>Glass specification: double or triple, low-E coatings, argon fill, laminated glass in hazardous locations.</li><li>Installation method: insert replacement into an existing frame is cheaper than a full-frame replacement with new flashing and trim.</li><li>Access and story count: second-floor and above adds labour and sometimes scaffolding.</li><li>Trim, interior casing and exterior capping, which are often excluded from the headline price.</li><li>Permits and any required egress compliance in bedrooms.</li></ol>
<h2>Why the installer matters more than the window</h2>
<p>A premium window installed with compressed insulation, no sill pan and caulk instead of flashing will leak. A mid-range window installed with a proper sill pan, back-dammed flashing and a sealed air barrier will outperform it for decades.</p>
<p>Ask specifically: is there a sill pan, how is the rough opening flashed, what insulation goes in the gap, and is the interior air-sealed as well as the exterior. A contractor who answers those four questions precisely knows what they are doing.</p>
<h2>Does replacement pay for itself?</h2>
<p>Through energy savings alone, almost never on a normal timeline. The payback on a full house of new windows is measured in decades in most climates. The honest case for replacement is comfort, condensation control, noise, operation, appearance and the condition of the frames.</p>
<p>Where the case is stronger: single-pane windows in a cold climate, windows with failed seals throughout, or a home being re-sided anyway, when the incremental cost of doing windows at the same time drops significantly.</p>
<h2>How to compare quotes</h2>
<ul><li>Price per opening, with the same glass specification in every quote.</li><li>Installation method stated in writing: insert or full-frame.</li><li>Flashing and sill pan details included, not optional.</li><li>Whether interior trim, exterior capping and disposal are included.</li><li>Warranty split between glass, frame and labour, with the labour warranty period in writing.</li><li>Whether the company uses its own installers or subcontracts.</li></ul>
<h2>Frequently asked questions</h2>
<h3>How long do replacement windows last?</h3><p>Vinyl windows typically last 20–25 years, wood and aluminum-clad 25–30, and fibreglass longer. Sealed glass units often fail before the frame does, usually within 10–20 years.</p>
<h3>Can I replace just the glass in a fogged window?</h3><p>Often yes, if the frame and sash are sound. It is usually much cheaper than a full replacement, though not every manufacturer supports glass-only swaps on older units.</p>
<h3>Do new windows stop condensation?</h3><p>They reduce it, because warmer interior glass surfaces condense less. If condensation persists on new windows, the underlying issue is indoor humidity or ventilation, not the glass.</p>
<h3>Is window replacement worth it before selling?</h3><p>Only if the windows are visibly failing or a home inspection flags them. Buyers discount for obvious problems; they rarely pay a premium for windows replaced shortly before listing.</p>
<h2>Where to go next</h2><ul><li><a href="/services/window-installation">See window installation options</a></li><li><a href="/blog/energy-efficient-windows-guide">Energy efficient windows: what the ratings mean</a></li><li><a href="/blog/front-door-replacement-guide">Front door replacement guide</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/window-replacement-cost-and-signs.svg', 'Illustration of a four-pane window with a coin and a measuring ruler',
       'Window Replacement Cost and When to Replace', 'Fogged glass, drafts and hard-to-open sashes: when a window is repairable, when it has failed, and what replacement actually costs per opening.', 'Repair-versus-replace guide for windows with cost drivers and installation quality checks.',
       'window replacement cost', 'replace windows, signs you need new windows, window installation cost, double glazing, window condensation, window replacement ROI',
       NULL, 0, '/images/blog/window-replacement-cost-and-signs.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-20 14:00:00'
  FROM blog_categories c WHERE c.slug = 'window-installation'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'window-replacement-cost-and-signs';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'window-replacement-cost-and-signs' AND t.slug = 'windows';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'window-replacement-cost-and-signs' AND t.slug = 'replacement';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'window-replacement-cost-and-signs' AND t.slug = 'energy';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'window-replacement-cost-and-signs' AND t.slug = 'budget';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'window-replacement-cost-and-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with drafty, foggy or difficult windows deciding between repair and replacement.' FROM blog_posts b WHERE b.slug = 'window-replacement-cost-and-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '824 words' FROM blog_posts b WHERE b.slug = 'window-replacement-cost-and-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See window installation options' FROM blog_posts b WHERE b.slug = 'window-replacement-cost-and-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/energy-efficient-windows-guide
/blog/front-door-replacement-guide
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'window-replacement-cost-and-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a four-pane window with a coin chip, a ruler chip and a check chip on a sand background.' FROM blog_posts b WHERE b.slug = 'window-replacement-cost-and-signs'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 24. Energy Efficient Windows: What the Ratings Mean
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'energy-efficient-windows-guide', 'Energy Efficient Windows: What the Ratings Mean', c.id, 'scheduled',
       'The sticker on a window has four numbers that matter and one that sells. Here is how to read them, and why the right specification in Miami is the wrong one in Minneapolis.', '<p>Window efficiency is one of the few areas of home improvement with genuinely standardised labels — and one of the few where the label is routinely misread in a sales conversation.</p>
<p>Four numbers do almost all the work: U-factor, solar heat gain coefficient, visible transmittance and air leakage. Understand those and you can specify a window for your climate rather than accept whatever is on the truck.</p>
<h2>The four numbers</h2>
<p>Note the tension between SHGC and VT: a coating that blocks solar heat also blocks some light. In a hot climate that trade is usually worth it; in a cold climate where winter sun is free heat, a very low SHGC can cost you more than it saves.</p>
<figure class="article-table"><table><thead><tr><th>Rating</th><th>What it measures</th><th>Better is</th></tr></thead><tbody><tr><td>U-factor</td><td>Heat flow through the whole window assembly</td><td>Lower (0.30 or below is good; 0.20 is excellent)</td></tr><tr><td>SHGC</td><td>Fraction of solar heat admitted</td><td>Depends on climate — lower in hot climates, higher in cold</td></tr><tr><td>VT (visible transmittance)</td><td>How much daylight comes through</td><td>Higher for brighter rooms</td></tr><tr><td>Air leakage (AL)</td><td>Air infiltration at a standard pressure difference</td><td>Lower (≤0.3 cfm/ft²)</td></tr></tbody></table></figure>
<h2>Climate changes the specification</h2>
<ul><li>Hot climates: low SHGC matters most, moderate U-factor, consider exterior shading.</li><li>Cold climates: low U-factor first, and a higher SHGC on south-facing glass to harvest winter sun.</li><li>Mixed climates: low U-factor with a moderate SHGC — the balance point depends on heating versus cooling dominance.</li><li>Coastal and humid regions: prioritise air leakage, corrosion-resistant hardware and laminated glass for storm resistance.</li><li>Noisy locations: laminated glass reduces sound noticeably more than extra panes alone.</li></ul>
<h2>Low-E, argon and the third pane</h2>
<p>A low-E coating is a microscopically thin metallic layer that reflects long-wave heat radiation. There are two broad types: a solar-control coating that limits heat gain, and a low-solar-gain version tuned for cold climates that keeps heat in.</p>
<p>Argon or krypton fill slows conduction between the panes; a warm-edge spacer reduces the thermal bridge at the edge, which is where most condensation appears. A third pane helps in very cold climates, but the incremental benefit falls sharply and the weight and cost rise.</p>
<blockquote><p>Where glass surfaces meet a warm, humid interior, condensation is a symptom of the assembly, not the glass. A better spacer and frame usually fixes it more effectively than an extra pane.</p></blockquote>
<h2>Where efficiency upgrades stop paying back</h2>
<p>Windows are a small part of a home''s heat loss compared with attic insulation, air sealing and duct leakage. If your goal is a lower energy bill, spend the first dollars on those — they are cheaper per unit of saving and often far more effective.</p>
<p>The exception is comfort: if a room is unusable in winter because of cold glass and drafts, better windows change how the house feels, which is a legitimate reason even when the payback is long.</p>
<h2>Specifying without being sold to</h2>
<ol><li>Ask for the full ratings label, not just the ENERGY STAR logo.</li><li>Specify U-factor, SHGC and VT in the contract so substitutions can be rejected.</li><li>Confirm the spacer type and the gas fill in writing.</li><li>Check the warranty covers seal failure and for how long.</li><li>Confirm installation details — flashing and air sealing matter more than the numbers on the sticker.</li></ol>
<h2>Frequently asked questions</h2>
<h3>What is a good U-factor for a window?</h3><p>Around 0.30 or lower for most of the US, and 0.20–0.25 in cold climates. Lower is better, but the return diminishes and frame quality becomes the limiting factor.</p>
<h3>Are triple-pane windows worth it?</h3><p>In very cold climates, yes — they improve comfort and reduce condensation. In mild or mixed climates the extra cost rarely pays back compared with air sealing and insulation.</p>
<h3>Does low-E glass block sunlight?</h3><p>It reduces heat gain and some visible light, but modern coatings are selective: they block infrared heat while transmitting most visible light. Check the VT rating for how bright the room will be.</p>
<h3>Are energy efficient windows tax-deductible or rebated?</h3><p>Incentives change frequently and vary by state and utility. Check the ENERGY STAR and local utility sites before ordering, and keep the ratings labels with your receipts.</p>
<h2>Where to go next</h2><ul><li><a href="/services/window-installation">See window installation options</a></li><li><a href="/blog/window-replacement-cost-and-signs">Window replacement: cost and the signs it is time</a></li><li><a href="/blog/furnace-maintenance-checklist">A yearly furnace maintenance checklist</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/energy-efficient-windows-guide.svg', 'Illustration of a window with a sun and a leaf, representing energy efficiency',
       'Energy Efficient Windows: U-Factor, SHGC and Low-E', 'What U-factor, SHGC, VT and low-E coatings actually mean, how climate changes the right specification, and where upgrading glass stops paying back.', 'Plain-English guide to window energy ratings and climate-specific specification choices.',
       'energy efficient windows', 'U-factor, solar heat gain coefficient, low-E glass, ENERGY STAR windows, double vs triple glazing, window efficiency ratings',
       NULL, 0, '/images/blog/energy-efficient-windows-guide.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-21 14:00:00'
  FROM blog_categories c WHERE c.slug = 'window-installation'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'energy-efficient-windows-guide';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'energy-efficient-windows-guide' AND t.slug = 'windows';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'energy-efficient-windows-guide' AND t.slug = 'energy';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'energy-efficient-windows-guide' AND t.slug = 'efficiency';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'energy-efficient-windows-guide' AND t.slug = 'specification';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'energy-efficient-windows-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners specifying new windows who want to understand the labels before a salesperson explains them.' FROM blog_posts b WHERE b.slug = 'energy-efficient-windows-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '751 words' FROM blog_posts b WHERE b.slug = 'energy-efficient-windows-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See window installation options' FROM blog_posts b WHERE b.slug = 'energy-efficient-windows-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/window-replacement-cost-and-signs
/blog/furnace-maintenance-checklist' FROM blog_posts b WHERE b.slug = 'energy-efficient-windows-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a four-pane window with a sun chip, a leaf chip and a gauge chip on a cream background.' FROM blog_posts b WHERE b.slug = 'energy-efficient-windows-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 25. Front Door Replacement Guide
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'front-door-replacement-guide', 'Front Door Replacement Guide', c.id, 'scheduled',
       'A front door is bought for looks and judged on how it closes. The difference between a door that seals for twenty years and one that sticks by winter is almost always the installation, not the slab.', '<p>A front door does more work than any other door in the house: it is the primary security barrier, the largest single air leak in many homes, and the first thing anyone notices about the property.</p>
<p>Replacement is one of the better-value exterior projects, provided the opening is measured correctly and the door is installed with flashing and shimming rather than wedged in and foamed.</p>
<h2>Choose the material first</h2>
<p>For most homes, a fiberglass or insulated steel door delivers the best combination of security, weather performance and price. Wood is beautiful and worth it where the house''s architecture calls for it, but budget for refinishing every few years.</p>
<figure class="article-table"><table><thead><tr><th>Material</th><th>Strengths</th><th>Watch out for</th></tr></thead><tbody><tr><td>Steel</td><td>Strong, affordable, secure, low maintenance</td><td>Dents; rust if the paint film is damaged</td></tr><tr><td>Fiberglass</td><td>Best balance of insulation, durability and look</td><td>Higher cost; quality varies widely</td></tr><tr><td>Wood</td><td>Beautiful, repairable, solid feel</td><td>Needs refinishing; moves with the seasons</td></tr><tr><td>Aluminum with thermal break</td><td>Modern look, excellent for large glazed units</td><td>Conducts heat; must be thermally broken</td></tr><tr><td>Composite</td><td>Stable and low maintenance</td><td>Newer category; check warranty support</td></tr></tbody></table></figure>
<h2>Sizing: measure the opening, not the old door</h2>
<p>Doors are sold by slab size and by rough opening. A replacement that matches the existing frame is a straightforward swap; changing the size means framing work and possibly new trim and siding repair.</p>
<p>Measure the width at three heights and the height at three widths. Older openings are rarely square, and the largest measurement governs the size you need.</p>
<blockquote><p>If the existing door has a storm door, confirm the new door''s hardware and hinge position do not interfere. It is a small detail that causes a surprising number of returns.</p></blockquote>
<h2>Security is in the frame as much as the door</h2>
<ul><li>A solid core and a reinforced strike plate matter more than the number of locks.</li><li>Long screws through the strike plate into the framing — not just the trim — are the single cheapest security upgrade.</li><li>Avoid decorative glass within arm''s reach of the locks unless it is laminated.</li><li>A door viewer and a door limiter are worth more than a chain.</li><li>Hinges on the outside are a vulnerability; use security hinges or a pinned hinge set.</li></ul>
<h2>What a proper installation includes</h2>
<ol><li>Remove the old door and inspect the rough opening for rot, water damage and level.</li><li>Install a sill pan or a fully sealed sill — the most commonly skipped step and the most common cause of a rotted threshold.</li><li>Flash the sides and head, lapping like shingles so water runs out and down.</li><li>Set the door in the opening with shims at hinges, lock and sill, checking plumb, level and square.</li><li>Insulate the perimeter with low-expansion foam or backer rod, not expanding foam that bows the frame.</li><li>Seal the interior air barrier as carefully as the exterior.</li><li>Adjust the strike, test the latch and the deadbolt, and confirm the door closes with a consistent gap.</li></ol>
<h2>What it should cost, roughly</h2>
<p>The door itself is often the smaller half of the invoice. An entry door replacement typically includes removal and disposal, the new unit, hardware, trim, flashing, paint or stain and labour — and a pre-hung unit with a factory frame is usually cheaper to install than hanging a slab in an existing frame.</p>
<p>Comparing quotes means comparing the same door. Ask each contractor to list the specific model, the glass package, the hardware and whether the interior and exterior trim are included.</p>
<h2>Maintenance that keeps it working</h2>
<p>Adjust the hinges and the strike plate if the door starts to rub — most seasonal sticking is alignment, not warping. Check the weatherstripping annually, lubricate the lock cylinder once a year, and touch up any paint chip on a steel door before rust starts.</p>
<p>Keep the threshold clear of debris and confirm water drains away from the sill. Almost every rotted threshold started as a puddle that had nowhere to go.</p>
<h2>Frequently asked questions</h2>
<h3>How long does a front door replacement take?</h3><p>A like-for-like pre-hung replacement is usually a few hours. Resizing the opening or replacing a door in a masonry wall can take a full day or more.</p>
<h3>Is a steel or fiberglass front door better?</h3><p>Fiberglass insulates better, resists dents and can mimic wood grain; steel is cheaper and very strong but dents and can rust if the finish is damaged. Both are good choices — the installation matters more than the difference.</p>
<h3>Should I replace the frame at the same time?</h3><p>If the frame is sound and square, a pre-hung door in a new frame is still usually the better route than reusing old jambs. If there is rot at the sill, replace the frame and repair the flashing.</p>
<h3>Can a new front door reduce my energy bill?</h3><p>It reduces drafts noticeably, which improves comfort, but the bill impact is modest unless the old door was severely leaking. Air sealing the whole envelope delivers more.</p>
<h2>Where to go next</h2><ul><li><a href="/services/door-installation">See door installation options</a></li><li><a href="/blog/rekey-vs-replace-locks">Rekey or replace your locks?</a></li><li><a href="/blog/energy-efficient-windows-guide">Energy efficient windows: what the ratings mean</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/front-door-replacement-guide.svg', 'Illustration of a panelled front door with a key and a security shield',
       'Front Door Replacement Guide: Materials, Cost and Fit', 'Steel, fiberglass or wood, plus the installation details — sill pan, flashing and shimming — that decide whether a new front door seals and lasts.', 'Entry door buying guide covering material comparison, sizing, security and installation standards.',
       'front door replacement', 'new front door cost, steel vs fiberglass door, door installation near me, entry door replacement, door security, door energy efficiency',
       NULL, 0, '/images/blog/front-door-replacement-guide.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-22 14:00:00'
  FROM blog_categories c WHERE c.slug = 'door-installation'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'front-door-replacement-guide';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'front-door-replacement-guide' AND t.slug = 'doors';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'front-door-replacement-guide' AND t.slug = 'replacement';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'front-door-replacement-guide' AND t.slug = 'security';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'front-door-replacement-guide' AND t.slug = 'energy';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'front-door-replacement-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners replacing an entry door and weighing material, security and installation quality.' FROM blog_posts b WHERE b.slug = 'front-door-replacement-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '892 words' FROM blog_posts b WHERE b.slug = 'front-door-replacement-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See door installation options' FROM blog_posts b WHERE b.slug = 'front-door-replacement-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/rekey-vs-replace-locks
/blog/energy-efficient-windows-guide
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'front-door-replacement-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a panelled entry door with a key chip, a ruler chip and a star chip on a sand background.' FROM blog_posts b WHERE b.slug = 'front-door-replacement-guide'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 26. Driveway Replacement Cost: What You Are Actually Paying For
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'driveway-replacement-cost', 'Driveway Replacement Cost: What You Are Actually Paying For', c.id, 'scheduled',
       'Two quotes for the same driveway can differ by thousands because one includes six inches of compacted base and the other includes four. Here is what you are actually buying.', '<p>A driveway is priced by area, but it is built from layers. The visible slab is the cheapest part of the job; the excavation, the base and the drainage are where the money goes and where the quality lives.</p>
<p>That is why two quotes for the same square footage can be thousands apart and both be honest. They are not quoting the same driveway.</p>
<h2>What a proper driveway is made of</h2>
<ol><li>Excavation — remove the old surface and enough soil to reach a stable subgrade.</li><li>Base — typically 4–6 inches of compacted crushed stone, in lifts, not one thick layer.</li><li>Compaction — plate or roller compaction at each lift, tested for density.</li><li>Reinforcement — mesh or rebar, placed on chairs in the middle of the slab, not on the ground.</li><li>Concrete — commonly 4 inches for cars, 5–6 inches where trucks or RVs park.</li><li>Joints — control joints at regular intervals and isolation joints at walls and existing concrete.</li><li>Curing and sealing — damp curing, then a sealer after the slab has cured.</li></ol>
<h2>The four things that decide whether it lasts</h2>
<figure class="article-table"><table><thead><tr><th>Detail</th><th>Good practice</th><th>What failing looks like</th></tr></thead><tbody><tr><td>Base depth</td><td>4–6 inches compacted crushed stone</td><td>Cracks and settlement within two winters</td></tr><tr><td>Drainage</td><td>Slope away from the house and garage, no ponding</td><td>Standing water and heaving at the edges</td></tr><tr><td>Joint spacing</td><td>Control joints every 8–10 feet, cut to depth</td><td>Random cracking across the slab</td></tr><tr><td>Thickness</td><td>4 inches minimum, thicker where loaded</td><td>Spider cracks and edge break-up</td></tr></tbody></table></figure>
<blockquote><p>Ask how the subgrade is prepared and whether the base is compacted in lifts. A contractor who cannot explain compaction in layers is planning to pour on whatever is there.</p></blockquote>
<h2>Concrete or asphalt?</h2>
<p>Concrete costs more upfront, lasts longer, handles heat and heavy loads better and needs less routine maintenance. Asphalt is cheaper, faster to install and easier to patch, but needs resealing every few years and has a shorter life.</p>
<p>In cold climates, both depend on drainage. A base that holds water will destroy either surface, and freeze-thaw cycles find every weak spot.</p>
<h2>What changes the price most</h2>
<ul><li>Area — cost scales almost linearly, so measure before you call.</li><li>Removal and disposal of the old driveway, including hauling.</li><li>Access — a narrow side yard or a gate that excludes a truck adds labour.</li><li>Base work — deep excavation or poor soil means importing and compacting stone.</li><li>Slope and drainage — grading, retaining and drainage channels.</li><li>Decorative finishes — exposed aggregate, stamped or colored concrete add real cost.</li><li>Permits and any right-of-way requirements for the apron.</li></ul>
<h2>Cheap shortcuts and how they show up</h2>
<p>Pouring over an existing slab, skipping the base, using fibre mesh instead of steel, placing mesh on the dirt, or pouring too thin in hot weather all look fine on the day. They show up as cracks and settlement two or three winters later — usually just outside the workmanship warranty.</p>
<p>A written scope that names base depth, slab thickness, reinforcement type and joint spacing is the single best protection you have.</p>
<h2>Maintenance that keeps it looking new</h2>
<p>Seal a new concrete driveway after 28 days, then every two to three years. Keep joints clear, keep water running away from the house, and avoid de-icing salt in the first winter — it accelerates surface scaling.</p>
<p>Repair small cracks promptly with a flexible sealant. Water in a crack freezes, widens it, and turns a two-dollar repair into a slab replacement.</p>
<h2>Frequently asked questions</h2>
<h3>How much does a driveway replacement cost?</h3><p>Cost is driven by area, thickness, base work and finish. Ask for a quote that itemises removal, base, concrete and finishing so you can compare like for like rather than a single lump sum.</p>
<h3>How thick should a concrete driveway be?</h3><p>Four inches is the common minimum for passenger cars, with 5–6 inches where heavier vehicles park. The base beneath matters just as much as the slab thickness.</p>
<h3>How long does a concrete driveway last?</h3><p>A properly built one lasts 25–30 years or more with sealing and drainage maintained. Most early failures are base or drainage problems rather than the concrete itself.</p>
<h3>Can I pour a new driveway over the old one?</h3><p>Occasionally, if the old slab is sound and drainage allows the added height, but it usually shortens the life of the new surface and can trap water against the house. Full removal is the better long-term choice.</p>
<h2>Where to go next</h2><ul><li><a href="/services/concrete-paving">See concrete and paving options</a></li><li><a href="/blog/concrete-repair-vs-replace">Concrete repair or replace?</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/driveway-replacement-cost.svg', 'Illustration of a concrete driveway slab with a coin and a ruler',
       'Driveway Replacement Cost: A Realistic Breakdown', 'What a driveway replacement includes — removal, base, thickness, reinforcement, joints and sealing — and the shortcuts that show up three winters later.', 'Cost-driver breakdown for driveway replacement with a base-and-joint quality checklist.',
       'driveway replacement cost', 'concrete driveway cost, asphalt vs concrete driveway, driveway resurfacing, driveway removal cost, concrete slab thickness, paving contractor',
       NULL, 0, '/images/blog/driveway-replacement-cost.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-23 14:00:00'
  FROM blog_categories c WHERE c.slug = 'concrete-paving'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'driveway-replacement-cost';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'driveway-replacement-cost' AND t.slug = 'concrete';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'driveway-replacement-cost' AND t.slug = 'driveways';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'driveway-replacement-cost' AND t.slug = 'budget';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'driveway-replacement-cost' AND t.slug = 'contractors';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'driveway-replacement-cost'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with a cracked or settling driveway who need to understand what a replacement involves before getting quotes.' FROM blog_posts b WHERE b.slug = 'driveway-replacement-cost'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '805 words' FROM blog_posts b WHERE b.slug = 'driveway-replacement-cost'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See concrete and paving options' FROM blog_posts b WHERE b.slug = 'driveway-replacement-cost'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/concrete-repair-vs-replace
/blog/how-to-compare-home-service-estimates
/blog/questions-to-ask-before-hiring-a-home-service-professional' FROM blog_posts b WHERE b.slug = 'driveway-replacement-cost'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a perspective concrete slab with a coin chip, a ruler chip and a calendar chip on a cream background.' FROM blog_posts b WHERE b.slug = 'driveway-replacement-cost'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 27. Concrete Repair or Replace? How to Judge a Failing Slab
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'concrete-repair-vs-replace', 'Concrete Repair or Replace? How to Judge a Failing Slab', c.id, 'scheduled',
       'Not every crack means a new driveway. The deciding question is whether the slab is still supported — and that is something you can check with a golf ball and a straight edge.', '<p>All concrete cracks. It is a brittle material that shrinks as it cures and moves with the ground beneath it. The presence of a crack tells you very little; its width, its pattern and whether the two sides are still level tell you everything.</p>
<p>This guide separates the three failure modes — cracking, settlement and surface failure — because each has a different set of options.</p>
<h2>Failure one: cracking</h2>
<figure class="article-table"><table><thead><tr><th>What you see</th><th>Likely cause</th><th>Verdict</th></tr></thead><tbody><tr><td>Hairline cracks under 1 mm</td><td>Normal curing shrinkage</td><td>Monitor; seal if water gets in</td></tr><tr><td>Straight cracks at regular intervals</td><td>Control joints doing their job</td><td>Normal, not a defect</td></tr><tr><td>Cracks wider than 3 mm</td><td>Base movement or missing joints</td><td>Repair the cause before sealing</td></tr><tr><td>Spider-web pattern</td><td>Shallow surface shrinkage or over-finishing</td><td>Cosmetic unless spalling follows</td></tr><tr><td>Cracks following a tree line</td><td>Roots and soil moisture change</td><td>Investigate the subgrade</td></tr></tbody></table></figure>
<h2>Failure two: settlement and heaving</h2>
<p>A slab that has dropped on one side creates a trip hazard and holds water. Drop a golf ball on the surface: if it rolls determinedly toward a crack or an edge, the slab has moved. A straight edge across a joint shows the step in millimeters.</p>
<p>Localised settlement can often be lifted — mudjacking or polyurethane foam injection raises the slab and fills the void. This is dramatically cheaper than replacement and works well when the concrete itself is sound. It does not work when the concrete is broken into pieces.</p>
<blockquote><p>Lifting a slab without fixing the drainage that caused the void just postpones the same failure. Ask what is being done about the water.</p></blockquote>
<h2>Failure three: surface damage</h2>
<p>Spalling — flaking and pitting of the top layer — is usually caused by de-icing salt, freeze-thaw cycles, an over-wet mix or finishing too early. Scaling and pop-outs fall into the same family.</p>
<p>Light spalling can be resurfaced with a bonded overlay, which buys years of appearance at modest cost. Deep spalling that exposes aggregate, or that covers most of the slab, is a sign the whole surface is compromised.</p>
<h2>When repair genuinely works</h2>
<ul><li>Isolated cracks cleaned, filled and sealed with a flexible sealant.</li><li>A settled but structurally sound slab lifted by foam or slurry injection.</li><li>Localised spalling patched with a polymer-modified repair mortar.</li><li>A sound slab given a resurfacing overlay for appearance.</li><li>Joint and edge repairs where the failure is at a control joint.</li></ul>
<h2>When replacement is the honest answer</h2>
<ul><li>Cracking through the full thickness in multiple directions — the slab has broken into pieces.</li><li>Settlement across a large area or repeated lifting in the same spot.</li><li>Spalling across most of the surface with exposed aggregate.</li><li>A slab that ponds water against the house or the garage.</li><li>A base that has failed, which cannot be fixed without removing the slab anyway.</li></ul>
<h2>The economics</h2>
<p>As a rule, if the repair cost approaches a third of replacement and the slab is already twenty years old, replacement is the better investment. Lifting or sealing a young slab is almost always worth doing.</p>
<p>Resurfacing deserves a warning: an overlay on a slab that is still moving will crack again within a season. It is a finish, not a structural fix, and it should only go on a slab whose base is stable.</p>
<h2>Frequently asked questions</h2>
<h3>Are cracks in a concrete driveway normal?</h3><p>Hairline cracks and cracks along control joints are normal. Cracks wider than about 3 mm, or ones with a vertical step, indicate movement and should be investigated.</p>
<h3>What is mudjacking?</h3><p>Pumping a slurry or expanding foam under a settled slab to raise it back to level and fill the void beneath. It is faster and cheaper than replacement when the concrete itself is intact.</p>
<h3>Can resurfacing fix a cracked driveway?</h3><p>It can hide cosmetic cracks on a stable slab, but it will not stop movement. On a slab that is still settling, an overlay typically cracks again within a year or two.</p>
<h3>How do I stop concrete from spalling?</h3><p>Avoid de-icing salt in the first winter, seal the surface, keep water draining away, and ensure a proper air-entrained mix was used in cold climates.</p>
<h2>Where to go next</h2><ul><li><a href="/services/concrete-paving">See concrete and paving options</a></li><li><a href="/blog/driveway-replacement-cost">Driveway replacement cost: what you are paying for</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/concrete-repair-vs-replace.svg', 'Illustration of a cracked concrete slab with a wrench and a coin',
       'Concrete Repair or Replace? How to Tell', 'Hairline cracks are normal; differential settlement is not. How to read a failing slab, which repairs work, and when resurfacing is money down the drain.', 'Diagnostic framework for cracked and settled concrete with repair-option comparison.',
       'concrete repair or replace', 'cracked concrete driveway, concrete crack repair, mudjacking, slab lifting, concrete resurfacing, settled concrete',
       NULL, 0, '/images/blog/concrete-repair-vs-replace.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-24 14:00:00'
  FROM blog_categories c WHERE c.slug = 'concrete-paving'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'concrete-repair-vs-replace';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'concrete-repair-vs-replace' AND t.slug = 'concrete';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'concrete-repair-vs-replace' AND t.slug = 'repair';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'concrete-repair-vs-replace' AND t.slug = 'driveways';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'concrete-repair-vs-replace' AND t.slug = 'maintenance';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'concrete-repair-vs-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners with cracked, settled or spalling concrete who want to know which failures are cosmetic.' FROM blog_posts b WHERE b.slug = 'concrete-repair-vs-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '754 words' FROM blog_posts b WHERE b.slug = 'concrete-repair-vs-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See concrete and paving options' FROM blog_posts b WHERE b.slug = 'concrete-repair-vs-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/driveway-replacement-cost
/blog/how-to-compare-home-service-estimates' FROM blog_posts b WHERE b.slug = 'concrete-repair-vs-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a concrete slab with a zigzag crack, a wrench chip and a coin chip on a sand background.' FROM blog_posts b WHERE b.slug = 'concrete-repair-vs-replace'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 28. Rekey or Replace Your Locks?
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'rekey-vs-replace-locks', 'Rekey or Replace Your Locks?', c.id, 'scheduled',
       'Rekeying is cheaper, faster and just as secure for most homes. Replacement is for hardware that is failing, outdated or not worth keeping — and the difference matters.', '<p>Rekeying and replacing are often treated as the same job. They are not. Rekeying changes the pins inside an existing lock so the old key no longer works; replacement changes the whole lock body, handles, and sometimes the door preparation.</p>
<p>For most homeowners who simply need to know that no one else has a key, rekeying is the right answer and costs a fraction of replacement.</p>
<h2>What each one involves</h2>
<figure class="article-table"><table><thead><tr><th></th><th>Rekey</th><th>Replace</th></tr></thead><tbody><tr><td>What changes</td><td>The pins inside the cylinder</td><td>The entire lock and handle set</td></tr><tr><td>Typical cost</td><td>Lower per lock</td><td>Higher per lock, plus hardware</td></tr><tr><td>Time</td><td>Minutes per cylinder</td><td>Longer, especially if the door needs modification</td></tr><tr><td>Security outcome</td><td>Identical to a new lock of the same grade</td><td>Better only if the new hardware is a higher grade</td></tr><tr><td>Best for</td><td>Lost keys, new home, tenant turnover</td><td>Worn locks, broken hardware, upgrades</td></tr></tbody></table></figure>
<h2>Rekey when the hardware is fine</h2>
<p>Rekeying also lets a locksmith key all exterior doors alike — one key for the front, back and side — which is a genuine convenience and often costs little more than rekeying a single cylinder.</p>
<ul><li>You have just moved in and do not know who else has a key.</li><li>A key was lost or stolen, or a roommate or tenant has moved out.</li><li>You want every exterior door on one key instead of a ring of five.</li><li>The locks work smoothly and are a reasonable grade.</li><li>You have bought a home with a builder-grade lock that still functions well.</li></ul>
<h2>Replace when the hardware is the problem</h2>
<ul><li>The lock is loose, wobbly or has a cylinder that turns without engaging.</li><li>The key sticks, or the lock must be jiggled to work — worn pins or a damaged cylinder.</li><li>The door has settled and the lock no longer aligns with the strike.</li><li>The lock is a low-grade builder model on an entry door and you want a deadbolt with a proper ANSI grade.</li><li>You want a smart lock or a keypad, which replaces the hardware by definition.</li><li>There is visible damage from a break-in attempt or forced entry.</li></ul>
<h2>Security grades, in one paragraph</h2>
<p>Deadbolts are graded by ANSI: Grade 3 is builder-grade, Grade 2 is a solid residential step up, Grade 1 is the strongest commonly available. The other half of the equation is installation: a Grade 1 deadbolt held by half-inch screws into a soft frame is weaker than a Grade 2 with a reinforced strike and long screws into the stud.</p>
<p>If you upgrade one thing, upgrade the strike plate and the screws holding it. It is cheap and it addresses the most common way a door is defeated.</p>
<blockquote><p>Never hide a spare key outside. Leave one with a trusted neighbor or use a keypad; a fake rock is the first place anyone looks.</p></blockquote>
<h2>What a locksmith should cost, and what should worry you</h2>
<p>A rekey is usually a service call plus a per-cylinder charge; a replacement adds hardware cost. Ask for the total before work starts, including the service call, and confirm whether the price is per lock or per visit.</p>
<p>Be careful with the companies that dominate emergency-lockout search results. Warning signs: no local address, a call center that will not quote a price, a technician who arrives without identification, and a bill far above the quoted amount once the door is open. Look up the business licence and ask for the total in writing before anyone touches the lock.</p>
<h2>After a break-in or a lost key</h2>
<ol><li>Rekey every exterior lock, not just the one that was used.</li><li>Check the door frame and strike for damage — a kicked door often damages the frame, not the lock.</li><li>Consider a reinforced strike and longer screws while the locksmith is there.</li><li>If the door itself is damaged, read our front door replacement guide before authorising a full replacement.</li><li>Update any insurance records and photographs of the property.</li></ol>
<h2>Frequently asked questions</h2>
<h3>Is rekeying as secure as replacing?</h3><p>Yes, if the existing hardware is in good condition and of a decent grade. Rekeying gives you a brand-new key series; it does not improve the physical strength of the lock.</p>
<h3>How much does rekeying cost?</h3><p>Typically a service call plus a modest charge per cylinder. It is considerably cheaper than replacing locks, which adds hardware cost on top of labour.</p>
<h3>Can I rekey locks myself?</h3><p>On standard cylindrical locksets, yes, with a rekey kit and some patience. On high-security or smart locks, and on any lock you rely on for security, a professional is the safer choice.</p>
<h3>Should I change the locks when I move into a rental?</h3><p>Ask the landlord first — tenants usually cannot change locks without permission. Many jurisdictions require the landlord to rekey between tenancies; check your lease and local rules.</p>
<h2>Where to go next</h2><ul><li><a href="/services/locksmith">See locksmith options</a></li><li><a href="/blog/front-door-replacement-guide">Front door replacement guide</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/rekey-vs-replace-locks.svg', 'Illustration of a key with a security shield and a coin',
       'Rekey or Replace Your Locks? Costs and When to Do Each', 'Rekeying changes the pins, replacement changes the hardware. Which one you need after moving house, losing a key or upgrading security — and what each costs.', 'Comparison of rekeying and lock replacement with cost, security and scenario guidance.',
       'rekey vs replace locks', 'rekey locks cost, change locks after moving, locksmith near me, bump proof locks, lock replacement cost, smart lock installation',
       NULL, 0, '/images/blog/rekey-vs-replace-locks.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-25 14:00:00'
  FROM blog_categories c WHERE c.slug = 'locksmith'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'rekey-vs-replace-locks';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rekey-vs-replace-locks' AND t.slug = 'locksmith';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rekey-vs-replace-locks' AND t.slug = 'security';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rekey-vs-replace-locks' AND t.slug = 'locks';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'rekey-vs-replace-locks' AND t.slug = 'home-safety';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'rekey-vs-replace-locks'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'New homeowners and anyone who has lost a key, ended a tenancy or inherited unknown keys.' FROM blog_posts b WHERE b.slug = 'rekey-vs-replace-locks'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '859 words' FROM blog_posts b WHERE b.slug = 'rekey-vs-replace-locks'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'See locksmith options' FROM blog_posts b WHERE b.slug = 'rekey-vs-replace-locks'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/front-door-replacement-guide
/blog/questions-to-ask-before-hiring-a-home-service-professional' FROM blog_posts b WHERE b.slug = 'rekey-vs-replace-locks'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a brass key with a shield chip, a coin chip and a check chip on a cream background.' FROM blog_posts b WHERE b.slug = 'rekey-vs-replace-locks'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 29. How to Compare Home Service Estimates
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'how-to-compare-home-service-estimates', 'How to Compare Home Service Estimates', c.id, 'scheduled',
       'The cheapest quote is usually the one with the most missing lines. Comparing estimates is really an exercise in reading what is not there.', '<p>Three quotes for the same job rarely describe the same job. One includes permits, one assumes you will handle disposal, one prices materials at today''s rate and another at last year''s, and one has a single line that says ''labour and materials'' and no detail at all.</p>
<p>Comparing them is not a matter of looking at the bottom number. It is a matter of normalising the scope first, so the number means something.</p>
<h2>Step one: put every quote on the same page</h2>
<p>Create a simple table with one row per line item and one column per contractor. Fill it from their documents, not from memory, and leave a blank where a quote does not address an item. The blanks are the whole exercise.</p>
<figure class="article-table"><table><thead><tr><th>Line item</th><th>Contractor A</th><th>Contractor B</th><th>Contractor C</th></tr></thead><tbody><tr><td>Scope described in writing</td><td>Yes</td><td>Yes</td><td>No — verbal only</td></tr><tr><td>Materials specified by brand/model</td><td>Yes</td><td>Partly</td><td>No</td></tr><tr><td>Permits included</td><td>Yes</td><td>Excluded</td><td>Yes</td></tr><tr><td>Disposal and cleanup</td><td>Yes</td><td>Excluded</td><td>Yes</td></tr><tr><td>Labour rate and estimated hours</td><td>Stated</td><td>Lump sum</td><td>Stated</td></tr><tr><td>Warranty (workmanship / materials)</td><td>2 yr / manufacturer</td><td>None stated</td><td>1 yr / manufacturer</td></tr><tr><td>Payment schedule</td><td>30 / 40 / 30</td><td>50% deposit</td><td>Cash on completion</td></tr><tr><td>Start date and duration</td><td>3 weeks / 5 days</td><td>"Soon"</td><td>4 weeks / 4 days</td></tr></tbody></table></figure>
<h2>Step two: understand the pricing model</h2>
<ul><li>Fixed price — best when the scope is fully defined and unlikely to change. Ask what triggers a change order.</li><li>Time and materials — fair for diagnostic work and small repairs; requires a not-to-exceed cap to be safe.</li><li>Cost plus a percentage — common on large remodels; ask for an open-book breakdown of materials.</li><li>Lump sum with allowances — reasonable, but the allowance amounts matter: a low allowance is how a quote looks cheaper than it is.</li></ul>
<blockquote><p>Allowances are the most common hidden cost in renovation quotes. Ask what happens if the allowance is exceeded and who approves the overage in writing.</p></blockquote>
<h2>Step three: check the exclusions line</h2>
<p>Every credible quote has an exclusions section. Common ones are permits, hauling, drywall repair after plumbing, painting, and ''unforeseen conditions''. None of those are unreasonable individually; the problem is when they are not listed and become surprise invoices.</p>
<p>Ask each contractor to add anything they are assuming you will handle. A contractor who cannot list their exclusions has not thought about the job.</p>
<h2>Step four: judge the person, not just the paper</h2>
<p>A detailed quote from someone who never visited the property is a guess. A cheap quote from someone who cannot produce a licence or an insurance certificate is a risk you are accepting on your own policy.</p>
<p>The quotes worth comparing come from people who walked the job, asked questions, and can explain their sequence — what happens first, what they need from you, and what could change the plan.</p>
<h2>Step five: payment and warranty terms</h2>
<ol><li>A deposit that covers materials is normal; a demand for the majority upfront is not.</li><li>Progress payments should follow completed milestones, not the calendar.</li><li>Hold back a final payment until the punch list is done.</li><li>Get the workmanship warranty period in writing, and whether it is transferable.</li><li>Confirm lien waivers or paid receipts from subcontractors on larger jobs.</li><li>Read the cancellation and change-order clauses before signing.</li></ol>
<h2>The decision that is not purely financial</h2>
<p>Between two comparable quotes, choose on communication. The contractor who answers questions, documents decisions and tells you when something changed is the one who will handle an unexpected problem well — and unexpected problems are the only certainty in home improvement.</p>
<p>A slightly higher price from a contractor who communicates clearly is usually the cheapest outcome in the long run.</p>
<h2>Frequently asked questions</h2>
<h3>Is the lowest quote usually the best?</h3><p>Rarely. The lowest quote is often the one with the most exclusions or the thinnest scope. Compare what is included, then compare price.</p>
<h3>What is a reasonable deposit for home services?</h3><p>Enough to cover materials, typically 10–30% depending on the trade. Large upfront payments reduce your leverage if the work stalls.</p>
<h3>Should I get a written contract for a small job?</h3><p>Yes, even a one-page one stating scope, price, payment and warranty. It takes five minutes and settles most disputes before they start.</p>
<h3>How many quotes should I get?</h3><p>Two for a simple repair, three for anything significant. More than three rarely improves the decision and delays the work.</p>
<h2>Where to go next</h2><ul><li><a href="/services">Browse home service categories</a></li><li><a href="/blog/questions-to-ask-before-hiring-a-home-service-professional">Questions to ask before hiring a home service professional</a></li><li><a href="/blog/kitchen-remodel-cost-breakdown">Kitchen remodel costs: a line-by-line breakdown</a></li><li><a href="/blog/how-to-choose-a-roofing-contractor">How to choose a roofing contractor</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/how-to-compare-home-service-estimates.svg', 'Illustration of a clipboard with a completed checklist beside a coin',
       'How to Compare Home Service Estimates Properly', 'Three quotes are only useful if they cover the same work. A line-by-line method for comparing contractor estimates, spotting exclusions and judging value.', 'Framework for normalising and comparing contractor quotes, including a comparison table.',
       'how to compare contractor estimates', 'contractor quote comparison, home service estimate, how to read a contractor bid, contractor change order, fixed price vs time and materials, contractor deposit',
       NULL, 0, '/images/blog/how-to-compare-home-service-estimates.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-26 14:00:00'
  FROM blog_categories c WHERE c.slug = 'hiring-a-pro'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'how-to-compare-home-service-estimates';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-compare-home-service-estimates' AND t.slug = 'hiring';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-compare-home-service-estimates' AND t.slug = 'estimates';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-compare-home-service-estimates' AND t.slug = 'contractors';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'how-to-compare-home-service-estimates' AND t.slug = 'budgeting';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Commercial investigation' FROM blog_posts b WHERE b.slug = 'how-to-compare-home-service-estimates'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'Homeowners holding two or three quotes that look similar on price and completely different on detail.' FROM blog_posts b WHERE b.slug = 'how-to-compare-home-service-estimates'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '803 words' FROM blog_posts b WHERE b.slug = 'how-to-compare-home-service-estimates'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'Browse home service categories' FROM blog_posts b WHERE b.slug = 'how-to-compare-home-service-estimates'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/questions-to-ask-before-hiring-a-home-service-professional
/blog/kitchen-remodel-cost-breakdown
/blog/how-to-choose-a-roofing-contractor' FROM blog_posts b WHERE b.slug = 'how-to-compare-home-service-estimates'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a clipboard with a checked line, a coin chip, a document chip and a check chip on a sand background.' FROM blog_posts b WHERE b.slug = 'how-to-compare-home-service-estimates'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- 30. Questions to Ask Before Hiring a Home Service Professional
INSERT INTO blog_posts
  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,
   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,
   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)
SELECT 'questions-to-ask-before-hiring-a-home-service-professional', 'Questions to Ask Before Hiring a Home Service Professional', c.id, 'scheduled',
       'Most bad contractor experiences trace back to a question nobody asked at the start. These twelve take ten minutes and change the entire relationship.', '<p>A good contractor will welcome most of the questions below, because they are the same questions a good contractor asks a subcontractor. If any of them produce defensiveness, that is the answer.</p>
<p>Ask them in one conversation, note the answers, and verify the two that can be verified independently: the licence and the insurance.</p>
<h2>The twelve questions</h2>
<ol><li>Are you licensed for this type of work, and what is your licence number?</li><li>Can you send a certificate of insurance for liability and workers'' compensation?</li><li>How long have you been doing this specific kind of work in this area?</li><li>Will your own crew do the work, or will it be subcontracted?</li><li>Who is my point of contact during the project, and how do I reach them?</li><li>What is included in the price, and what is explicitly excluded?</li><li>What could change the price, and how are changes approved?</li><li>What is the payment schedule, and what does the deposit cover?</li><li>What warranty do you provide on labour, and how long does it last?</li><li>How many other jobs will be running at the same time as mine?</li><li>What is the start date and the expected duration, and what could move them?</li><li>Can I have three recent references, including one from at least a year ago?</li></ol>
<h2>What good answers sound like</h2>
<figure class="article-table"><table><thead><tr><th>Question</th><th>A good answer</th><th>A warning sign</th></tr></thead><tbody><tr><td>Licence</td><td>Number offered without hesitation</td><td>"We don''t need one for this"</td></tr><tr><td>Insurance</td><td>Certificate sent before work starts</td><td>"We''re covered, don''t worry"</td></tr><tr><td>Crew</td><td>Names the crew or the subcontractor</td><td>Vague about who will be on site</td></tr><tr><td>Exclusions</td><td>A written list</td><td>"Everything''s included"</td></tr><tr><td>Changes</td><td>Written change order, signed by you</td><td>"We''ll sort it out at the end"</td></tr><tr><td>Warranty</td><td>Specific years, in writing</td><td>"Lifetime" with no terms</td></tr><tr><td>References</td><td>Three, with addresses or numbers</td><td>One phone number, unlisted</td></tr></tbody></table></figure>
<h2>The two checks you do not take on trust</h2>
<p>Verify the licence yourself against the state or local licensing board — a scan of a card proves nothing. Then call the insurer on the certificate and confirm the policy is active and covers the work being done.</p>
<p>This takes ten minutes and it is the difference between a contractor''s mistake being their problem and it becoming yours.</p>
<blockquote><p>If a contractor asks you to pull the permit in your own name, that is usually a sign they cannot or will not. Permits exist to protect you; the person doing the work should be accountable for them.</p></blockquote>
<h2>Questions about the money</h2>
<ul><li>Does the deposit cover materials, and what happens to it if the job is delayed?</li><li>Are progress payments tied to completed milestones?</li><li>What is your policy on change orders — who signs, and when is the price fixed?</li><li>Do you require a final payment before the punch list is complete?</li><li>Are you able to provide lien waivers or paid receipts for subcontractors?</li></ul>
<h2>The behavioural signals</h2>
<p>Shows up on time for the estimate, listens more than talks, and asks about the house rather than about the budget. Writes things down. Mentions what could go wrong before you ask. Replies to messages within a day during the quoting stage.</p>
<p>Those signals predict project behaviour far better than a glossy brochure. The reverse — late arrival, pressure to sign today, a quote with no detail, ignoring questions — predicts exactly what you would expect.</p>
<h2>Before you sign</h2>
<ol><li>Get the scope, price, payment schedule and warranty in the contract.</li><li>Confirm the start date and duration in writing.</li><li>Ask what the contractor needs from you and when — access, parking, decisions, payments.</li><li>Photograph the existing condition of the work area.</li><li>Read the cancellation clause, and keep a signed copy.</li></ol>
<h2>Frequently asked questions</h2>
<h3>How do I verify a contractor''s licence?</h3><p>Search your state or local licensing board''s public database using the licence number or business name. Ask for the number in writing so you can check the exact entity.</p>
<h3>What should I do if a contractor will not provide insurance details?</h3><p>Do not hire them. If an uninsured worker is injured on your property, the claim can fall on your homeowner policy.</p>
<h3>Is a verbal agreement enough for small jobs?</h3><p>It is a risk. Even a short written note covering scope, price and warranty prevents most disputes and makes expectations explicit.</p>
<h3>Should I use a contractor recommended by an insurer?</h3><p>You can, but you are not obliged to. Compare any recommended contractor with one or two independent quotes, and never sign a document assigning your claim to a contractor.</p>
<h2>Where to go next</h2><ul><li><a href="/services">Browse home service categories</a></li><li><a href="/blog/how-to-compare-home-service-estimates">How to compare home service estimates</a></li><li><a href="/blog/how-to-choose-a-roofing-contractor">How to choose a roofing contractor</a></li><li><a href="/blog/rekey-vs-replace-locks">Rekey or replace your locks?</a></li></ul>
<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
       '/images/blog/questions-to-ask-before-hiring-a-home-service-professional.svg', 'Illustration of a speech bubble with a document and a review star',
       '12 Questions to Ask Before Hiring a Contractor', 'The questions that separate a professional from a gamble: licence, insurance, experience, subcontractors, warranty and who actually shows up on the day.', 'Twelve vetting questions for choosing a home service professional, with what a good answer sounds like.',
       'questions to ask a contractor', 'how to vet a contractor, contractor license check, contractor insurance certificate, hiring a tradesperson, contractor red flags, home service professional',
       NULL, 0, '/images/blog/questions-to-ask-before-hiring-a-home-service-professional.svg', 'Safe Home Network Editorial',
       NULL, '2026-11-27 14:00:00'
  FROM blog_categories c WHERE c.slug = 'hiring-a-pro'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),
  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),
  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),
  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),
  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),
  social_image = VALUES(social_image), published_at = VALUES(published_at),
  scheduled_at = VALUES(scheduled_at);
DELETE bpt FROM blog_post_tags bpt
  INNER JOIN blog_posts b ON b.id = bpt.post_id
  INNER JOIN blog_tags t ON t.id = bpt.tag_id
 WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional' AND t.slug = 'hiring';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional' AND t.slug = 'contractors';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional' AND t.slug = 'consumer-protection';
INSERT INTO blog_post_tags (post_id, tag_id)
SELECT b.id, t.id FROM blog_posts b, blog_tags t
 WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional' AND t.slug = 'vetting';
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'search_intent', 'Informational' FROM blog_posts b WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'target_audience', 'First-time homeowners and anyone hiring a trade without a personal recommendation.' FROM blog_posts b WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'article_length', '814 words' FROM blog_posts b WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'cta_target', 'Browse home service categories' FROM blog_posts b WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'internal_links', '/blog/how-to-compare-home-service-estimates
/blog/how-to-choose-a-roofing-contractor
/blog/rekey-vs-replace-locks' FROM blog_posts b WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)
SELECT b.id, 'visual_direction', 'Flat vector medallion: a speech bubble with a document chip, a star chip and a shield chip on a cream background.' FROM blog_posts b WHERE b.slug = 'questions-to-ask-before-hiring-a-home-service-professional'
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

/* --------------------------- 4. Media records -------------------------- */
-- The article illustrations ship as static files in /images/blog; these rows
-- make them visible in the admin media library. SVG uploads stay blocked in
-- the API on purpose (an SVG can carry script), so they are registered here.
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'common-appliance-problems-when-to-call-a-repair-professional.svg', 'common-appliance-problems-when-to-call-a-repair-professional.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/common-appliance-problems-when-to-call-a-repair-professional.svg', 'Illustration of a technician checking the inside of a wall oven while a homeowner looks on', 'Diagnostic guide to the ten most common appliance failures, with a safe-to-check / call-a-pro split.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/common-appliance-problems-when-to-call-a-repair-professional.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'refrigerator-not-cooling-common-causes.svg', 'refrigerator-not-cooling-common-causes.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/refrigerator-not-cooling-common-causes.svg', 'Illustration of an open refrigerator with warm air indicated, a thermometer and a technician''s tool bag', 'Ordered troubleshooting guide for a refrigerator that is not cooling, with a clear stop line before refrigerant work.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/refrigerator-not-cooling-common-causes.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'how-to-choose-a-reliable-appliance-repair-service.svg', 'how-to-choose-a-reliable-appliance-repair-service.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/how-to-choose-a-reliable-appliance-repair-service.svg', 'Illustration of a homeowner comparing two repair quotes on a clipboard beside a washing machine', 'Hiring checklist for appliance repair: credentials, fee structures, warranty terms, red flags.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/how-to-choose-a-reliable-appliance-repair-service.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'warning-signs-your-home-may-have-electrical-problems.svg', 'warning-signs-your-home-may-have-electrical-problems.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/warning-signs-your-home-may-have-electrical-problems.svg', 'Illustration of a homeowner noticing a warm wall outlet with a subtle warning indicator on a home electrical panel', 'Symptom-by-symptom electrical safety guide with urgency ratings.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/warning-signs-your-home-may-have-electrical-problems.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'when-should-you-hire-a-licensed-electrician.svg', 'when-should-you-hire-a-licensed-electrician.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/when-should-you-hire-a-licensed-electrician.svg', 'Illustration of a licensed electrician checking a residential panel while a homeowner reviews a permit document', 'Decision guide: DIY vs handyman vs licensed electrician, with licence and permit verification steps.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/when-should-you-hire-a-licensed-electrician.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'common-causes-of-circuit-breaker-trips.svg', 'common-causes-of-circuit-breaker-trips.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/common-causes-of-circuit-breaker-trips.svg', 'Illustration of a homeowner resetting a breaker in a panel with circuit diagrams shown alongside', 'Four-cause breakdown of repeated breaker trips with safe isolation steps.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/common-causes-of-circuit-breaker-trips.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'warning-signs-you-need-a-plumber.svg', 'warning-signs-you-need-a-plumber.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/warning-signs-you-need-a-plumber.svg', 'Illustration of a kitchen faucet with a drip, a pressure gauge and a wrench', 'Symptom-led guide to household plumbing problems with an urgency ranking and pre-visit checklist.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/warning-signs-you-need-a-plumber.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'water-heater-problems-repair-or-replace.svg', 'water-heater-problems-repair-or-replace.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/water-heater-problems-repair-or-replace.svg', 'Illustration of a tank water heater with a temperature gauge and a coin icon', 'Decision framework for failing water heaters: symptom, age and cost thresholds.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/water-heater-problems-repair-or-replace.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'ac-not-cooling-troubleshooting-guide.svg', 'ac-not-cooling-troubleshooting-guide.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/ac-not-cooling-troubleshooting-guide.svg', 'Illustration of a wall-mounted air conditioner beside a sun and a gauge', 'Step-by-step AC troubleshooting ladder from thermostat to refrigerant, with a safety line.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/ac-not-cooling-troubleshooting-guide.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'furnace-maintenance-checklist.svg', 'furnace-maintenance-checklist.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/furnace-maintenance-checklist.svg', 'Illustration of a home furnace with a calendar and a safety shield', 'Annual furnace maintenance schedule split into monthly homeowner tasks and the professional service visit.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/furnace-maintenance-checklist.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'roof-leak-warning-signs.svg', 'roof-leak-warning-signs.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/roof-leak-warning-signs.svg', 'Illustration of a pitched roof with rain drops and a safety shield', 'Diagnostic guide to the nine earliest signals of roof failure, from interior stains to attic evidence.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/roof-leak-warning-signs.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'how-to-choose-a-roofing-contractor.svg', 'how-to-choose-a-roofing-contractor.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/how-to-choose-a-roofing-contractor.svg', 'Illustration of a house with a written quote and a review star', 'Contractor vetting checklist for roofing projects, from licence verification to payment milestones.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/how-to-choose-a-roofing-contractor.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'roof-repair-vs-replacement.svg', 'roof-repair-vs-replacement.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/roof-repair-vs-replacement.svg', 'Illustration of a stepladder with a coin and a house icon', 'Decision matrix comparing repair and replacement by roof age, damage extent and cost per square.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/roof-repair-vs-replacement.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'storm-damage-roof-repair-and-insurance.svg', 'storm-damage-roof-repair-and-insurance.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/storm-damage-roof-repair-and-insurance.svg', 'Illustration of a storm cloud with rain, a claim document and a house icon', 'Storm response playbook: emergency mitigation, evidence gathering, claim process and contractor vetting.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/storm-damage-roof-repair-and-insurance.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'first-24-hours-after-water-damage.svg', 'first-24-hours-after-water-damage.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/first-24-hours-after-water-damage.svg', 'Illustration of a large water droplet with a clock and an emergency phone icon', 'Hour-by-hour emergency water response plan with salvage and documentation guidance.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/first-24-hours-after-water-damage.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'hidden-mold-after-a-leak.svg', 'hidden-mold-after-a-leak.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/hidden-mold-after-a-leak.svg', 'Illustration of mold spore clusters with a shield and a water droplet', 'Detection and remediation guide for hidden mold after water intrusion.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/hidden-mold-after-a-leak.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'termite-warning-signs.svg', 'termite-warning-signs.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/termite-warning-signs.svg', 'Illustration of a termite with a house and a clipboard inspection report', 'Field guide to subterranean and drywood termite evidence with an inspection checklist.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/termite-warning-signs.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'rodent-proofing-your-home.svg', 'rodent-proofing-your-home.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/rodent-proofing-your-home.svg', 'Illustration of a mouse beside a shield and a house icon', 'Exclusion-first rodent control guide with a gap-by-gap sealing checklist.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/rodent-proofing-your-home.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'kitchen-remodel-cost-breakdown.svg', 'kitchen-remodel-cost-breakdown.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/kitchen-remodel-cost-breakdown.svg', 'Illustration of a kitchen counter with cabinets, a coin and a measuring ruler', 'Percentage-based kitchen remodel budget model with cost drivers and a contingency guide.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/kitchen-remodel-cost-breakdown.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'kitchen-remodel-timeline.svg', 'kitchen-remodel-timeline.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/kitchen-remodel-timeline.svg', 'Illustration of a calendar with a clock and a wrench', 'Phase-by-phase kitchen remodel schedule with typical durations and critical-path risks.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/kitchen-remodel-timeline.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'bathroom-remodel-planning-checklist.svg', 'bathroom-remodel-planning-checklist.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/bathroom-remodel-planning-checklist.svg', 'Illustration of a shower head with a checklist and a measuring ruler', '12-step bathroom remodel planning sequence with waterproofing and ventilation requirements.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/bathroom-remodel-planning-checklist.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'small-bathroom-remodel-that-adds-value.svg', 'small-bathroom-remodel-that-adds-value.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/small-bathroom-remodel-that-adds-value.svg', 'Illustration of a bathtub with a coin and a measuring ruler', 'Value-focused small bathroom upgrade list ranked by cost per impact.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/small-bathroom-remodel-that-adds-value.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'window-replacement-cost-and-signs.svg', 'window-replacement-cost-and-signs.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/window-replacement-cost-and-signs.svg', 'Illustration of a four-pane window with a coin and a measuring ruler', 'Repair-versus-replace guide for windows with cost drivers and installation quality checks.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/window-replacement-cost-and-signs.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'energy-efficient-windows-guide.svg', 'energy-efficient-windows-guide.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/energy-efficient-windows-guide.svg', 'Illustration of a window with a sun and a leaf, representing energy efficiency', 'Plain-English guide to window energy ratings and climate-specific specification choices.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/energy-efficient-windows-guide.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'front-door-replacement-guide.svg', 'front-door-replacement-guide.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/front-door-replacement-guide.svg', 'Illustration of a panelled front door with a key and a security shield', 'Entry door buying guide covering material comparison, sizing, security and installation standards.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/front-door-replacement-guide.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'driveway-replacement-cost.svg', 'driveway-replacement-cost.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/driveway-replacement-cost.svg', 'Illustration of a concrete driveway slab with a coin and a ruler', 'Cost-driver breakdown for driveway replacement with a base-and-joint quality checklist.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/driveway-replacement-cost.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'concrete-repair-vs-replace.svg', 'concrete-repair-vs-replace.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/concrete-repair-vs-replace.svg', 'Illustration of a cracked concrete slab with a wrench and a coin', 'Diagnostic framework for cracked and settled concrete with repair-option comparison.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/concrete-repair-vs-replace.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'rekey-vs-replace-locks.svg', 'rekey-vs-replace-locks.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/rekey-vs-replace-locks.svg', 'Illustration of a key with a security shield and a coin', 'Comparison of rekeying and lock replacement with cost, security and scenario guidance.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/rekey-vs-replace-locks.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'how-to-compare-home-service-estimates.svg', 'how-to-compare-home-service-estimates.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/how-to-compare-home-service-estimates.svg', 'Illustration of a clipboard with a completed checklist beside a coin', 'Framework for normalising and comparing contractor quotes, including a comparison table.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/how-to-compare-home-service-estimates.svg');
INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)
SELECT 'questions-to-ask-before-hiring-a-home-service-professional.svg', 'questions-to-ask-before-hiring-a-home-service-professional.svg', 'image/svg+xml', 'svg', 0,
       '/images/blog/questions-to-ask-before-hiring-a-home-service-professional.svg', 'Illustration of a speech bubble with a document and a review star', 'Twelve vetting questions for choosing a home service professional, with what a good answer sounds like.', '2026-11-07 14:00:00'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = '/images/blog/questions-to-ask-before-hiring-a-home-service-professional.svg');

/* ------------------------------- 5. Verify ----------------------------- */
SELECT 'blog content imported' AS status,
       (SELECT COUNT(*) FROM blog_posts WHERE deleted_at IS NULL AND status = 'published') AS published_posts,
       (SELECT COUNT(*) FROM blog_posts WHERE deleted_at IS NULL AND status = 'scheduled') AS scheduled_posts,
       (SELECT COUNT(*) FROM blog_categories) AS categories,
       (SELECT COUNT(*) FROM blog_tags) AS tags,
       (SELECT COUNT(*) FROM blog_post_metadata) AS metadata_rows;
