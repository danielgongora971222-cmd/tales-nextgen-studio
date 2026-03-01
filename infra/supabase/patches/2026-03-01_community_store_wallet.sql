-- infra/supabase/patches/2026-03-01_community_store_wallet.sql
-- Community Store + Wallet + Referrals (no toca tu Store actual)

-- =========================
-- Listings (PUBLICO, SIN RECETA)
-- =========================
create table if not exists public.community_listings (
  id uuid primary key default gen_random_uuid(),

  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_username_snapshot text,
  seller_verified_snapshot boolean not null default false,

  listing_kind text not null default 'single' check (listing_kind in ('single','workflow')),
  media_tag text not null default 'image' check (media_tag in ('image','video','workflow')),

  price_credits integer not null check (price_credits > 0 and price_credits <= 1000000),
  description text not null default '' check (char_length(description) <= 800),

  status text not null default 'active' check (status in ('active','unlisted','deleted')),

  -- IMPORTANTISIMO: el listing apunta a un asset SOLO para preview visual
  -- La receta real va en otra tabla privada.
  preview_asset_id uuid not null references public.assets(id) on delete restrict,

  created_at timestamptz not null default now(),
  listed_at timestamptz,
  updated_at timestamptz not null default now(),

  likes_count integer not null default 0,
  comments_count integer not null default 0,
  sales_count integer not null default 0
);

create index if not exists community_listings_status_created_at_idx
  on public.community_listings(status, created_at desc);

create index if not exists community_listings_seller_id_created_at_idx
  on public.community_listings(seller_id, created_at desc);

create index if not exists community_listings_preview_asset_id_idx
  on public.community_listings(preview_asset_id);

alter table public.community_listings enable row level security;

drop policy if exists "community_listings_select_public_active" on public.community_listings;
create policy "community_listings_select_public_active" on public.community_listings
  for select using (status = 'active');

drop policy if exists "community_listings_select_seller_all" on public.community_listings;
create policy "community_listings_select_seller_all" on public.community_listings
  for select using (auth.uid() = seller_id);

drop policy if exists "community_listings_insert_seller" on public.community_listings;
create policy "community_listings_insert_seller" on public.community_listings
  for insert with check (auth.uid() = seller_id);

drop policy if exists "community_listings_update_seller" on public.community_listings;
create policy "community_listings_update_seller" on public.community_listings
  for update using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

drop policy if exists "community_listings_delete_seller" on public.community_listings;
create policy "community_listings_delete_seller" on public.community_listings
  for delete using (auth.uid() = seller_id);

-- updated_at helper (tu schema ya la trae, pero esto lo hace seguro si algun dia falta)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_community_listings_updated_at on public.community_listings;
create trigger set_community_listings_updated_at
  before update on public.community_listings
  for each row
  execute procedure public.set_updated_at();

-- =========================
-- Referidos (3 codigos por afiliado)
-- =========================
create table if not exists public.community_referral_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  code text not null unique check (char_length(code) between 6 and 24),
  variant text not null check (variant in ('A','B','C')),

  buyer_discount_pct integer not null check (buyer_discount_pct in (0,10,20)),
  ref_reward_pct integer not null check (ref_reward_pct in (0,10,20)),

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists community_referral_codes_owner_variant_uq
  on public.community_referral_codes(owner_id, variant);

alter table public.community_referral_codes enable row level security;

drop policy if exists "community_referral_codes_select_owner" on public.community_referral_codes;
create policy "community_referral_codes_select_owner" on public.community_referral_codes
  for select using (auth.uid() = owner_id);

drop policy if exists "community_referral_codes_insert_owner" on public.community_referral_codes;
create policy "community_referral_codes_insert_owner" on public.community_referral_codes
  for insert with check (auth.uid() = owner_id);

drop policy if exists "community_referral_codes_update_owner" on public.community_referral_codes;
create policy "community_referral_codes_update_owner" on public.community_referral_codes
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- =========================
-- Wallet (creditos + earnings)
-- =========================
create table if not exists public.wallet_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation_credits integer not null default 0 check (generation_credits >= 0),
  earnings_pending_credits integer not null default 0 check (earnings_pending_credits >= 0),
  earnings_matured_credits integer not null default 0 check (earnings_matured_credits >= 0),
  updated_at timestamptz not null default now()
);

