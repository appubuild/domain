-- Optional starter content: one published article.
--
-- The offline pack in src/lib/content/posts.ts exists so a build without Supabase still has
-- an article to render. This seed makes that article real CMS content, so it can be edited,
-- scheduled or deleted in the admin panel. It is deliberately NOT part of seed.sql: an
-- installation with an empty blog is a valid, honest state.
--
-- Run once, after seed.sql:  psql "$DATABASE_URL" -f supabase/seed/first-post.sql
-- Idempotent: re-running updates the same row (matched on posts.slug).

insert into public.post_categories (slug, name, description)
values ('naming', 'Naming', 'How to judge, score and choose domain names.')
on conflict (slug) do update set name = excluded.name, description = excluded.description;

insert into public.post_tags (slug, name)
values
  ('brandability', 'Brandability'),
  ('scoring', 'Scoring'),
  ('methodology', 'Methodology')
on conflict (slug) do nothing;

insert into public.posts (
  slug, title, excerpt, body, status, category_id, author_name, reading_minutes,
  seo_title, meta_description, canonical_url, noindex, faq, published_at, created_at, updated_at
)
values (
  $q$how-to-judge-a-domain-name$q$,
  $q$How to judge a domain name without guessing$q$,
  $q$A practical framework for evaluating a name: pronounceability, spelling risk, length, distinctiveness and semantic fit — with the trade-offs each one creates.$q$,
  $q$<p>Most domain advice collapses into taste. “Say it out loud”, “keep it short”, “make it memorable” — all reasonable, none of it actionable when you have two hundred candidates and an afternoon. This article turns those instincts into five checks you can apply consistently, including the cases where the checks fight each other.</p>

<h2>1. Can somebody spell it after hearing it once?</h2>
<p>This is the check that most names fail. Read the candidate to somebody who cannot see it and ask them to type it. Names with ambiguous sounds — “ph” versus “f”, doubled consonants, silent letters, “c” versus “k” — leak traffic permanently, because a misspelt attempt either reaches a competitor or reaches nothing.</p>
<p>Heuristics that help: prefer one obvious spelling of every sound, avoid strings of more than two vowels, and be sceptical of names whose second half only works in writing.</p>

<h2>2. Does it survive being said in a noisy room?</h2>
<p>Short names with clear consonant boundaries are easier to repeat. A three-syllable name with two stressed vowels is harder than a two-syllable name with one stressed vowel, even when both are the same length on paper. This is why syllable count is a better predictor than character count once you pass seven characters.</p>

<h2>3. Is it distinctive enough to be remembered?</h2>
<p>Distinctiveness is the trade-off against clarity. A name built from two common dictionary words is immediately understandable and almost impossible to protect or recall distinctly. An invented form is distinctive but carries no meaning until you spend money teaching it.</p>
<p>The practical middle: keep one meaningful component and let the other be unusual — <em>root-preserving</em> and <em>root-inspired</em> strategies in our engine exist precisely for this.</p>

<h2>4. Does the length match how it will be used?</h2>
<p>A name that appears in a mobile address bar, a podcast ad and a terminal prompt has three different length budgets. If your primary channel is spoken, every character has a cost; if it is written in a purchase flow, mild length is tolerable. Decide the channel before you judge the name.</p>

<h2>5. Is the meaning still true after the product changes?</h2>
<p>Descriptive names age badly when products expand. A name that encodes “invoices” becomes a liability when you sell cash-flow forecasting. Prefer a name tied to the customer’s problem rather than to your current feature set.</p>

<h2>Where the checks conflict</h2>
<ul>
<li><strong>Distinctive versus pronounceable.</strong> Invented names can be pleasant or hostile depending on their sound shape; the difference is usually a single awkward consonant cluster.</li>
<li><strong>Short versus meaningful.</strong> Every removed character removes information.</li>
<li><strong>Descriptive versus durable.</strong> Clarity today can become baggage in two years.</li>
</ul>
<p>No score can resolve these for you, which is why our tool exposes each factor separately with its weight, rather than presenting a single authoritative number. The number is a sorting device; the factors are the decision.</p>

<h2>What a score cannot tell you</h2>
<p>Three things worth stating plainly:</p>
<ol>
<li><strong>Availability.</strong> Quality and availability are independent. A brilliant name is often already registered, and an available name can be weak.</li>
<li><strong>Trademark risk.</strong> Screening is not clearance. A name that passes a heuristic check can still infringe.</li>
<li><strong>Resale value.</strong> Nothing about a naming score predicts what somebody would pay for a domain.</li>
</ol>
<p>Use the score to order the list. Use the checks above to choose from the top of it.</p>$q$,
  'published',
  (select id from public.post_categories where slug = 'naming'),
  $q$DomainFits$q$,
  3,
  $q$How to judge a domain name without guessing$q$,
  $q$A practical, explainable framework for evaluating domain names: pronounceability, spelling risk, length, distinctiveness and semantic fit.$q$,
  null,
  false,
  $j$[{"question":"Should I always choose the shortest name?","answer":"No. Short names are easier to type but often less distinctive and more likely to be registered. Length is one factor among several, and it should be judged against the channel where the name will be used."},{"question":"Is a brandability score a prediction of success?","answer":"No. It is a documented heuristic based on letter patterns, length and memorability cues. It cannot predict traction, availability, trademark conflicts or commercial value."}]$j$::jsonb,
  '2026-10-01T09:00:00.000Z'::timestamptz,
  now(),
  now()
)
on conflict (slug) do update set
  title = excluded.title,
  excerpt = excluded.excerpt,
  body = excluded.body,
  status = excluded.status,
  category_id = excluded.category_id,
  author_name = excluded.author_name,
  reading_minutes = excluded.reading_minutes,
  seo_title = excluded.seo_title,
  meta_description = excluded.meta_description,
  faq = excluded.faq,
  published_at = excluded.published_at,
  updated_at = now();

insert into public.post_tags_map (post_id, tag_id)
select p.id, t.id
from public.posts p
join public.post_tags t on t.slug in ('brandability', 'scoring', 'methodology')
where p.slug = $q$how-to-judge-a-domain-name$q$
on conflict do nothing;