alter table public.wallet_balances enable row level security;

drop policy if exists "wallet_balances_select_own" on public.wallet_balances;
create policy "wallet_balances_select_own" on public.wallet_balances
  for select using (auth.uid() = user_id);

drop policy if exists "wallet_balances_insert_own" on public.wallet_balances;
create policy "wallet_balances_insert_own" on public.wallet_balances
  for insert with check (auth.uid() = user_id);

drop policy if exists "wallet_balances_update_own" on public.wallet_balances;
create policy "wallet_balances_update_own" on public.wallet_balances
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_wallet_balances_updated_at on public.wallet_balances;
create trigger set_wallet_balances_updated_at
  before update on public.wallet_balances
  for each row
  execute procedure public.set_updated_at();

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null,
  amount_credits integer not null,
  ref_type text,
  ref_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_ledger_user_created_at_idx
  on public.wallet_ledger(user_id, created_at desc);

create unique index if not exists wallet_ledger_user_idempotency_uq
  on public.wallet_ledger(user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.wallet_ledger enable row level security;

drop policy if exists "wallet_ledger_select_own" on public.wallet_ledger;
create policy "wallet_ledger_select_own" on public.wallet_ledger
  for select using (auth.uid() = user_id);

drop policy if exists "wallet_ledger_insert_own" on public.wallet_ledger;
create policy "wallet_ledger_insert_own" on public.wallet_ledger
  for insert with check (auth.uid() = user_id);

-- =========================
-- Compras (Buyer/Seller/Referrer pueden ver)
-- =========================
create table if not exists public.community_purchases (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null references public.community_listings(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,

  price_credits integer not null check (price_credits > 0),
  paid_credits integer not null check (paid_credits > 0),

  platform_fee_credits integer not null check (platform_fee_credits >= 0),
  seller_net_credits integer not null check (seller_net_credits >= 0),

  referral_code_id uuid references public.community_referral_codes(id) on delete set null,
  referral_reward_credits integer not null default 0 check (referral_reward_credits >= 0),
  referrer_id uuid references auth.users(id) on delete set null,

  status text not null default 'completed' check (status in ('completed','refunded','chargeback','cancelled')),
  created_at timestamptz not null default now(),
  matures_at timestamptz not null,
  is_matured boolean not null default false,

  recipe_hash_at_purchase text not null,

  idempotency_key text,
  unique(listing_id, buyer_id),
  unique(idempotency_key)
);

create index if not exists community_purchases_buyer_created_at_idx
  on public.community_purchases(buyer_id, created_at desc);

create index if not exists community_purchases_seller_created_at_idx
  on public.community_purchases(seller_id, created_at desc);

create index if not exists community_purchases_mature_due_idx
  on public.community_purchases(is_matured, matures_at)
  where status = 'completed';

alter table public.community_purchases enable row level security;

drop policy if exists "community_purchases_select_visible" on public.community_purchases;
create policy "community_purchases_select_visible" on public.community_purchases
  for select using (
    auth.uid() = buyer_id
    or auth.uid() = seller_id
    or (referrer_id is not null and auth.uid() = referrer_id)
  );

drop policy if exists "community_purchases_insert_buyer" on public.community_purchases;
create policy "community_purchases_insert_buyer" on public.community_purchases
  for insert with check (auth.uid() = buyer_id);

-- sales_count +1 al insertar compra completed
create or replace function public.community_listings_sales_count_inc()
returns trigger as $$
begin
  if (new.status = 'completed') then
    update public.community_listings
    set sales_count = sales_count + 1
    where id = new.listing_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_community_listings_sales_inc on public.community_purchases;
create trigger trg_community_listings_sales_inc
  after insert on public.community_purchases
  for each row execute procedure public.community_listings_sales_count_inc();

-- =========================
-- Recetas (PRIVADO, INMUTABLE)
-- =========================
create table if not exists public.community_listing_recipes (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null unique references public.community_listings(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,

  recipe_snapshot jsonb not null,
  recipe_hash text not null,

  created_at timestamptz not null default now()
);

create index if not exists community_listing_recipes_listing_id_idx
  on public.community_listing_recipes(listing_id);

alter table public.community_listing_recipes enable row level security;

drop policy if exists "community_listing_recipes_select_seller" on public.community_listing_recipes;
create policy "community_listing_recipes_select_seller" on public.community_listing_recipes
  for select using (auth.uid() = seller_id);

drop policy if exists "community_listing_recipes_select_buyer" on public.community_listing_recipes;
create policy "community_listing_recipes_select_buyer" on public.community_listing_recipes
  for select using (
    exists (
      select 1 from public.community_purchases p
      where p.listing_id = community_listing_recipes.listing_id
        and p.buyer_id = auth.uid()
        and p.status = 'completed'
    )
  );

drop policy if exists "community_listing_recipes_insert_seller" on public.community_listing_recipes;
create policy "community_listing_recipes_insert_seller" on public.community_listing_recipes
  for insert with check (auth.uid() = seller_id);

-- =========================
-- Likes + Comments del listing
-- =========================
create table if not exists public.community_listing_likes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(listing_id, user_id)
);

create index if not exists community_listing_likes_listing_id_idx on public.community_listing_likes(listing_id);
create index if not exists community_listing_likes_user_id_idx on public.community_listing_likes(user_id);

alter table public.community_listing_likes enable row level security;

drop policy if exists "community_listing_likes_select_visible" on public.community_listing_likes;
create policy "community_listing_likes_select_visible" on public.community_listing_likes
  for select using (
    exists (
      select 1 from public.community_listings l
      where l.id = listing_id
        and (l.status = 'active' or l.seller_id = auth.uid())
    )
  );

drop policy if exists "community_listing_likes_insert_own" on public.community_listing_likes;
create policy "community_listing_likes_insert_own" on public.community_listing_likes
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.community_listings l where l.id = listing_id and l.status = 'active')
  );

drop policy if exists "community_listing_likes_delete_own" on public.community_listing_likes;
create policy "community_listing_likes_delete_own" on public.community_listing_likes
  for delete using (auth.uid() = user_id);

create table if not exists public.community_listing_comments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  is_shadowed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists community_listing_comments_listing_id_created_at_idx
  on public.community_listing_comments(listing_id, created_at desc);

create index if not exists community_listing_comments_visible_listing_id_created_at_idx
  on public.community_listing_comments(listing_id, created_at desc)
  where is_shadowed = false;

alter table public.community_listing_comments enable row level security;

drop policy if exists "community_listing_comments_select_visible" on public.community_listing_comments;
create policy "community_listing_comments_select_visible" on public.community_listing_comments
  for select using (
    exists (
      select 1 from public.community_listings l
      where l.id = listing_id
        and (l.status = 'active' or l.seller_id = auth.uid())
    )
    and (is_shadowed = false or user_id = auth.uid())
  );

drop policy if exists "community_listing_comments_insert_own" on public.community_listing_comments;
create policy "community_listing_comments_insert_own" on public.community_listing_comments
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.community_listings l where l.id = listing_id and l.status = 'active')
  );

drop policy if exists "community_listing_comments_delete_own" on public.community_listing_comments;
create policy "community_listing_comments_delete_own" on public.community_listing_comments
  for delete using (auth.uid() = user_id);

-- Contadores likes/comments
create or replace function public.community_listings_likes_count_inc()
returns trigger as $$
begin
  update public.community_listings
  set likes_count = likes_count + 1
  where id = new.listing_id;
  return new;
end;
$$ language plpgsql;

create or replace function public.community_listings_likes_count_dec()
returns trigger as $$
begin
  update public.community_listings
  set likes_count = greatest(likes_count - 1, 0)
  where id = old.listing_id;
  return old;
end;
$$ language plpgsql;

create or replace function public.community_listings_comments_count_inc()
returns trigger as $$
begin
  update public.community_listings
  set comments_count = comments_count + 1
  where id = new.listing_id;
  return new;
end;
$$ language plpgsql;

create or replace function public.community_listings_comments_count_dec()
returns trigger as $$
begin
  update public.community_listings
  set comments_count = greatest(comments_count - 1, 0)
  where id = old.listing_id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_community_listings_likes_inc on public.community_listing_likes;
create trigger trg_community_listings_likes_inc
  after insert on public.community_listing_likes
  for each row execute procedure public.community_listings_likes_count_inc();

drop trigger if exists trg_community_listings_likes_dec on public.community_listing_likes;
create trigger trg_community_listings_likes_dec
  after delete on public.community_listing_likes
  for each row execute procedure public.community_listings_likes_count_dec();

drop trigger if exists trg_community_listings_comments_inc on public.community_listing_comments;
create trigger trg_community_listings_comments_inc
  after insert on public.community_listing_comments
  for each row execute procedure public.community_listings_comments_count_inc();

drop trigger if exists trg_community_listings_comments_dec on public.community_listing_comments;
create trigger trg_community_listings_comments_dec
  after delete on public.community_listing_comments
  for each row execute procedure public.community_listings_comments_count_dec();

-- =========================
-- Helpers server-only
-- =========================
create or replace function public.wallet_ensure_row(p_user_id uuid)
returns void as $$
begin
  insert into public.wallet_balances(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$ language plpgsql;

-- Compra atomica con idempotencia
create or replace function public.community_purchase_listing(
  p_listing_id uuid,
  p_buyer_id uuid,
  p_referral_code text default null,
  p_idempotency_key text default null
)
returns table (
  purchase_id uuid,
  paid_credits integer
)
language plpgsql
as $$
declare
  v_listing record;
  v_buyer_balance record;

  v_price integer;
  v_paid integer;
  v_platform_fee integer;
  v_seller_net integer;

  v_ref_code record;
  v_ref_reward integer;
  v_referrer_id uuid;

  v_now timestamptz;
  v_recipe_hash text;
begin
  v_now := now();

  -- Idempotencia: si ya existe, regresa lo mismo
  if (p_idempotency_key is not null) then
    select id, paid_credits into purchase_id, paid_credits
    from public.community_purchases
    where idempotency_key = p_idempotency_key
    limit 1;

    if (purchase_id is not null) then
      return next;
      return;
    end if;
  end if;

  -- Listing (lock)
  select * into v_listing
  from public.community_listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'LISTING_NOT_ACTIVE';
  end if;

  if p_buyer_id = v_listing.seller_id then
    raise exception 'CANNOT_BUY_OWN_LISTING';
  end if;

  if exists (
    select 1 from public.community_purchases p
    where p.listing_id = p_listing_id
      and p.buyer_id = p_buyer_id
      and p.status = 'completed'
  ) then
    raise exception 'ALREADY_OWNED';
  end if;

  v_price := v_listing.price_credits;

  perform public.wallet_ensure_row(p_buyer_id);
  perform public.wallet_ensure_row(v_listing.seller_id);

  -- Referral opcional
  v_ref_reward := 0;
  v_referrer_id := null;

  if p_referral_code is not null and length(trim(p_referral_code)) > 0 then
    select * into v_ref_code
    from public.community_referral_codes
    where code = trim(p_referral_code)
      and is_active = true
    limit 1;

    if v_ref_code.id is not null and v_ref_code.owner_id <> p_buyer_id then
      v_referrer_id := v_ref_code.owner_id;
      perform public.wallet_ensure_row(v_referrer_id);
    end if;
  end if;

  v_paid := v_price;

  if v_ref_code.id is not null and v_ref_code.owner_id <> p_buyer_id then
    if v_ref_code.buyer_discount_pct > 0 then
      v_paid := floor((v_price * (100 - v_ref_code.buyer_discount_pct)) / 100.0)::int;
      if v_paid < 1 then v_paid := 1; end if;
    end if;

    if v_referrer_id is not null and v_ref_code.ref_reward_pct > 0 then
      v_ref_reward := floor((v_paid * v_ref_code.ref_reward_pct) / 100.0)::int;
      if v_ref_reward < 0 then v_ref_reward := 0; end if;
    end if;
  end if;

  -- Fee plataforma 37%
  v_platform_fee := floor(v_paid * 0.37)::int;
  if v_platform_fee < 0 then v_platform_fee := 0; end if;

  v_seller_net := v_paid - v_platform_fee;
  if v_seller_net < 0 then v_seller_net := 0; end if;

  -- Buyer wallet (lock)
  select * into v_buyer_balance
  from public.wallet_balances
  where user_id = p_buyer_id
  for update;

  if v_buyer_balance.generation_credits < v_paid then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Debit buyer
  update public.wallet_balances
  set generation_credits = generation_credits - v_paid
  where user_id = p_buyer_id;

  -- Credit seller pending
  update public.wallet_balances
  set earnings_pending_credits = earnings_pending_credits + v_seller_net
  where user_id = v_listing.seller_id;

  -- Credit referrer pending (costo plataforma)
  if v_referrer_id is not null and v_ref_reward > 0 then
    update public.wallet_balances
    set earnings_pending_credits = earnings_pending_credits + v_ref_reward
    where user_id = v_referrer_id;
  end if;

  select recipe_hash into v_recipe_hash
  from public.community_listing_recipes
  where listing_id = p_listing_id
  limit 1;

  if v_recipe_hash is null then
    raise exception 'LISTING_RECIPE_MISSING';
  end if;

  insert into public.community_purchases (
    listing_id,
    buyer_id,
    seller_id,
    price_credits,
    paid_credits,
    platform_fee_credits,
    seller_net_credits,
    referral_code_id,
    referral_reward_credits,
    referrer_id,
    created_at,
    matures_at,
    recipe_hash_at_purchase,
    idempotency_key
  ) values (
    p_listing_id,
    p_buyer_id,
    v_listing.seller_id,
    v_price,
    v_paid,
    v_platform_fee,
    v_seller_net,
    v_ref_code.id,
    v_ref_reward,
    v_referrer_id,
    v_now,
    v_now + interval '30 days',
    v_recipe_hash,
    p_idempotency_key
  )
  returning id into purchase_id;

  paid_credits := v_paid;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
  values
    (p_buyer_id, 'purchase_spent', -v_paid, 'community_purchase', purchase_id, p_idempotency_key),
    (v_listing.seller_id, 'sale_earned_pending', v_seller_net, 'community_purchase', purchase_id, p_idempotency_key);

  if v_referrer_id is not null and v_ref_reward > 0 then
    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
    values
      (v_referrer_id, 'referral_reward_pending', v_ref_reward, 'community_purchase', purchase_id, p_idempotency_key);
  end if;

  return next;
end;
$$;

revoke all on function public.community_purchase_listing(uuid, uuid, text, text) from public;
revoke all on function public.community_purchase_listing(uuid, uuid, text, text) from anon;
revoke all on function public.community_purchase_listing(uuid, uuid, text, text) from authenticated;
grant execute on function public.community_purchase_listing(uuid, uuid, text, text) to service_role;

-- Maturation: mueve pending -> matured
create or replace function public.community_mature_due_purchases()
returns integer
language sql
as $$
  with due as (
    update public.community_purchases
    set is_matured = true
    where is_matured = false
      and status = 'completed'
      and matures_at <= now()
    returning id, seller_id, seller_net_credits, referrer_id, referral_reward_credits
  ),
  sellers as (
    select seller_id as user_id, sum(seller_net_credits)::int as amt
    from due
    group by seller_id
  ),
  referrers as (
    select referrer_id as user_id, sum(referral_reward_credits)::int as amt
    from due
    where referrer_id is not null and referral_reward_credits > 0
    group by referrer_id
  ),
  upd_sellers as (
    update public.wallet_balances wb
    set earnings_pending_credits = greatest(wb.earnings_pending_credits - s.amt, 0),
        earnings_matured_credits = wb.earnings_matured_credits + s.amt,
        updated_at = now()
    from sellers s
    where wb.user_id = s.user_id
    returning wb.user_id
  ),
  upd_referrers as (
    update public.wallet_balances wb
    set earnings_pending_credits = greatest(wb.earnings_pending_credits - r.amt, 0),
        earnings_matured_credits = wb.earnings_matured_credits + r.amt,
        updated_at = now()
    from referrers r
    where wb.user_id = r.user_id
    returning wb.user_id
  ),
  ins_ledger as (
    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id)
    select seller_id, 'sale_matured', seller_net_credits, 'community_purchase', id
    from due
    union all
    select referrer_id, 'referral_reward_matured', referral_reward_credits, 'community_purchase', id
    from due
    where referrer_id is not null and referral_reward_credits > 0
    returning id
  )
  select count(*)::int from due;
$$;

revoke all on function public.community_mature_due_purchases() from public;
revoke all on function public.community_mature_due_purchases() from anon;
revoke all on function public.community_mature_due_purchases() from authenticated;
grant execute on function public.community_mature_due_purchases() to service_role;
